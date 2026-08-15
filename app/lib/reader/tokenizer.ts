import type { ParsedDocument } from "../document/types"
import type { ReaderToken, ReaderModel } from "./types"
import { getFocusIndex } from "./orp"
import { computeTimingWeight } from "./timing"

function newlineCount(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\n") n++
  }
  return n
}

function isSentenceTerminator(word: string): boolean {
  // Strip closing quotes/brackets, then look for terminal punctuation.
  const core = word.replace(/['")\]>…]+$/, "")
  return /[.!?]$/.test(core) || word.endsWith("...")
}

/**
 * Builds a reader model from a parsed document.
 *
 * Tokens are every non-whitespace run in the canonical text.
 * Canonical offsets are preserved exactly; the model does not modify
 * or re-extract the document text.
 */
export function buildReaderModel(doc: ParsedDocument): ReaderModel {
  const { text } = doc
  const tokens: ReaderToken[] = []
  const sentenceFirstToken = new Map<number, number>()
  const paragraphFirstToken = new Map<number, number>()

  let sentenceId = 0
  let paragraphId = 0
  let pendingSentenceBreak = false
  let lastEnd = 0
  let idCounter = 0

  const re = /\S+/g
  let match: RegExpExecArray | null

  while ((match = re.exec(text)) !== null) {
    const start = match.index
    const word = match[0]
    const end = start + word.length

    const gap = text.slice(lastEnd, start)
    const nlCount = newlineCount(gap)

    // Determine boundary type from the gap since the last token.
    const isParaBreak = nlCount >= 2
    const isLineBreak = nlCount === 1

    if (isParaBreak) {
      paragraphId++
      sentenceId++
      pendingSentenceBreak = false
    } else if (pendingSentenceBreak) {
      sentenceId++
      pendingSentenceBreak = false
    }

    const isLineStart = isLineBreak && !isParaBreak
    const isParagraphStart = isParaBreak || idCounter === 0

    // Record first token of each boundary.
    if (!sentenceFirstToken.has(sentenceId)) {
      sentenceFirstToken.set(sentenceId, idCounter)
    }
    if (!paragraphFirstToken.has(paragraphId)) {
      paragraphFirstToken.set(paragraphId, idCounter)
    }

    tokens.push({
      id: idCounter++,
      text: word,
      canonicalStart: start,
      canonicalEnd: end,
      sentenceId,
      paragraphId,
      isSentenceEnd: isSentenceTerminator(word),
      isParagraphEnd: false, // filled in second pass
      isParagraphStart,
      isLineStart,
      timingWeight: computeTimingWeight(word),
      focusIndex: getFocusIndex(word),
    })

    pendingSentenceBreak = isSentenceTerminator(word)
    lastEnd = end
  }

  // Second pass: mark the last token of each paragraph.
  for (let i = 0; i < tokens.length; i++) {
    const next = tokens[i + 1]
    tokens[i].isParagraphEnd = !next || next.paragraphId !== tokens[i].paragraphId
  }

  const model: ReaderModel = {
    tokens,
    sentenceFirstToken,
    paragraphFirstToken,

    getSentenceStart(tokenId: number): number {
      const t = tokens[tokenId]
      if (!t) return 0
      return sentenceFirstToken.get(t.sentenceId) ?? 0
    },

    getParagraphStart(tokenId: number): number {
      const t = tokens[tokenId]
      if (!t) return 0
      return paragraphFirstToken.get(t.paragraphId) ?? 0
    },
  }

  return model
}
