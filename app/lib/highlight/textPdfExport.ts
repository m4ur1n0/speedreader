import type { ParsedDocument } from "../document/types"
import type { ReaderHighlight } from "./types"
import { normalizeHighlightRanges } from "./normalize"

// ── Layout constants ─────────────────────────────────────────────────────────

const PAGE_WIDTH = 595.28   // A4 points
const PAGE_HEIGHT = 841.89
const MARGIN_H = 60
const MARGIN_V = 60
const FONT_SIZE = 12
const LINE_HEIGHT = FONT_SIZE * 1.5
const TEXT_WIDTH = PAGE_WIDTH - 2 * MARGIN_H
const CONTENT_HEIGHT = PAGE_HEIGHT - 2 * MARGIN_V
const PARA_SPACING = LINE_HEIGHT * 0.6 // extra gap between paragraphs
const HIGHLIGHT_COLOR = { r: 1, g: 0.92, b: 0.2 }
const HIGHLIGHT_OPACITY = 0.45

interface LayoutLine {
  text: string
  canonicalStart: number  // inclusive offset in doc.text
  canonicalEnd: number    // exclusive offset in doc.text
  page: number
  x: number               // left edge in PDF user space
  y: number               // baseline y in PDF user space (bottom-left origin)
  width: number           // rendered width of this line
}

interface LayoutState {
  page: number
  y: number               // current y for next line baseline
}

/**
 * Generates a clean PDF from the canonical document text, overlaying
 * translucent yellow highlights at the canonical ranges of each
 * ReaderHighlight, then triggers a client-side download.
 *
 * Design choices for .txt and similar files:
 *   - Helvetica (embedded, no subset needed for Latin text)
 *   - 12pt body, 1.5× leading
 *   - 60pt horizontal/vertical margins
 *   - Paragraph breaks (≥2 newlines) → blank-line gap
 *   - Single newlines → new line (preserved as intentional line breaks)
 *   - No invented headings, bullets, or indentation
 *   - Page numbers at bottom centre
 */
