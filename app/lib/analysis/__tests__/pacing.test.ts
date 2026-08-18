import { describe, it, expect } from "vitest"
import { getSmoothedMultiplier, LEVEL_TO_MULTIPLIER } from "../pacing"
import type { ChunkPacing } from "../types"

function makePacings(...ranges: Array<[number, number, number]>): ChunkPacing[] {
  return ranges.map(([start, end, multiplier], i) => ({
    chunkId: i,
    startTokenId: start,
    endTokenId: end,
    slowdownMultiplier: multiplier,
  }))
}

describe("getSmoothedMultiplier", () => {
  it("returns 1.0 for empty pacings (no analysis available)", () => {
    expect(getSmoothedMultiplier(0, [])).toBe(1.0)
    expect(getSmoothedMultiplier(999, [])).toBe(1.0)
  })

  it("returns 1.0 for a chunk whose result was a failed batch (multiplier=1)", () => {
    // When fetchBatch fails, the chunk's pacing falls back to multiplier=1.
    const pacings = makePacings([0, 100, 1.0])
    expect(getSmoothedMultiplier(50, pacings)).toBe(1.0)
  })

  it("returns the chunk's multiplier when token is well inside the chunk", () => {
    const pacings = makePacings([0, 100, LEVEL_TO_MULTIPLIER.high])
    // Token 50 is in the middle, far from the boundary → no lerp
    expect(getSmoothedMultiplier(50, pacings)).toBe(LEVEL_TO_MULTIPLIER.high)
  })

  it("returns the last chunk's multiplier for token at or beyond end", () => {
    const pacings = makePacings([0, 50, 0.9], [50, 100, 0.8])
    expect(getSmoothedMultiplier(200, pacings)).toBe(0.8)
  })

  it("lerps toward next chunk's multiplier in the final LERP_WINDOW tokens", () => {
    // Chunk A: tokens 0–100, multiplier 0.9
    // Chunk B: tokens 100–200, multiplier 0.8
    // Token 95 is 5 tokens from boundary → lerp t = 1 - 5/20 = 0.75
    // Expected ≈ 0.9 + (0.8 - 0.9) * 0.75 = 0.9 - 0.075 = 0.825
    const pacings = makePacings([0, 100, 0.9], [100, 200, 0.8])
    const result = getSmoothedMultiplier(95, pacings)
    expect(result).toBeGreaterThan(0.8)
    expect(result).toBeLessThan(0.9)
    expect(result).toBeCloseTo(0.825, 2)
  })

  it("partial analysis: succeeded chunk has real multiplier, failed chunk is 1.0", () => {
    // Simulate batch 1 succeeded (chunk 0 at 0.8), batch 2 failed (chunk 1 at 1.0 default)
    const pacings = makePacings([0, 100, 0.8], [100, 200, 1.0])
    // Chunk 0: high difficulty
    expect(getSmoothedMultiplier(50, pacings)).toBe(0.8)
    // Chunk 1: failed batch → baseline
    expect(getSmoothedMultiplier(150, pacings)).toBe(1.0)
  })

  it("smoothed multiplier is always between the min and max chunk multipliers", () => {
    const pacings = makePacings([0, 100, 0.8], [100, 200, 1.0])
    for (let t = 0; t <= 200; t += 5) {
      const m = getSmoothedMultiplier(t, pacings)
      expect(m).toBeGreaterThanOrEqual(0.8)
      expect(m).toBeLessThanOrEqual(1.0)
    }
  })

  it("LEVEL_TO_MULTIPLIER values are in the expected range [0.8, 1.0]", () => {
    for (const [level, mult] of Object.entries(LEVEL_TO_MULTIPLIER)) {
      expect(mult, `${level} multiplier out of range`).toBeGreaterThanOrEqual(0.8)
      expect(mult, `${level} multiplier out of range`).toBeLessThanOrEqual(1.0)
    }
  })

  it("normal level multiplier is exactly 1.0 (baseline pacing)", () => {
    expect(LEVEL_TO_MULTIPLIER.normal).toBe(1.0)
  })

  it("very_high level multiplier is the smallest (most slowdown)", () => {
    const levels = Object.values(LEVEL_TO_MULTIPLIER)
    expect(LEVEL_TO_MULTIPLIER.very_high).toBe(Math.min(...levels))
  })
})
