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
 * Returns the smoothed slowdown multiplier for a given token.
 *
 * Within the bulk of a chunk: the chunk's own multiplier.
 * Within LERP_WINDOW tokens before a chunk boundary: linearly interpolates
 * toward the next chunk's multiplier.
 */
export function getSmoothedMultiplier(tokenId: number, pacings: ChunkPacing[]): number {
  if (pacings.length === 0) return 1.0

  const idx = pacings.findIndex((p) => tokenId >= p.startTokenId && tokenId < p.endTokenId)
  if (idx === -1) {
    // Past the last chunk — use last chunk's multiplier.
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
    // One retry.
    console.warn("[analysis] batch failed, retrying:", err)
    return await attempt()
  }
}

/**
 * Hook: triggers Gemini analysis for a model and returns pacing data.
 *
 * - Analysis fires once per model instance (when the hook mounts or model changes).
 * - Chunks are processed in batches of BATCH_SIZE; pacings update incrementally.
 * - The reader is usable immediately; unanalyzed chunks default to 1.0 multiplier.
 * - A failed batch defaults those chunks to 1.0 without blocking later batches.
 */
export function useAnalysis(model: ReaderModel | null): {
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

    setStatus("pending")
    setPacings([])
    setResults([])

    const built = buildAnalysisChunks(model)
    setChunks(built)

    async function run() {
      // Accumulated results across all batches, keyed by chunk ID.
      const allResultsById = new Map<number, ChunkDifficultyResult>()
      let anyBatchFailed = false

      for (let i = 0; i < built.length; i += BATCH_SIZE) {
        if (controller.signal.aborted) return
        const batch = built.slice(i, i + BATCH_SIZE)

        try {
          const batchResults = await fetchBatch(batch, controller.signal)
          for (const r of batchResults) {
            allResultsById.set(r.id, r)
          }
        } catch (err) {
          if ((err as Error).name === "AbortError") return
          console.error("[analysis] batch error (chunks will default to 1.0):", err)
          anyBatchFailed = true
          // Continue — successful previous batches remain useful.
        }

        // Apply partial results after each batch so pacing updates progressively.
        const snapshot = new Map(allResultsById)
        setPacings(chunksToPacings(built, snapshot))
        setResults(Array.from(snapshot.values()))
      }

      setStatus(anyBatchFailed && allResultsById.size === 0 ? "error" : "done")
    }

    run()

    return () => {
      controller.abort()
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
