import { describe, it, expect } from "vitest"
import { normalizeHighlightRanges } from "../normalize"
import type { ReaderHighlight } from "../types"

function h(id: string, cs: number, ce: number, st = 0, et = 0): ReaderHighlight {
  return { id, startTokenId: st, endTokenId: et, canonicalStart: cs, canonicalEnd: ce }
}

describe("normalizeHighlightRanges", () => {
  it("returns empty array for empty input", () => {
    expect(normalizeHighlightRanges([])).toEqual([])
  })

  it("returns a single highlight unchanged", () => {
    const hl = h("a", 0, 10)
    const result = normalizeHighlightRanges([hl])
    expect(result).toHaveLength(1)
    expect(result[0].canonicalStart).toBe(0)
    expect(result[0].canonicalEnd).toBe(10)
  })

  it("preserves non-overlapping highlights as separate ranges", () => {
    const result = normalizeHighlightRanges([h("a", 0, 5), h("b", 10, 20)])
    expect(result).toHaveLength(2)
    expect(result[0].canonicalStart).toBe(0)
    expect(result[0].canonicalEnd).toBe(5)
    expect(result[1].canonicalStart).toBe(10)
    expect(result[1].canonicalEnd).toBe(20)
  })

  it("merges fully overlapping highlights into one range", () => {
    const result = normalizeHighlightRanges([h("a", 0, 20), h("b", 5, 15)])
    expect(result).toHaveLength(1)
    expect(result[0].canonicalStart).toBe(0)
    expect(result[0].canonicalEnd).toBe(20)
  })

  it("merges partially overlapping highlights", () => {
    const result = normalizeHighlightRanges([h("a", 0, 10), h("b", 8, 20)])
    expect(result).toHaveLength(1)
    expect(result[0].canonicalStart).toBe(0)
    expect(result[0].canonicalEnd).toBe(20)
  })

  it("merges adjacent highlights (end == start)", () => {
    const result = normalizeHighlightRanges([h("a", 0, 10), h("b", 10, 20)])
    expect(result).toHaveLength(1)
    expect(result[0].canonicalStart).toBe(0)
    expect(result[0].canonicalEnd).toBe(20)
  })

  it("merged range keeps the id of the first constituent", () => {
    const result = normalizeHighlightRanges([h("first", 0, 10), h("second", 5, 15)])
    expect(result[0].id).toBe("first")
  })

  it("preserves input order independence — same result regardless of input order", () => {
    const a = h("a", 5, 15)
    const b = h("b", 0, 10)
    const r1 = normalizeHighlightRanges([a, b])
    const r2 = normalizeHighlightRanges([b, a])
    expect(r1).toHaveLength(1)
    expect(r2).toHaveLength(1)
    expect(r1[0].canonicalStart).toBe(r2[0].canonicalStart)
    expect(r1[0].canonicalEnd).toBe(r2[0].canonicalEnd)
  })

  it("merges three overlapping highlights into one", () => {
    const result = normalizeHighlightRanges([
      h("a", 0, 10),
      h("b", 8, 18),
      h("c", 15, 25),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].canonicalStart).toBe(0)
    expect(result[0].canonicalEnd).toBe(25)
  })

  it("all merged ranges have start < end (no zero-length or inverted ranges)", () => {
    const highlights = [
      h("a", 0, 5),
      h("b", 3, 10),
      h("c", 20, 30),
      h("d", 25, 35),
    ]
    for (const r of normalizeHighlightRanges(highlights)) {
      expect(r.canonicalStart).toBeLessThan(r.canonicalEnd)
    }
  })

  it("does not mutate the input array", () => {
    const input = [h("a", 5, 10), h("b", 0, 7)]
    const original = input.map((x) => ({ ...x }))
    normalizeHighlightRanges(input)
    for (let i = 0; i < input.length; i++) {
      expect(input[i]).toEqual(original[i])
    }
  })
})
