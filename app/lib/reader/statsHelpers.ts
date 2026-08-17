import { RAMP_START_WPM, RAMP_MAX_WPM, RAMP_DURATION_MS } from "./types"

/** Conventional baseline used for normal-reading estimates (words per minute). */
export const NORMAL_READING_WPM = 250

/**
 * Estimates the time (in seconds) to read `tokenCount` words at a
 * conventional normal reading pace of NORMAL_READING_WPM.
 */
export function estimateNormalReadingSeconds(tokenCount: number): number {
  return (tokenCount / NORMAL_READING_WPM) * 60
}

/**
 * Estimates the time (in seconds) to read `tokenCount` words with the
 * speedreader's linear speed ramp from RAMP_START_WPM to `targetMaxWpm`.
 *
 * Derivation:
 *   Words read in [0, T] ms = ∫₀ᵀ wpm(t)/60000 dt
 *
 *   For t ≤ RAMP (linear ramp):
 *     wpm(t) = START + (MAX − START) * t / RAMP
 *     words(T) = (START·T + (MAX−START)·T²/(2·RAMP)) / 60000
 *
 *   Setting words(T) = N gives a quadratic in T:
 *     a·T² + b·T + c = 0
 *     a = (MAX−START)/(2·RAMP), b = START, c = −N·60000
 *     T = (−b + √(b²−4ac)) / (2a)
 *
 *   For T > RAMP (constant MAX speed):
 *     T = RAMP + (N − words(RAMP)) · 60000 / MAX
 *
 * Lexical timing weights and boundary pauses are not modelled here; they
 * roughly average out for long documents and would require the full model.
 */
export function estimateSpeedreaderSeconds(
  tokenCount: number,
  targetMaxWpm: number = RAMP_MAX_WPM,
  startWpm: number = RAMP_START_WPM,
  rampDurationMs: number = RAMP_DURATION_MS
): number {
  const N = tokenCount
  const START = startWpm
  const MAX = Math.max(startWpm + 1, targetMaxWpm) // avoid division by zero
  const RAMP = rampDurationMs

  // Words read when the ramp finishes (at t = RAMP ms):
  // = (START*RAMP + (MAX-START)*RAMP/2) / 60000 = RAMP*(START+MAX)/2/60000
  const wordsAtRampEnd = (RAMP * (START + MAX)) / 2 / 60_000

  if (N <= wordsAtRampEnd) {
    // Solution within ramp [0, RAMP]: solve a·T² + b·T + c = 0
    const a = (MAX - START) / (2 * RAMP)
    const b = START
    const c = -(N * 60_000)
    const disc = b * b - 4 * a * c
    const T_ms = (-b + Math.sqrt(disc)) / (2 * a)
    return T_ms / 1000
  }

  // Beyond ramp: constant MAX speed.
  const wordsAfterRamp = N - wordsAtRampEnd
  const T_ms = RAMP + (wordsAfterRamp * 60_000) / MAX
  return T_ms / 1000
}

/**
 * Formats a duration in seconds to a human-readable string.
 * Returns short approximate strings appropriate for at-a-glance UI.
 */
export function formatDuration(seconds: number): string {
  if (seconds < 90) return `< 2 min`
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `~${mins} min`
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  return rem === 0 ? `~${hours}h` : `~${hours}h ${rem}m`
}

/**
 * Computes a post-session summary from accumulated player state.
 * `wordsRead` is the final currentTokenId (approx words seen).
 */
export function computeSessionStats(
  wordsRead: number,
  activeReadingMs: number,
  highlightCount: number
) {
  const activeReadingSec = activeReadingMs / 1000
  const averageWpm =
    activeReadingMs > 0 ? Math.round((wordsRead / activeReadingMs) * 60_000) : 0
  const normalTimeSec = estimateNormalReadingSeconds(wordsRead)
  const timeSavedSec = Math.max(0, normalTimeSec - activeReadingSec)

  return {
    wordsRead,
    activeReadingSec,
    averageWpm,
    normalTimeSec,
    timeSavedSec,
    highlightCount,
  }
}
