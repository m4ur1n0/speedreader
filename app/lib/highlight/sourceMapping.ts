import type { ParsedDocument, TextSpan } from "../document/types"
import { getSourceSpansForRange } from "../document/utils"
import type { ReaderHighlight } from "./types"

export interface PdfHighlightBox {
  page: number
  x: number
  y: number
  width: number
  height: number
}

/**
 * Returns all document spans that overlap the highlight's canonical range.
 */
export function getSourceSpansForHighlight(
  highlight: ReaderHighlight,
  doc: ParsedDocument
): TextSpan[] {
  return getSourceSpansForRange(doc, highlight.canonicalStart, highlight.canonicalEnd)
}

/**
 * Converts an array of TextSpans (PDF source only) into merged per-line
 * highlight boxes suitable for drawing on the original PDF.
 *
 * Algorithm:
 *  1. Collect all PdfSource boxes, tagging each with page number.
 *  2. Group by page.
 *  3. Within each page, sort descending by y (top of page in PDF coords is
 *     the highest y value for upright text).
 *  4. Merge boxes on the same visual line (similar y within ½ fontHeight).
 *  5. Within each line group, merge horizontally overlapping/adjacent boxes.
 */
export function mergePdfBoxes(spans: TextSpan[]): PdfHighlightBox[] {
  // Collect raw boxes tagged with page.
  const raw: PdfHighlightBox[] = []
  for (const span of spans) {
    if (span.source.kind !== "pdf") continue
    for (const box of span.source.boxes) {
      raw.push({
        page: span.source.page,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      })
    }
  }

  if (raw.length === 0) return []

  // Group by page.
  const byPage = new Map<number, PdfHighlightBox[]>()
  for (const box of raw) {
    let arr = byPage.get(box.page)
    if (!arr) { arr = []; byPage.set(box.page, arr) }
    arr.push(box)
  }

  const result: PdfHighlightBox[] = []

  for (const [page, boxes] of byPage) {
    // Sort by y descending (top of page first for upright text), then x.
    boxes.sort((a, b) => b.y - a.y || a.x - b.x)

    // Group into lines: boxes whose y-ranges overlap or are within ½ height.
    const lines: PdfHighlightBox[][] = []
    for (const box of boxes) {
      const last = lines[lines.length - 1]
      if (last) {
        const refY = last[0].y
        const refH = last[0].height
        // Same line if the y value is close enough (within half a line height).
        if (Math.abs(box.y - refY) <= refH * 0.5) {
          last.push(box)
          continue
        }
      }
      lines.push([box])
    }

    // For each line, merge horizontally.
    for (const line of lines) {
      // Sort by x.
      line.sort((a, b) => a.x - b.x)

      let cur = { ...line[0], page }
      for (let i = 1; i < line.length; i++) {
        const b = line[i]
        const curRight = cur.x + cur.width
        if (b.x <= curRight + 2) {
          // Adjacent or overlapping — extend.
          const newRight = Math.max(curRight, b.x + b.width)
          cur = {
            ...cur,
            y: Math.min(cur.y, b.y),
            width: newRight - cur.x,
            height: Math.max(cur.height, b.height),
          }
        } else {
          result.push(cur)
          cur = { ...b, page }
        }
      }
      result.push(cur)
    }
  }

  return result
}
