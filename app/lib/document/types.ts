/**
 * A box in PDF user space (points, 72 dpi, origin bottom-left of page).
 *
 * To convert to canvas/screen coordinates when rendering at a given scale:
 *   canvasX = box.x * scale
 *   canvasY = (pageHeight - box.y - box.height) * scale
 *   canvasW = box.width  * scale
 *   canvasH = box.height * scale
 */
export interface PdfBox {
  x: number
  y: number
  width: number
  height: number
}

export interface PdfSource {
  kind: "pdf"
  page: number
  /** One or more bounding rectangles in PDF user space. */
  boxes: PdfBox[]
}

export interface PlainTextSource {
  kind: "text"
  /** Character offset in the original source text where this span begins. */
  start: number
  /** Character offset in the original source text where this span ends (exclusive). */
  end: number
  /** 1-based line number in the source file, when available. */
  line?: number
}

export type TextSpanSource = PdfSource | PlainTextSource

export interface TextSpan {
  id: string
  /** Start offset in ParsedDocument.text (inclusive). */
  start: number
  /** End offset in ParsedDocument.text (exclusive). */
  end: number
  /** Exact text: invariant text.slice(start, end) === text */
  text: string
  source: TextSpanSource
}

export interface ParsedDocument {
  text: string
  spans: TextSpan[]
  metadata: {
    fileName: string
    fileType: string
    pageCount?: number
  }
}

export class ScannedPdfError extends Error {
  constructor() {
    super(
      "This PDF appears to be scanned or image-only. Only text-based PDFs are supported."
    )
    this.name = "ScannedPdfError"
  }
}
