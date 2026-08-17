import { describe, it, expect } from "vitest"
import {
  estimateNormalReadingSeconds,
  estimateSpeedreaderSeconds,
  formatDuration,
  NORMAL_READING_WPM,
} from "../statsHelpers"
import { RAMP_START_WPM, RAMP_MAX_WPM, RAMP_DURATION_MS } from "../types"

describe("estimateNormalReadingSeconds", () => {
  it("uses NORMAL_READING_WPM baseline", () => {
    const sec = estimateNormalReadingSeconds(NORMAL_READING_WPM)
    expect(sec).toBeCloseTo(60, 0) // 250 words at 250 WPM = 1 minute
  })

  it("doubles for double the word count", () => {
    const s1 = estimateNormalReadingSeconds(1000)
    const s2 = estimateNormalReadingSeconds(2000)
    expect(s2 / s1).toBeCloseTo(2, 5)
  })
})

describe("estimateSpeedreaderSeconds", () => {
  it("result is strictly less than normal reading time for large documents", () => {
    const tokens = 5000
    const normal = estimateNormalReadingSeconds(tokens)
    const speed = estimateSpeedreaderSeconds(tokens, RAMP_MAX_WPM)
    expect(speed).toBeLessThan(normal)
  })

  it("scales proportionally above the ramp end", () => {
    // For a very large document the reader is at MAX_WPM for most of it.
    // Time ≈ N / MAX * 60 (seconds).
    const N = 50_000
    const sec = estimateSpeedreaderSeconds(N, RAMP_MAX_WPM)
    const approxLinear = (N / RAMP_MAX_WPM) * 60
    // Should be within 15% of the linear approximation at full speed.
    expect(sec).toBeGreaterThan(approxLinear * 0.85)
    expect(sec).toBeLessThan(approxLinear * 1.15)
  })

  it("higher targetMaxWpm gives shorter estimated time", () => {
    const tokens = 10_000
    const t400 = estimateSpeedreaderSeconds(tokens, 400)
    const t600 = estimateSpeedreaderSeconds(tokens, 600)
    expect(t600).toBeLessThan(t400)
  })

  it("returns a positive value for a single word", () => {
    const sec = estimateSpeedreaderSeconds(1, RAMP_MAX_WPM)
    expect(sec).toBeGreaterThan(0)
  })
})

describe("formatDuration", () => {
  it("rounds to < 2 min for short durations", () => {
    expect(formatDuration(30)).toBe("< 2 min")
    expect(formatDuration(89)).toBe("< 2 min")
  })

  it("shows minutes for mid-range durations", () => {
    const result = formatDuration(180)
    expect(result).toMatch(/3 min/)
  })

  it("shows hours for long durations", () => {
    const result = formatDuration(7200)
    expect(result).toMatch(/2h/)
  })
})
