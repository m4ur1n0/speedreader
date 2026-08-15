/**
 * Returns the index of the ORP focal character within a word.
 *
 * Ratios derived from the recognition-point heuristic:
 *   1 char       → index 0
 *   2–5 chars    → ~35% (rounded)
 *   6–9 chars    → ~40%
 *   10–13 chars  → ~45%
 *   14+ chars    → ~50%
 *
 * Result is clamped to [0, word.length - 1].
 */
export function getFocusIndex(word: string): number {
  const len = word.length
  if (len <= 1) return 0

  let ratio: number
  if (len <= 5) ratio = 0.35
  else if (len <= 9) ratio = 0.40
  else if (len <= 13) ratio = 0.45
  else ratio = 0.50

  const raw = Math.round(len * ratio)
  return Math.max(0, Math.min(len - 1, raw))
}
