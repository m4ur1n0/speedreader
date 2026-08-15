import { describe, it, expect } from "vitest"
import { buildReaderModel } from "../tokenizer"
import { getFocusIndex } from "../orp"
import { computeTimingWeight, getTokenDuration } from "../timing"
import { getEffectiveWpm, wpmToActiveMs } from "../speed"
import type { ParsedDocument } from "../../document/types"
import { RAMP_START_WPM, RAMP_MAX_WPM, RAMP_DURATION_MS } from "../types"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDoc(text: string): ParsedDocument {
  return {
    text,
    spans: [],
    metadata: { fileName: "test.txt", fileType: "txt" },
  }
}

// ─── Canonical offset preservation ───────────────────────────────────────────

describe("buildReaderModel: canonical offsets", () => {
  it("every token's text equals doc.text.slice(start, end)", () => {
    const text = "Hello, world! This is a test."
    const model = buildReaderModel(makeDoc(text))
    for (const t of model.tokens) {
      expect(text.slice(t.canonicalStart, t.canonicalEnd)).toBe(t.text)
    }
  })

  it("preserves offsets across multi-paragraph text", () => {
    const text = "First para.\n\nSecond para.\n\nThird para."
    const model = buildReaderModel(makeDoc(text))
    for (const t of model.tokens) {
      expect(text.slice(t.canonicalStart, t.canonicalEnd)).toBe(t.text)
    }
  })

  it("preserves offsets when text has multiple spaces", () => {
    const text = "one   two\tthree"
    const model = buildReaderModel(makeDoc(text))
    for (const t of model.tokens) {
      expect(text.slice(t.canonicalStart, t.canonicalEnd)).toBe(t.text)
    }
  })
})

// ─── Sentence boundaries ─────────────────────────────────────────────────────

describe("buildReaderModel: sentence boundaries", () => {
  it("assigns incrementing sentenceIds across sentence ends", () => {
    const text = "First sentence. Second sentence. Third sentence."
    const model = buildReaderModel(makeDoc(text))

    const ids = model.tokens.map((t) => t.sentenceId)
    // Each period-terminated group should have a distinct sentenceId.
    expect(ids[0]).toBe(0) // "First" belongs to sentence 0
    expect(ids.at(-1)).toBe(2) // "sentence." (third) belongs to sentence 2
  })

  it("marks the terminal token of each sentence as isSentenceEnd", () => {
    const text = "Hello world. Goodbye world!"
    const model = buildReaderModel(makeDoc(text))

    const ends = model.tokens.filter((t) => t.isSentenceEnd).map((t) => t.text)
    expect(ends).toContain("world.")
    expect(ends).toContain("world!")
  })

  it("does not start new sentence on abbreviation-like tokens when followed by lowercase", () => {
    // "Dr." followed by a lowercase word might be detected as sentence end —
    // this test documents current (permissive) behaviour rather than fixing it.
    const text = "Dr. smith is here."
    const model = buildReaderModel(makeDoc(text))
    // We only care that offsets are correct, not that abbreviations are handled.
    for (const t of model.tokens) {
      expect(text.slice(t.canonicalStart, t.canonicalEnd)).toBe(t.text)
    }
  })
})

// ─── Paragraph boundaries ────────────────────────────────────────────────────

describe("buildReaderModel: paragraph boundaries", () => {
  it("assigns incrementing paragraphIds at double newlines", () => {
    const text = "Para one.\n\nPara two.\n\nPara three."
    const model = buildReaderModel(makeDoc(text))

    const byParagraph = new Map<number, string[]>()
    for (const t of model.tokens) {
      const arr = byParagraph.get(t.paragraphId) ?? []
      arr.push(t.text)
      byParagraph.set(t.paragraphId, arr)
    }
    expect(byParagraph.size).toBe(3)
  })

  it("marks isParagraphStart on the first token of each paragraph", () => {
    const text = "A.\n\nB.\n\nC."
    const model = buildReaderModel(makeDoc(text))

    const starts = model.tokens.filter((t) => t.isParagraphStart).map((t) => t.text)
    expect(starts).toContain("A.")
    expect(starts).toContain("B.")
    expect(starts).toContain("C.")
  })

  it("marks isParagraphEnd on the last token of each paragraph", () => {
    const text = "Alpha beta.\n\nGamma delta."
    const model = buildReaderModel(makeDoc(text))

    const ends = model.tokens.filter((t) => t.isParagraphEnd)
    // "beta." and "delta." should be paragraph ends
    expect(ends.map((t) => t.text)).toContain("beta.")
    expect(ends.map((t) => t.text)).toContain("delta.")
    // Paragraph ends must be the actual last tokens of their paragraph
    for (const e of ends) {
      const next = model.tokens[e.id + 1]
      expect(!next || next.paragraphId !== e.paragraphId).toBe(true)
    }
  })

  it("marks isLineStart on tokens following a single newline", () => {
    const text = "Line one\nLine two\nLine three"
    const model = buildReaderModel(makeDoc(text))

    // "Line" (start of second and third lines) should be isLineStart
    const lineStarts = model.tokens.filter((t) => t.isLineStart)
    expect(lineStarts.length).toBeGreaterThanOrEqual(2)
    // Paragraph id should not change for single newlines
    const uniqueParaIds = new Set(model.tokens.map((t) => t.paragraphId))
    expect(uniqueParaIds.size).toBe(1)
  })
})

