import { RAMP_START_WPM, RAMP_MAX_WPM, RAMP_DURATION_MS } from "./types"

/**
 * Computes the effective WPM given accumulated active reading time.
 *
 * Linear ramp from startWpm to targetMaxWpm over rampDurationMs of active
 * reading (paused time does not advance the ramp).
 *
 *   0:00  → 240 WPM
 *   1:00  → ~277 WPM
 *   2:00  → ~313 WPM
 *   3:30+ → 350 WPM (capped at targetMaxWpm; manual boost can raise ceiling to 500)
 *
 * This function is pure — callers own the activeReadingMs counter.
 */
export function getEffectiveWpm(
  activeReadingMs: number,
  targetMaxWpm: number = RAMP_MAX_WPM,
  startWpm: number = RAMP_START_WPM,
  rampDurationMs: number = RAMP_DURATION_MS
): number {
  const t = Math.min(1, activeReadingMs / rampDurationMs)
  const wpm = startWpm + (targetMaxWpm - startWpm) * t
  return Math.min(wpm, targetMaxWpm)
}

/**
 * Converts a desired WPM to the activeReadingMs value that produces it
 * on the ramp. Used by setCurrentWpm to warp the ramp state.
 */
export function wpmToActiveMs(
  wpm: number,
  targetMaxWpm: number = RAMP_MAX_WPM,
  startWpm: number = RAMP_START_WPM,
  rampDurationMs: number = RAMP_DURATION_MS
): number {
  const range = targetMaxWpm - startWpm
  if (range <= 0) return 0
  const t = Math.max(0, Math.min(1, (wpm - startWpm) / range))
  return t * rampDurationMs
}
