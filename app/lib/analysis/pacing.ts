"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import type { ReaderModel } from "@/app/lib/reader/types"
import type { AnalysisChunk, ChunkDifficultyResult, ChunkPacing, AnalysisStatus, DifficultyLevel } from "./types"
import { buildAnalysisChunks } from "./chunker"

export const LEVEL_TO_MULTIPLIER: Record<DifficultyLevel, number> = {
  normal: 1.00,
  mild: 0.96,
  moderate: 0.91,
  high: 0.86,
  very_high: 0.80,
}

/** Number of tokens over which to lerp between adjacent chunk multipliers. */
const LERP_WINDOW = 20

/** Max chunks per Gemini request — keeps payloads manageable. */
const BATCH_SIZE = 8

/**
 * The async loop starts fetching the next batch when the reader is within
 * this many chunks of the batch's first chunk. At ~175 words/chunk and
 * 300 WPM a chunk takes ~35 s, so 4 chunks = ~140 s of lead time.
 */
const LOOKAHEAD_CHUNKS = 4

export function getSmoothedMultiplier(tokenId: number, pacings: ChunkPacing[]): number {
  if (pacings.length === 0) return 1.0

  const idx = pacings.findIndex((p) => tokenId >= p.startTokenId && tokenId < p.endTokenId)
  if (idx === -1) {
    return pacings[pacings.length - 1].slowdownMultiplier
  }

  const current = pacings[idx]
  const next = pacings[idx + 1]

  if (!next) return current.slowdownMultiplier

  const tokensUntilBoundary = current.endTokenId - tokenId
  if (tokensUntilBoundary > LERP_WINDOW) return current.slowdownMultiplier

  const t = 1 - tokensUntilBoundary / LERP_WINDOW
  return current.slowdownMultiplier + (next.slowdownMultiplier - current.slowdownMultiplier) * t
}

function chunksToPacings(chunks: AnalysisChunk[], resultById: Map<number, ChunkDifficultyResult>): ChunkPacing[] {
  return chunks.map((chunk) => {
    const result = resultById.get(chunk.id)
    const multiplier = result ? LEVEL_TO_MULTIPLIER[result.level] : 1.0
    return {
      chunkId: chunk.id,
      startTokenId: chunk.startTokenId,
      endTokenId: chunk.endTokenId,
      slowdownMultiplier: multiplier,
    }
  })
}

async function fetchBatch(
  batch: AnalysisChunk[],
  signal: AbortSignal
): Promise<ChunkDifficultyResult[]> {
  const attempt = async () => {
    const res = await fetch("/api/analyze-difficulty", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chunks: batch }),
      signal,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(`[analysis] route error: ${JSON.stringify(err)}`)
    }
    const { results }: { results: ChunkDifficultyResult[] } = await res.json()
    return results
  }

  try {
    return await attempt()
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err
    console.warn("[analysis] batch failed, retrying:", err)
    return await attempt()
  }
}

/**
 * Hook: triggers Gemini analysis pipelined with reading progress.
 *
 * Accepts currentTokenId so batches are gated on reader position:
 *   - First batch fires immediately (needed before reading starts).
 *   - Each subsequent batch starts once the reader is within LOOKAHEAD_CHUNKS
 *     of the next unanalyzed region, giving Gemini time to respond before
 *     the reader arrives at that content.
 *   - A failed batch (after one retry) defaults those chunks to 1.0 and
 *     the pipeline continues.
 */
export function useAnalysis(
  model: ReaderModel | null,
  currentTokenId: number,
): {
  pacings: ChunkPacing[]
  chunks: AnalysisChunk[]
  results: ChunkDifficultyResult[]
  status: AnalysisStatus
  currentChunkResult: (tokenId: number) => ChunkDifficultyResult | null
} {
  const [pacings, setPacings] = useState<ChunkPacing[]>([])
  const [chunks, setChunks] = useState<AnalysisChunk[]>([])
  const [results, setResults] = useState<ChunkDifficultyResult[]>([])
  const [status, setStatus] = useState<AnalysisStatus>("idle")
  const abortRef = useRef<AbortController | null>(null)

  // Shared between the async run loop and the position-tracking effect.
  // The loop registers a callback here when waiting for the reader to advance;
  // the effect fires it on every token change.
  const currentTokenIdRef = useRef(currentTokenId)
  const onPositionAdvanceRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    currentTokenIdRef.current = currentTokenId
    onPositionAdvanceRef.current?.()
  }, [currentTokenId])

  useEffect(() => {
    if (!model) {
      setPacings([])
      setChunks([])
      setResults([])
      setStatus("idle")
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    onPositionAdvanceRef.current = null
    setStatus("pending")
    setPacings([])
    setResults([])

    const built = buildAnalysisChunks(model)
    setChunks(built)

    async function run() {
      const allResultsById = new Map<number, ChunkDifficultyResult>()
      let anyBatchFailed = false

      function readerChunkIdx(): number {
        const tid = currentTokenIdRef.current
        const i = built.findIndex((c) => tid >= c.startTokenId && tid < c.endTokenId)
        return i === -1 ? built.length - 1 : i
      }

      /**
       * Resolves once the reader is within LOOKAHEAD_CHUNKS of batchChunkIdx.
       * Registers a callback on onPositionAdvanceRef so the position effect
       * wakes it up on each token advance — no polling.
       */
      function waitUntilNeeded(batchChunkIdx: number): Promise<void> {
        return new Promise((resolve) => {
          const check = () => {
            if (controller.signal.aborted) {
              resolve()
              return
            }
            if (readerChunkIdx() + LOOKAHEAD_CHUNKS >= batchChunkIdx) {
              onPositionAdvanceRef.current = null
              resolve()
            } else {
              // Re-register for the next token advance.
              onPositionAdvanceRef.current = check
            }
          }
          check()
        })
      }

      for (let i = 0; i < built.length; i += BATCH_SIZE) {
        if (controller.signal.aborted) return

        await waitUntilNeeded(i)
        if (controller.signal.aborted) return

        const batch = built.slice(i, i + BATCH_SIZE)
        try {
          const batchResults = await fetchBatch(batch, controller.signal)
          for (const r of batchResults) {
            allResultsById.set(r.id, r)
          }
        } catch (err) {
          if ((err as Error).name === "AbortError") return
          console.error("[analysis] batch error (chunks default to 1.0):", err)
          anyBatchFailed = true
        }

        const snapshot = new Map(allResultsById)
        setPacings(chunksToPacings(built, snapshot))
        setResults(Array.from(snapshot.values()))
      }

      setStatus(anyBatchFailed && allResultsById.size === 0 ? "error" : "done")
    }

    run()

    return () => {
      controller.abort()
      onPositionAdvanceRef.current = null
    }
  }, [model])

  const currentChunkResult = useCallback(
    (tokenId: number): ChunkDifficultyResult | null => {
      const chunk = chunks.find((c) => tokenId >= c.startTokenId && tokenId < c.endTokenId)
      if (!chunk) return null
      return results.find((r) => r.id === chunk.id) ?? null
    },
    [chunks, results]
  )

  return { pacings, chunks, results, status, currentChunkResult }
}
