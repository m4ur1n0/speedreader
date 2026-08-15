import type { ParsedDocument, TextSpan } from "./types"

/**
 * Returns every span that overlaps the canonical text range [start, end).
 *
 * A span overlaps when span.start < end && span.end > start.
 *
 * For PDF spans this yields the page + bounding boxes needed to draw
 * highlight rectangles on the original document.
 */
export function getSourceSpansForRange(
  doc: ParsedDocument,
  start: number,
  end: number
): TextSpan[] {
  return doc.spans.filter((s) => s.start < end && s.end > start)
}

/**
 * Verifies the core invariant for every span in a document.
 * Returns the first failing span, or null if all pass.
 * Useful in tests and debug panels.
 */
export function findInvariantViolation(doc: ParsedDocument): TextSpan | null {
  for (const span of doc.spans) {
    if (doc.text.slice(span.start, span.end) !== span.text) {
      return span
    }
  }
  return null
}
