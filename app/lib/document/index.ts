export type { ParsedDocument, TextSpan, TextSpanSource, PdfSource, PlainTextSource, PdfBox } from "./types"
export { ScannedPdfError } from "./types"
export { getSourceSpansForRange, findInvariantViolation } from "./utils"

import type { ParsedDocument } from "./types"

const PDF_EXTENSIONS = new Set(["pdf"])
const PLAIN_EXTENSIONS = new Set(["txt", "md", "markdown"])
const RTF_EXTENSIONS = new Set(["rtf"])
const EPUB_EXTENSIONS = new Set(["epub"])

export async function parseFile(file: File): Promise<ParsedDocument> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? ""

  if (PDF_EXTENSIONS.has(ext)) {
    const { parsePdf } = await import("./parsers/pdf")
    return parsePdf(file)
  }

  if (PLAIN_EXTENSIONS.has(ext)) {
    const { parsePlainText } = await import("./parsers/plaintext")
    return parsePlainText(file, ext)
  }

  if (RTF_EXTENSIONS.has(ext)) {
    const { parseRtf } = await import("./parsers/rtf")
    return parseRtf(file)
  }

  if (EPUB_EXTENSIONS.has(ext)) {
    const { parseEpub } = await import("./parsers/epub")
    return parseEpub(file)
  }

  throw new Error(`Unsupported file type: .${ext}`)
}
