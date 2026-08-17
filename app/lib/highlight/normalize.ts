import type { ReaderHighlight } from "./types"

/**
 * Merges overlapping or adjacent canonical highlight ranges into a minimal
 * set of non-overlapping ranges. Preserves the original ids of all input
 * highlights (merged ranges take the id of the first constituent).
 *
 * Use this for PDF annotation so overlapping highlights don't produce
 * double-opaque rectangles.
 */
export function normalizeHighlightRanges(
  highlights: ReaderHighlight[]
): ReaderHighlight[] {
  if (highlights.length === 0) return []

  const sorted = [...highlights].sort(
    (a, b) => a.canonicalStart - b.canonicalStart
  )

  const merged: ReaderHighlight[] = []
  let current = { ...sorted[0] }

  for (let i = 1; i < sorted.length; i++) {
    const h = sorted[i]
    if (h.canonicalStart <= current.canonicalEnd) {
      // Overlapping or adjacent — extend current.
      if (h.canonicalEnd > current.canonicalEnd) {
        current = {
          ...current,
          endTokenId: h.endTokenId,
          canonicalEnd: h.canonicalEnd,
        }
      }
    } else {
      merged.push(current)
      current = { ...h }
    }
  }
  merged.push(current)
  return merged
}
