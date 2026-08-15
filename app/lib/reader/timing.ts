import type { ReaderToken } from "./types"

/**
 * Pre-computes a lexical timing weight for a token.
 * Called once during model construction to avoid per-frame recalculation.
 *
 * Very short/common words   →  0.88–0.95x
 * Normal words              →  1.00x
 * 8–11 character words      →  ~1.12x
 * 12+ character words       →  ~1.25x
 * Numbers / inner symbols   →  ≥1.20x
 */
export function computeTimingWeight(word: string): number {
  const len = word.length

  let weight = 1.0
  if (len <= 2) weight = 0.88
  else if (len === 3) weight = 0.92
  else if (len >= 12) weight = 1.25
  else if (len >= 8) weight = 1.12

  // Boost for embedded digits or operational symbols (harder to parse quickly).
  if (/[0-9]/.test(word) || /[+\-*/=<>@#$%^&]/.test(word)) {
    weight = Math.max(weight, 1.20)
  }

  return weight
}

/**
 * Returns the display duration (ms) for a token.
 *
 * Formula:
 *   duration = baseDurationMs * lexicalMultiplier * difficultyMultiplier
 *            + boundaryPause
 *
 * Boundary pauses are additive, not multiplicative, and use the LARGEST
 * applicable pause to avoid stacking absurd delays.
 *
 * difficultyMultiplier = 1.0 by default; a future LLM-scoring pass will
 * supply per-region values (e.g. 0.80 for dense sections).
 *
 * Line break conventions:
 *   isParagraphEnd    → +0.85x base (long pause before entering new paragraph)
 *   isParagraphStart  → +0.40x base (brief "entering new section" beat)
 *   isLineStart       → +0.25x base (intentional line break within a section)
 *   isSentenceEnd     → +0.60x base
 *   trailing comma/;  → +0.25x base
 */
export function getTokenDuration(
  token: ReaderToken,
  baseDurationMs: number,
  difficultyMultiplier: number
): number {
  // difficultyMultiplier is a speed ratio: 1.0 = normal, 0.80 = 80% speed.
  // Dividing baseDurationMs by it converts speed ratio to duration ratio
  // (0.80 speed → 1.25× longer per token).
  const base = baseDurationMs * token.timingWeight / difficultyMultiplier

  // Pick the single largest boundary pause — don't stack them.
  let pause = 0

  if (token.isParagraphEnd) {
    pause = baseDurationMs * 0.85
  } else if (token.isSentenceEnd) {
    pause = baseDurationMs * 0.60
  } else {
    const stripped = token.text.replace(/['")\]>]+$/, "")
    if (/[,;]$/.test(stripped)) {
      pause = baseDurationMs * 0.25
    }
  }

  // Entrance pauses (on the first word of a new section) are independent of
  // the exit pause on the previous token.
  let entrancePause = 0
  if (token.isParagraphStart) {
    entrancePause = baseDurationMs * 0.40
  } else if (token.isLineStart) {
    entrancePause = baseDurationMs * 0.25
  }

  return base + pause + entrancePause
}