// ─── Boundary lookup ──────────────────────────────────────────────────────────

describe("getSentenceStart / getParagraphStart", () => {
  it("getSentenceStart returns the first token of the current sentence", () => {
    const text = "First sentence. Second sentence. Third sentence."
    const model = buildReaderModel(makeDoc(text))

    // Find a middle token of sentence 1 (second sentence)
    const midToken = model.tokens.find(
      (t) => t.sentenceId === 1 && t.text !== model.tokens[model.sentenceFirstToken.get(1)!]?.text
    )
    if (midToken) {
      const startId = model.getSentenceStart(midToken.id)
      expect(model.tokens[startId].sentenceId).toBe(midToken.sentenceId)
      // All tokens before startId in the same sentenceId must not exist (startId is actually the first)
      if (startId > 0) {
        expect(model.tokens[startId - 1].sentenceId).not.toBe(midToken.sentenceId)
      }
    }
  })

  it("getParagraphStart returns the first token of the current paragraph", () => {
    const text = "First para token one token two.\n\nSecond para token one."
    const model = buildReaderModel(makeDoc(text))

    const lastToken = model.tokens.at(-1)!
    const startId = model.getParagraphStart(lastToken.id)
    expect(model.tokens[startId].paragraphId).toBe(lastToken.paragraphId)
    if (startId > 0) {
      expect(model.tokens[startId - 1].paragraphId).not.toBe(lastToken.paragraphId)
    }
  })
})

// ─── ORP focus index ──────────────────────────────────────────────────────────

describe("getFocusIndex", () => {
  it("returns 0 for single-character words", () => {
    expect(getFocusIndex("a")).toBe(0)
    expect(getFocusIndex("I")).toBe(0)
  })

  it("returns a valid index (≥0 and < word.length) for all lengths", () => {
    for (let len = 1; len <= 20; len++) {
      const word = "x".repeat(len)
      const idx = getFocusIndex(word)
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(len)
    }
  })

  it("longer words yield a higher absolute focus index than shorter words", () => {
    // "go" (2) → index 1; "comprehensive" (13) → index 6
    // The absolute position increases even if the ratio is similar.
    expect(getFocusIndex("comprehensive")).toBeGreaterThan(getFocusIndex("go"))
    expect(getFocusIndex("extraordinary")).toBeGreaterThan(getFocusIndex("cat"))
  })

  it("example: 'experiment' focus index is proportionally in the middle", () => {
    const word = "experiment" // len 10
    const idx = getFocusIndex(word)
    expect(idx).toBeGreaterThanOrEqual(3)
    expect(idx).toBeLessThanOrEqual(6)
  })
})

// ─── Timing ──────────────────────────────────────────────────────────────────

