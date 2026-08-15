import type { ParsedDocument, TextSpan, PdfBox } from "../types"
import { ScannedPdfError } from "../types"

// Minimum extractable characters before we call it a scanned PDF.
const MIN_TEXT_CHARS = 20

// Fraction of estimated font height below which an x-gap is ignored.
const SPACE_X_RATIO = 0.15

// Fraction of estimated font height above which a y-delta is treated as a line break.
const LINE_Y_RATIO = 0.4

function estimateFontHeight(transform: number[]): number {
  // For upright text, transform[3] is the vertical font scale (≈ font size in points).
  // Fall back to the magnitude of the horizontal vector for rotated text.
  const h = Math.abs(transform[3])
  if (h > 0) return h
  return Math.sqrt(transform[0] ** 2 + transform[1] ** 2)
}

export async function parsePdf(file: File): Promise<ParsedDocument> {
  const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist")

  if (!GlobalWorkerOptions.workerSrc) {
    GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url
    ).toString()
  }

  const data = await file.arrayBuffer()
  const loadingTask = getDocument({ data })
  const pdf = await loadingTask.promise

  const pageCount = pdf.numPages
  let text = ""
  const spans: TextSpan[] = []
  let idCounter = 0

  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const content = await page.getTextContent()

    // Track the previous item's geometry to decide on separators.
    let prevX = NaN
    let prevY = NaN
    let prevRight = NaN
    let prevFontH = NaN

    for (const item of content.items) {
      // Skip TextMarkedContent (no 'str' field).
      if (!("str" in item)) continue

      const { str, transform, width, height, hasEOL } = item as {
        str: string
        transform: number[]
        width: number
        height: number
        hasEOL: boolean
      }

      const x = transform[4]
      const y = transform[5]
      const fontH = estimateFontHeight(transform)
      // Use item.height when available (> 0), else fall back to font size.
      const itemH = height > 0 ? height : fontH

      // Emit separator between items if geometry warrants it.
      if (!isNaN(prevX) && str.length > 0) {
        const yDelta = Math.abs(y - prevY)
        const xGap = x - prevRight

        if (yDelta > (prevFontH || fontH) * LINE_Y_RATIO) {
          // Moved to a new line.
          if (!text.endsWith("\n")) text += "\n"
        } else if (
          xGap > (prevFontH || fontH) * SPACE_X_RATIO &&
          !text.endsWith(" ") &&
          !str.startsWith(" ")
        ) {
          // Visible gap between adjacent items — insert a space.
          text += " "
        }
      }

      if (str.length > 0) {
        const start = text.length
        text += str
        const end = text.length

        const box: PdfBox = { x, y, width, height: itemH }
        const span: TextSpan = {
          id: `s${idCounter++}`,
          start,
          end,
          text: str,
          source: { kind: "pdf", page: pageNum, boxes: [box] },
        }
        spans.push(span)

        prevX = x
        prevY = y
        prevRight = x + width
        prevFontH = fontH
      }

      if (hasEOL && !text.endsWith("\n")) {
        text += "\n"
        // Reset x tracking so the next item doesn't trigger a spurious gap.
        prevX = NaN
      }
    }

    // Page break.
    if (pageNum < pageCount && !text.endsWith("\n")) {
      text += "\n"
    }
  }

  if (text.replace(/\s/g, "").length < MIN_TEXT_CHARS) {
    throw new ScannedPdfError()
  }

  return {
    text,
    spans,
    metadata: { fileName: file.name, fileType: "pdf", pageCount },
  }
}
