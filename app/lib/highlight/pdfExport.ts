import type { ParsedDocument } from "../document/types"
import type { ReaderHighlight } from "./types"
import { normalizeHighlightRanges } from "./normalize"
import { getSourceSpansForHighlight, mergePdfBoxes } from "./sourceMapping"

/**
 * Loads the original PDF bytes, draws translucent yellow highlight rectangles
 * at the source locations corresponding to each ReaderHighlight, and triggers
 * a client-side download of the annotated file.
 *
 * Uses pdf-lib for modification so the original scan/text layer is preserved
 * exactly — we only add annotation rectangles on top.
 */
export async function downloadHighlightedPdf(
  originalBytes: ArrayBuffer,
  highlights: ReaderHighlight[],
  doc: ParsedDocument,
  originalFileName: string
): Promise<void> {
  const { PDFDocument, rgb } = await import("pdf-lib")

  const pdfDoc = await PDFDocument.load(originalBytes, {
    // Ignore unrecognised encryption so scanned PDFs with open passwords still load.
    ignoreEncryption: true,
  })

  const pages = pdfDoc.getPages()
  const normalized = normalizeHighlightRanges(highlights)

  for (const highlight of normalized) {
    const spans = getSourceSpansForHighlight(highlight, doc)
    const boxes = mergePdfBoxes(spans)

    for (const box of boxes) {
      const page = pages[box.page - 1]
      if (!page) continue

      // pdf-lib drawRectangle: y is the BOTTOM of the rectangle in PDF space.
      // Our box.y comes from pdfjs-dist transform[5], which is also the baseline
      // (bottom) of the glyph in PDF space — consistent coordinate systems.
      page.drawRectangle({
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        color: rgb(1, 0.9, 0.1),
        opacity: 0.35,
        borderWidth: 0,
      })
    }
  }

  const bytes = await pdfDoc.save()
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" })
  const url = URL.createObjectURL(blob)

  const baseName = originalFileName.replace(/\.pdf$/i, "")
  const a = document.createElement("a")
  a.href = url
  a.download = `${baseName}-highlighted.pdf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
