import type { ReaderModel } from "@/app/lib/reader/types"
import type { AnalysisChunk } from "./types"

const CHUNK_MIN_WORDS = 100
const CHUNK_MAX_WORDS = 250

/**
 * Splits a ReaderModel into analysis chunks for Gemini scoring.
 *
 * Rules (in priority order):
 *  1. Never split mid-sentence — always complete the current sentence first.
 *  2. Hard cap at CHUNK_MAX_WORDS — paragraph preference yields to this.
 *  3. Prefer closing at a paragraph boundary once CHUNK_MIN_WORDS is reached.
 *  4. Fall back to sentence boundary once CHUNK_MIN_WORDS is reached.
 */
export function buildAnalysisChunks(model: ReaderModel): AnalysisChunk[] {
  const { tokens } = model
  if (tokens.length === 0) return []

  const chunks: AnalysisChunk[] = []
  let chunkStart = 0
  let chunkId = 0

  function pushChunk(endExclusive: number) {
    if (endExclusive <= chunkStart) return
    const chunkTokens = tokens.slice(chunkStart, endExclusive)
    const text = chunkTokens.map((t) => t.text).join(" ")
    chunks.push({ id: chunkId++, startTokenId: chunkStart, endTokenId: endExclusive, text })
    chunkStart = endExclusive
  }

  for (let i = 0; i < tokens.length; i++) {
    const wordCount = i - chunkStart + 1
    const token = tokens[i]
    const isLast = i === tokens.length - 1

    if (isLast) {
      pushChunk(i + 1)
      break
    }

    // Hard cap — close regardless of sentence position.
    if (wordCount >= CHUNK_MAX_WORDS && token.isSentenceEnd) {
      pushChunk(i + 1)
      continue
    }

    if (wordCount < CHUNK_MIN_WORDS) continue

    // Prefer paragraph boundary.
    if (token.isParagraphEnd) {
      pushChunk(i + 1)
      continue
    }

    // Accept sentence boundary if no paragraph boundary found yet.
    if (token.isSentenceEnd) {
      pushChunk(i + 1)
      continue
    }
  }

  return chunks
}