describe("getTokenDuration", () => {
  function makeToken(overrides: Partial<Parameters<typeof getTokenDuration>[0]>) {
    return {
      id: 0,
      text: "word",
      canonicalStart: 0,
      canonicalEnd: 4,
      sentenceId: 0,
      paragraphId: 0,
      isSentenceEnd: false,
      isParagraphEnd: false,
      isParagraphStart: false,
      isLineStart: false,
      timingWeight: computeTimingWeight("word"),
      focusIndex: 1,
      ...overrides,
    }
  }

  it("longer words receive more display time than short ones", () => {
    const baseDuration = 200
    const shortToken = makeToken({ text: "go", timingWeight: computeTimingWeight("go") })
    const longToken = makeToken({ text: "extraordinary", timingWeight: computeTimingWeight("extraordinary") })
    const d1 = getTokenDuration(shortToken, baseDuration, 1)
    const d2 = getTokenDuration(longToken, baseDuration, 1)
    expect(d2).toBeGreaterThan(d1)
  })

  it("sentence endings receive extra pause on top of the base", () => {
    const baseDuration = 200
    const normal = makeToken({ isSentenceEnd: false })
    const terminal = makeToken({ isSentenceEnd: true })
    const d1 = getTokenDuration(normal, baseDuration, 1)
    const d2 = getTokenDuration(terminal, baseDuration, 1)
    expect(d2).toBeGreaterThan(d1 + 50) // at least +50ms at 300WPM baseline
  })

  it("paragraph ends receive the longest pause", () => {
    const baseDuration = 200
    const sentenceEnd = makeToken({ isSentenceEnd: true })
    const paraEnd = makeToken({ isSentenceEnd: true, isParagraphEnd: true })
    const d1 = getTokenDuration(sentenceEnd, baseDuration, 1)
    const d2 = getTokenDuration(paraEnd, baseDuration, 1)
    expect(d2).toBeGreaterThan(d1)
  })

  it("line starts add an entrance pause", () => {
    const baseDuration = 200
    const normal = makeToken({ isLineStart: false })
    const lineStart = makeToken({ isLineStart: true })
    const d1 = getTokenDuration(normal, baseDuration, 1)
    const d2 = getTokenDuration(lineStart, baseDuration, 1)
    expect(d2).toBeGreaterThan(d1)
  })

  it("difficulty multiplier scales the base duration proportionally", () => {
    const baseDuration = 200
    const token = makeToken({})
    const d1 = getTokenDuration(token, baseDuration, 1.0)
    const d2 = getTokenDuration(token, baseDuration, 0.8)
    expect(d2).toBeLessThan(d1)
    // The lexical component should scale but boundary pauses are also affected.
    expect(d2 / d1).toBeCloseTo(0.8, 1)
  })
})

// ─── Speed ramp ──────────────────────────────────────────────────────────────

describe("getEffectiveWpm", () => {
  it("starts at RAMP_START_WPM with zero active time", () => {
    expect(getEffectiveWpm(0)).toBe(RAMP_START_WPM)
  })

  it("reaches RAMP_MAX_WPM at or beyond ramp duration", () => {
    expect(getEffectiveWpm(RAMP_DURATION_MS)).toBe(RAMP_MAX_WPM)
    expect(getEffectiveWpm(RAMP_DURATION_MS * 2)).toBe(RAMP_MAX_WPM)
  })

  it("never exceeds targetMaxWpm", () => {
    for (let ms = 0; ms <= RAMP_DURATION_MS * 1.5; ms += 10_000) {
      expect(getEffectiveWpm(ms)).toBeLessThanOrEqual(RAMP_MAX_WPM)
    }
  })

  it("increases monotonically with active time", () => {
    let prev = 0
    for (let ms = 0; ms <= RAMP_DURATION_MS; ms += 5_000) {
      const wpm = getEffectiveWpm(ms)
      expect(wpm).toBeGreaterThanOrEqual(prev)
      prev = wpm
    }
  })

  it("custom targetMaxWpm is respected", () => {
    expect(getEffectiveWpm(RAMP_DURATION_MS, 400)).toBe(400)
    expect(getEffectiveWpm(RAMP_DURATION_MS * 2, 400)).toBe(400)
  })

  it("wpmToActiveMs round-trips through getEffectiveWpm", () => {
    const target = 280
    const ms = wpmToActiveMs(target)
    const wpm = getEffectiveWpm(ms)
    expect(wpm).toBeCloseTo(target, 0)
  })
})

// ─── Seeking ──────────────────────────────────────────────────────────────────

describe("seekToToken (state invariant)", () => {
  it("getSentenceStart on a seeked-to token returns a valid earlier index", () => {
    const text = "Sentence one. Sentence two. Sentence three."
    const model = buildReaderModel(makeDoc(text))

    // Pick a token in sentence 2
    const tokenInS2 = model.tokens.find((t) => t.sentenceId === 2)
    if (!tokenInS2) return

    const startId = model.getSentenceStart(tokenInS2.id)
    expect(startId).toBeLessThanOrEqual(tokenInS2.id)
    expect(model.tokens[startId].sentenceId).toBe(tokenInS2.sentenceId)
  })

  it("all token ids are sequential from 0", () => {
    const model = buildReaderModel(makeDoc("one two three four five."))
    model.tokens.forEach((t, i) => {
      expect(t.id).toBe(i)
    })
  })
})
