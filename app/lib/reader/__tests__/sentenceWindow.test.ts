import { describe, it, expect } from "vitest"
import { buildReaderModel } from "../tokenizer"
import type { ParsedDocument } from "../../document/types"

/**
 * Regression tests for the SentenceContext sliding-window invariant.
 *
 * The core invariant:
 *   For any currentTokenId, the sliding window [windowStart, windowStart+CONTEXT_TOTAL)
 *   must contain currentTokenId, regardless of how far into the sentence we are.
 *
 * This mirrors the fix applied to SentenceContext.tsx (adding currentTokenId
 * to useMemo deps + sliding window anchored on currentTokenId).
 */

const CONTEXT_BEFORE = 20
const CONTEXT_TOTAL = 60

function makeDoc(text: string): ParsedDocument {
  return { text, spans: [], metadata: { fileName: "test.txt", fileType: "txt" } }
}

function simulateWindow(model: ReturnType<typeof buildReaderModel>, currentTokenId: number) {
  const currentToken = model.tokens[currentTokenId]
  if (!currentToken) return null

  const { sentenceId } = currentToken
  const sentenceStart = model.sentenceFirstToken.get(sentenceId) ?? 0
  const windowStart = Math.max(sentenceStart, currentTokenId - CONTEXT_BEFORE)

  const result: number[] = []
  for (let i = windowStart; i < model.tokens.length; i++) {
    if (model.tokens[i].sentenceId !== sentenceId) break
    result.push(model.tokens[i].id)
    if (result.length >= CONTEXT_TOTAL) break
  }
  return result
}

describe("SentenceContext sliding window invariant", () => {
  it("always contains currentTokenId regardless of position within a long sentence", () => {
    // Build a very long single sentence (no periods) of 120 words.
    const words = Array.from({ length: 120 }, (_, i) => `word${i}`)
    const text = words.join(" ")
    const model = buildReaderModel(makeDoc(text))

    // The entire document is one sentence. Check every token position.
    for (let id = 0; id < model.tokens.length; id++) {
      const window = simulateWindow(model, id)!
      expect(window).toContain(id)
    }
  })

  it("window is bounded by the current sentence", () => {
    const s1 = Array.from({ length: 30 }, (_, i) => `one${i}`).join(" ") + "."
    const s2 = Array.from({ length: 30 }, (_, i) => `two${i}`).join(" ") + "."
    const model = buildReaderModel(makeDoc(`${s1} ${s2}`))

    for (let id = 0; id < model.tokens.length; id++) {
      const currentToken = model.tokens[id]
      const window = simulateWindow(model, id)!
      for (const wid of window) {
        expect(model.tokens[wid].sentenceId).toBe(currentToken.sentenceId)
      }
    }
  })

  it("window starts at sentence start when current is near the beginning", () => {
    const words = Array.from({ length: 80 }, (_, i) => `w${i}`).join(" ")
    const model = buildReaderModel(makeDoc(words))

    // At token 5, window should start at 0 (sentence start).
    const window = simulateWindow(model, 5)!
    expect(window[0]).toBe(0)
  })

  it("window slides forward when current is far into a long sentence", () => {
    const words = Array.from({ length: 100 }, (_, i) => `w${i}`).join(" ")
    const model = buildReaderModel(makeDoc(words))

    // At token 80, the old fixed-start window would show tokens 0-59.
    // The sliding window should start at max(0, 80 - CONTEXT_BEFORE) = 60.
    const window = simulateWindow(model, 80)!
    expect(window).toContain(80)
    expect(window[0]).toBe(80 - CONTEXT_BEFORE) // 60
  })
})