export async function downloadTextAsPdf(
  doc: ParsedDocument,
  highlights: ReaderHighlight[],
  originalFileName: string
): Promise<void> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib")

  const pdfDoc = await PDFDocument.create()
  pdfDoc.setTitle(doc.metadata.fileName)

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)

  // ── Layout pass: convert canonical text → LayoutLines ─────────────────────

  const lines: LayoutLine[] = []
  let state: LayoutState = { page: 1, y: PAGE_HEIGHT - MARGIN_V - FONT_SIZE }

  function addPage(pdfD: typeof pdfDoc) {
    const p = pdfD.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    state = { page: pdfD.getPageCount(), y: PAGE_HEIGHT - MARGIN_V - FONT_SIZE }
    return p
  }

  function ensureRoom(pdfD: typeof pdfDoc, extraY = 0) {
    if (state.y - extraY < MARGIN_V + FONT_SIZE) {
      addPage(pdfD)
    }
  }

  function advanceLine(pdfD: typeof pdfDoc, extra = 0) {
    state.y -= LINE_HEIGHT + extra
    ensureRoom(pdfD)
  }

  // Start with the first page.
  addPage(pdfDoc)

  // Walk the canonical text, maintaining canonical offsets.
  const text = doc.text

  // Split into segments separated by newlines.
  // We process the text character by character, building words,
  // then wrapping words into lines.

  let offset = 0

  // Each "segment" is a run of non-newline characters → a word-wrapped block.
  // Newlines are tracked as structural breaks.

  // We process the entire text as a sequence of logical paragraphs
  // (split by \n\n) and lines within paragraphs (split by \n).

  while (offset < text.length) {
    // Skip leading newlines that form paragraph/line breaks between segments.
    let newlineCount = 0
    const newlineStart = offset
    while (offset < text.length && text[offset] === '\n') {
      newlineCount++
      offset++
    }

    if (newlineCount >= 2) {
      // Paragraph break: add extra vertical gap.
      state.y -= PARA_SPACING
      ensureRoom(pdfDoc)
      continue
    }
    if (newlineCount === 1 && offset < text.length) {
      // Single newline: intentional line break — move to next line.
      advanceLine(pdfDoc)
      continue
    }
    if (newlineCount > 0) {
      // Trailing newlines at end of document, skip.
      continue
    }

    // We are at a non-newline character. Read until the next newline or end.
    const lineStart = offset
    let lineEnd = offset
    while (lineEnd < text.length && text[lineEnd] !== '\n') {
      lineEnd++
    }

    const lineText = text.slice(lineStart, lineEnd)
    offset = lineEnd // newlines handled at top of loop

    if (lineText.trim().length === 0) {
      // Blank logical line (all spaces): skip.
      continue
    }

    // Word-wrap lineText to TEXT_WIDTH.
    // We split by spaces, tracking canonical offsets for each word.
    let wordStart = 0
    const wordRe = /\S+/g
    let wordMatch: RegExpExecArray | null

    let currentLineText = ""
    let currentLineCanonStart = lineStart
    let currentLineWidth = 0
    const SPACE_WIDTH = font.widthOfTextAtSize(" ", FONT_SIZE)

    while ((wordMatch = wordRe.exec(lineText)) !== null) {
      const word = wordMatch[0]
      const wordCanonStart = lineStart + wordMatch.index
      const wordCanonEnd = wordCanonStart + word.length
      const wordWidth = font.widthOfTextAtSize(word, FONT_SIZE)

      const spaceNeeded = currentLineText.length > 0 ? SPACE_WIDTH : 0
      const fitsOnLine = currentLineWidth + spaceNeeded + wordWidth <= TEXT_WIDTH

      if (!fitsOnLine && currentLineText.length > 0) {
        // Flush current line.
        lines.push({
          text: currentLineText,
          canonicalStart: currentLineCanonStart,
          canonicalEnd: wordCanonStart, // approximation: includes trailing space
          page: state.page,
          x: MARGIN_H,
          y: state.y,
          width: currentLineWidth,
        })
        advanceLine(pdfDoc)
        currentLineText = word
        currentLineCanonStart = wordCanonStart
        currentLineWidth = wordWidth
      } else {
        if (currentLineText.length > 0) {
          currentLineText += " " + word
          currentLineWidth += SPACE_WIDTH + wordWidth
        } else {
          currentLineText = word
          currentLineCanonStart = wordCanonStart
          currentLineWidth = wordWidth
        }
      }

      wordStart = wordMatch.index + word.length
    }

    // Flush last line.
    if (currentLineText.length > 0) {
      lines.push({
        text: currentLineText,
        canonicalStart: currentLineCanonStart,
        canonicalEnd: lineEnd,
        page: state.page,
        x: MARGIN_H,
        y: state.y,
        width: currentLineWidth,
      })
      advanceLine(pdfDoc)
    }
  }

  // ── Draw pass ─────────────────────────────────────────────────────────────

  // Group lines by page.
  const linesByPage = new Map<number, LayoutLine[]>()
  for (const line of lines) {
    let arr = linesByPage.get(line.page)
    if (!arr) { arr = []; linesByPage.set(line.page, arr) }
    arr.push(line)
  }

  const pages = pdfDoc.getPages()
  const normalized = normalizeHighlightRanges(highlights)

  for (const [pageNum, pageLines] of linesByPage) {
    const page = pages[pageNum - 1]
    if (!page) continue

    // Draw highlight rectangles first (under text).
    for (const highlight of normalized) {
      for (const line of pageLines) {
        // Does this highlight overlap this line?
        if (highlight.canonicalStart >= line.canonicalEnd) continue
        if (highlight.canonicalEnd <= line.canonicalStart) continue

        // Find the substring of this line that is highlighted.
        const hlRelStart = Math.max(0, highlight.canonicalStart - line.canonicalStart)
        const hlRelEnd = Math.min(
          line.text.length,
          highlight.canonicalEnd - line.canonicalStart
        )

        if (hlRelStart >= hlRelEnd) continue

        // Measure x-offset and width of the highlighted portion.
        const prefixText = line.text.slice(0, hlRelStart)
        const hlText = line.text.slice(hlRelStart, hlRelEnd)
        const prefixWidth = prefixText.length > 0
          ? font.widthOfTextAtSize(prefixText, FONT_SIZE)
          : 0
        const hlWidth = font.widthOfTextAtSize(hlText, FONT_SIZE)
        if (hlWidth <= 0) continue

        // y for the rectangle: baseline + descent (approx -0.25em) to baseline + ascent (approx 0.75em)
        const rectH = LINE_HEIGHT * 0.85
        const rectY = line.y - FONT_SIZE * 0.2  // slightly below baseline

        page.drawRectangle({
          x: line.x + prefixWidth,
          y: rectY,
          width: hlWidth,
          height: rectH,
          color: rgb(HIGHLIGHT_COLOR.r, HIGHLIGHT_COLOR.g, HIGHLIGHT_COLOR.b),
          opacity: HIGHLIGHT_OPACITY,
          borderWidth: 0,
        })
      }
    }

    // Draw text on top.
    for (const line of pageLines) {
      page.drawText(line.text, {
        x: line.x,
        y: line.y,
        size: FONT_SIZE,
        font,
        color: rgb(0, 0, 0),
      })
    }

    // Page number at bottom centre.
    const pageNumText = String(pageNum)
    const pageNumWidth = font.widthOfTextAtSize(pageNumText, 9)
    page.drawText(pageNumText, {
      x: PAGE_WIDTH / 2 - pageNumWidth / 2,
      y: MARGIN_V / 2,
      size: 9,
      font,
      color: rgb(0.5, 0.5, 0.5),
    })
  }

  // ── Download ──────────────────────────────────────────────────────────────

  const bytes = await pdfDoc.save()
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" })
  const url = URL.createObjectURL(blob)

  const baseName = originalFileName.replace(/\.[^.]+$/, "")
  const a = document.createElement("a")
  a.href = url
  a.download = `${baseName}-highlighted.pdf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
