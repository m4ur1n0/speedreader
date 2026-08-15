import type { ParsedDocument, TextSpan } from "../types"

/**
 * EPUB parser.
 *
 * Reads the OPF spine to extract content documents in reading order, then
 * strips HTML tags from each document and appends the text to the canonical
 * string.  Source spans carry the path of the content document they came from
 * as the source.kind = "text" with offsets in the canonical text.
 */
export async function parseEpub(file: File): Promise<ParsedDocument> {
  const JSZip = (await import("jszip")).default
  const data = await file.arrayBuffer()
  const zip = await JSZip.loadAsync(data)

  // 1. Find OPF path from META-INF/container.xml
  const containerXml = await zip.file("META-INF/container.xml")?.async("text")
  if (!containerXml) throw new Error("Invalid EPUB: missing META-INF/container.xml")

  const containerDoc = new DOMParser().parseFromString(containerXml, "application/xml")
  const opfPath = containerDoc.querySelector("rootfile")?.getAttribute("full-path")
  if (!opfPath) throw new Error("Invalid EPUB: no rootfile in container.xml")

  // 2. Read OPF
  const opfContent = await zip.file(opfPath)?.async("text")
  if (!opfContent) throw new Error(`Invalid EPUB: cannot read OPF at ${opfPath}`)

  const opfDoc = new DOMParser().parseFromString(opfContent, "application/xml")
  const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : ""

  // 3. Build manifest id → href map
  const manifest: Record<string, string> = {}
  for (const item of opfDoc.querySelectorAll("manifest item")) {
    const id = item.getAttribute("id")
    const href = item.getAttribute("href")
    if (id && href) manifest[id] = href
  }

  // 4. Walk the spine in order
  const spineIds = Array.from(opfDoc.querySelectorAll("spine itemref"))
    .map((ref) => ref.getAttribute("idref"))
    .filter((id): id is string => id !== null)

  let text = ""
  const spans: TextSpan[] = []
  let idCounter = 0

  for (const itemId of spineIds) {
    const relativePath = manifest[itemId]
    if (!relativePath) continue

    const fullPath = opfDir + relativePath
    const htmlContent = await zip.file(fullPath)?.async("text")
    if (!htmlContent) continue

    const doc = new DOMParser().parseFromString(htmlContent, "text/html")

    // Remove non-text elements.
    for (const el of doc.querySelectorAll("script, style, head")) el.remove()

    // Walk text nodes, emit spans per non-empty text node.
    const walker = doc.createTreeWalker(doc.body ?? doc, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      const raw = node.textContent ?? ""
      if (!raw.trim()) continue

      // Add a separator when we're mid-line.
      const needsNewline = text.length > 0 && !text.endsWith("\n")
      if (needsNewline && isBlockBoundary(node)) text += "\n"
      else if (text.length > 0 && !text.endsWith(" ") && !raw.startsWith(" ")) {
        text += " "
      }

      const start = text.length
      text += raw
      const end = text.length

      spans.push({
        id: `s${idCounter++}`,
        start,
        end,
        text: raw,
        source: { kind: "text", start, end },
      })
    }

    // Ensure documents are separated.
    if (text.length > 0 && !text.endsWith("\n")) text += "\n"
  }

  return {
    text,
    spans,
    metadata: { fileName: file.name, fileType: "epub" },
  }
}

/** Returns true when the text node sits inside a block-level ancestor. */
function isBlockBoundary(node: Node): boolean {
  const BLOCK = new Set([
    "P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6",
    "LI", "TD", "TH", "BLOCKQUOTE", "PRE", "SECTION",
    "ARTICLE", "ASIDE", "HEADER", "FOOTER", "MAIN",
  ])
  let el = node.parentElement
  while (el) {
    if (BLOCK.has(el.tagName)) return true
    el = el.parentElement
  }
  return false
}
