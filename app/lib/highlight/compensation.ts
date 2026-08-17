import type { ReaderModel } from "../reader/types"

/**
 * Time budget we attribute to human reaction latency on keydown.
 * A user notices something interesting, decides to capture it, then presses the key.
 * We compensate by starting the highlight slightly before the physical keypress.
 */
const KEYDOWN_COMP_MS = 500

/**
 * Time budget for keyup reaction latency.
 * Smaller because releasing a key is a simpler motor action.
 */
const KEYUP_COMP_MS = 200

/** Minimum/maximum backward compensation in tokens. */
const COMP_BACK_MIN = 2
const COMP_BACK_MAX = 6

/** Minimum/maximum forward compensation in tokens. */
const COMP_FWD_MIN = 1
const COMP_FWD_MAX = 3

/**
 * How close (in tokens) the compensated start must be to a sentence boundary
 * before we snap to the sentence start.
 *
 * If the user pressed within ~3 words of a sentence start, assume they meant
 * to capture from the beginning of the sentence.
 */
const SENTENCE_SNAP_TOKENS = 3

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function getSentenceEndTokenId(model: ReaderModel, tokenId: number): number {
  const token = model.tokens[tokenId]
  if (!token) return tokenId
  // The next sentence's first token index is one past the current sentence's last token.
  const nextSentenceStart = model.sentenceFirstToken.get(token.sentenceId + 1)
  return nextSentenceStart !== undefined
    ? nextSentenceStart - 1
    : model.tokens.length - 1
}

/**
 * Returns the token id at which a highlight should start, given the physical
 * keydown happened at currentTokenId.
 *
 * Steps:
 *  1. Translate KEYDOWN_COMP_MS into a token count at the current pace.
 *  2. Clamp to sensible bounds.
 *  3. If the result lands within SENTENCE_SNAP_TOKENS of the current sentence
 *     start, snap to the sentence start (user likely intended the full sentence).
 */
export function getCompensatedHighlightStart(
  currentTokenId: number,
  currentBaseWpm: number,
  model: ReaderModel
): number {
  const msPerToken = 60_000 / Math.max(1, currentBaseWpm)
  const rawBack = KEYDOWN_COMP_MS / msPerToken
  const tokensBack = clamp(Math.round(rawBack), COMP_BACK_MIN, COMP_BACK_MAX)
  const candidate = Math.max(0, currentTokenId - tokensBack)

  const sentenceStart = model.getSentenceStart(currentTokenId)
  if (candidate - sentenceStart <= SENTENCE_SNAP_TOKENS) {
    return sentenceStart
  }
  return candidate
}

/**
 * Returns the token id at which a highlight should end, given the physical
 * keyup happened at currentTokenId.
 *
 * Steps:
 *  1. Translate KEYUP_COMP_MS into a token count at the current pace.
 *  2. Clamp conservatively.
 *  3. If the result nearly reaches the sentence end, snap to it to avoid
 *     stopping awkwardly one word before the period.
 */
export function getCompensatedHighlightEnd(
  currentTokenId: number,
  currentBaseWpm: number,
  model: ReaderModel
): number {
  const msPerToken = 60_000 / Math.max(1, currentBaseWpm)
  const rawFwd = KEYUP_COMP_MS / msPerToken
  const tokensForward = clamp(Math.round(rawFwd), COMP_FWD_MIN, COMP_FWD_MAX)
  const candidate = Math.min(model.tokens.length - 1, currentTokenId + tokensForward)

  const sentenceEnd = getSentenceEndTokenId(model, currentTokenId)
  // Snap to sentence end only if candidate is very close but didn't reach it.
  if (sentenceEnd >= candidate && sentenceEnd - candidate <= 2) {
    return sentenceEnd
  }
  return candidate
}
