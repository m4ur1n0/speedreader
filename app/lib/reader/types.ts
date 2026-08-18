export interface ReaderToken {
  id: number
  text: string

  canonicalStart: number
  canonicalEnd: number

  sentenceId: number
  paragraphId: number

  /** True when this token's text ends with .!? (sentence-terminal). */
  isSentenceEnd: boolean
  /** True when this is the last token of a paragraph. */
  isParagraphEnd: boolean
  /** True when this token immediately follows a paragraph break (≥2 newlines). */
  isParagraphStart: boolean
  /** True when this token immediately follows a single newline (intentional line break). */
  isLineStart: boolean

  /** Pre-computed lexical weight used by the timing engine. */
  timingWeight: number
  /** Index of the ORP focal character within token.text. */
  focusIndex: number
}

export interface ReaderModel {
  tokens: ReaderToken[]
  /** sentenceId → index of first token in that sentence. */
  sentenceFirstToken: Map<number, number>
  /** paragraphId → index of first token in that paragraph. */
  paragraphFirstToken: Map<number, number>
  /** Returns the token index at the start of the sentence containing tokenId. */
  getSentenceStart(tokenId: number): number
  /** Returns the token index at the start of the paragraph containing tokenId. */
  getParagraphStart(tokenId: number): number
}

export type PlayerStatus = "idle" | "playing" | "paused" | "finished"

export interface PlayerState {
  status: PlayerStatus
  currentTokenId: number
  activeReadingMs: number
  /** Current effective WPM shown in the HUD — updated after each token. */
  currentBaseWpm: number
  /** User-configured ceiling for the ramp. */
  targetMaxWpm: number
  sentenceId: number
  paragraphId: number
}

export const RAMP_START_WPM = 240
export const RAMP_MAX_WPM = 350
export const RAMP_DURATION_MS = 210_000 // 3.5 minutes of active reading
