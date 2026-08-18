"use client"

import { useState, useCallback, useRef } from "react"
import type { ReaderHighlight } from "../highlight/types"
import type { ParsedDocument } from "../document/types"
import type { HighlightAnalysis, HighlightAnalysisResult } from "./types"
import { normalizeHighlightRanges } from "../highlight/normalize"
import { buildHighlightContexts } from "./context"

const BATCH_SIZE = 5

export interface HighlightAnalysisControls {
  analyses: Map<string, HighlightAnalysis>
  isRunning: boolean
  startAnalysis: () => void
  retryHighlight: (highlightId: string) => void
  askFollowUp: (highlightId: string, question: string) => void
}

function buildInitialMap(highlights: ReaderHighlight[]): Map<string, HighlightAnalysis> {
  const map = new Map<string, HighlightAnalysis>()
  for (const h of highlights) {
    map.set(h.id, {
      highlightId: h.id,
      canonicalStart: h.canonicalStart,
      canonicalEnd: h.canonicalEnd,
      explanation: "",
      keyPoints: [],
      relationToReading: "",
      status: "pending",
      followUpStatus: "idle",
    })
  }
  return map
}

export function useHighlightAnalysis(
  highlights: ReaderHighlight[],
  doc: ParsedDocument
): HighlightAnalysisControls {
  const normalized = normalizeHighlightRanges(highlights)
  const [analyses, setAnalyses] = useState<Map<string, HighlightAnalysis>>(new Map())
  const [isRunning, setIsRunning] = useState(false)

  // Keep a stable ref to the latest doc to avoid stale closures in async code
  const docRef = useRef(doc)
  docRef.current = doc
  const normalizedRef = useRef(normalized)
  normalizedRef.current = normalized
  const analysesRef = useRef(analyses)
  analysesRef.current = analyses

  async function runBatch(batch: ReaderHighlight[]) {
    const contexts = buildHighlightContexts(batch, docRef.current)

    const res = await fetch("/api/analyze-highlights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: contexts }),
    })

    if (!res.ok) {
      throw new Error(`Gemini analysis request failed with status ${res.status}`)
    }

    const data: { results: HighlightAnalysisResult[] } = await res.json()
    const byId = new Map(data.results.map((r) => [r.id, r]))

    setAnalyses((prev) => {
      const next = new Map(prev)
      for (const h of batch) {
        const result = byId.get(h.id)
        const existing = next.get(h.id)
        if (!existing) continue
        if (result) {
          next.set(h.id, {
            ...existing,
            explanation: result.explanation,
            keyPoints: Array.isArray(result.keyPoints) ? result.keyPoints : [],
            relationToReading: result.relationToReading,
            status: "complete",
          })
        } else {
          next.set(h.id, { ...existing, status: "error" })
        }
      }
      return next
    })
  }

  const startAnalysis = useCallback(() => {
    if (isRunning || normalizedRef.current.length === 0) return

    const initial = buildInitialMap(normalizedRef.current)
    setAnalyses(initial)
    setIsRunning(true)

    const all = normalizedRef.current
    let batchIndex = 0

    async function processNext() {
      if (batchIndex >= all.length) {
        setIsRunning(false)
        return
      }
      const batch = all.slice(batchIndex, batchIndex + BATCH_SIZE)
      batchIndex += BATCH_SIZE

      try {
        await runBatch(batch)
      } catch {
        setAnalyses((prev) => {
          const next = new Map(prev)
          for (const h of batch) {
            const ex = next.get(h.id)
            if (ex && ex.status === "pending") {
              next.set(h.id, { ...ex, status: "error" })
            }
          }
          return next
        })
      }

      // Process next batch regardless of previous batch's success
      processNext()
    }

    processNext()
  }, [isRunning])

  const retryHighlight = useCallback((highlightId: string) => {
    const h = normalizedRef.current.find((n) => n.id === highlightId)
    if (!h) return

    setAnalyses((prev) => {
      const next = new Map(prev)
      const ex = next.get(highlightId)
      if (ex) next.set(highlightId, { ...ex, status: "pending" })
      return next
    })

    runBatch([h]).catch(() => {
      setAnalyses((prev) => {
        const next = new Map(prev)
        const ex = next.get(highlightId)
        if (ex && ex.status === "pending") {
          next.set(highlightId, { ...ex, status: "error" })
        }
        return next
      })
    })
  }, [])

  const askFollowUp = useCallback((highlightId: string, question: string) => {
    const analysis = analysesRef.current.get(highlightId)
    const h = normalizedRef.current.find((n) => n.id === highlightId)
    if (!analysis || !h || analysis.status !== "complete") return

    setAnalyses((prev) => {
      const next = new Map(prev)
      const ex = next.get(highlightId)
      if (ex) next.set(highlightId, { ...ex, followUpStatus: "loading", followUpAnswer: undefined })
      return next
    })

    const contexts = buildHighlightContexts([h], docRef.current)
    const ctx = contexts[0]

    fetch("/api/highlight-followup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        highlightId,
        highlightedText: ctx.highlightedText,
        contextBefore: ctx.contextBefore,
        contextAfter: ctx.contextAfter,
        documentTitle: ctx.documentTitle,
        existingAnalysis: {
          explanation: analysis.explanation,
          keyPoints: analysis.keyPoints,
          relationToReading: analysis.relationToReading,
        },
        question,
      }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Follow-up failed: ${res.status}`)
        return res.json() as Promise<{ answer: string }>
      })
      .then((data) => {
        setAnalyses((prev) => {
          const next = new Map(prev)
          const ex = next.get(highlightId)
          if (ex) {
            next.set(highlightId, {
              ...ex,
              followUpAnswer: data.answer,
              followUpStatus: "idle",
            })
          }
          return next
        })
      })
      .catch(() => {
        setAnalyses((prev) => {
          const next = new Map(prev)
          const ex = next.get(highlightId)
          if (ex) next.set(highlightId, { ...ex, followUpStatus: "error" })
          return next
        })
      })
  }, [])

  return { analyses, isRunning, startAnalysis, retryHighlight, askFollowUp }
}
