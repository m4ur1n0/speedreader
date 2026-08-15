"use client"

import { useEffect, useRef } from "react"
import type { ReaderModel } from "@/app/lib/reader/types"
import { useReaderPlayer } from "@/app/lib/reader/player"
import { useAnalysis, getSmoothedMultiplier } from "@/app/lib/analysis/pacing"
import { WordDisplay } from "./WordDisplay"
import { SentenceContext } from "./SentenceContext"
import { ReaderControls } from "./ReaderControls"

interface Props {
  model: ReaderModel
  onExit: () => void
}

/**
 * Full-page reader shell.
 *
 * Layout:
 *   ┌──────────────────────────────────┐
 *   │  [progress + doc info strip]     │  ← fixed top, flex-shrink-0
 *   │                                  │
 *   │        focal word (ORP)          │  ← flex-1, vertically centered
 *   │      sentence context            │
 *   │                                  │
 *   │  [controls bar]                  │  ← fixed bottom, flex-shrink-0
 *   └──────────────────────────────────┘
 *
 * Keyboard handling uses a named dispatch table so individual keys can be
 * reassigned without touching sibling key handling:
 *
 *   Space   → currently togglePlayPause
 *             (future: startHighlight / stopHighlight)
 *   Escape  → exit
 */
export function ReaderView({ model, onExit }: Props) {
  // pacingsRef lets getMultiplier always read fresh pacing data without being
  // a reactive dependency of the player. Initialised empty → 1.0 default.
  const pacingsRef = useRef<ReturnType<typeof useAnalysis>["pacings"]>([])

  function getMultiplier(tokenId: number) {
    return getSmoothedMultiplier(tokenId, pacingsRef.current)
  }

  // Player runs first so we can pass currentTokenId to useAnalysis below.
  const [state, controls] = useReaderPlayer(model, undefined, getMultiplier)

  // Analysis is pipelined with reading: subsequent batches only fire once the
  // reader is within LOOKAHEAD_CHUNKS of the next unanalyzed region.
  const { pacings, status: analysisStatus, currentChunkResult } = useAnalysis(
    model,
    state.currentTokenId,
  )

  useEffect(() => {
    pacingsRef.current = pacings
  }, [pacings])
  const containerRef = useRef<HTMLDivElement>(null)

  // Focus the container on mount so keyboard events are captured immediately.
  useEffect(() => {
    containerRef.current?.focus()
  }, [])

  // ── Keyboard dispatch ────────────────────────────────────────────────────
  // Space is mapped to togglePlayPause here as a first-class named action.
  // A future hold-to-highlight pass will replace this mapping without
  // altering the controls interface or other key bindings.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.repeat) return
      switch (e.key) {
        case " ":
          e.preventDefault()
          controls.togglePlayPause()
          break
        case "Escape":
          e.preventDefault()
          onExit()
          break
      }
    }

    el.addEventListener("keydown", handleKeyDown)
    return () => el.removeEventListener("keydown", handleKeyDown)
  }, [controls, onExit])

  const token = model.tokens[state.currentTokenId] ?? null
  const isPaused = state.status !== "playing"
  const currentDifficulty = currentChunkResult(state.currentTokenId)

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="flex flex-col min-h-screen bg-background outline-none"
      role="application"
      aria-label="Speedreader"
    >
      {/* ── Main reading area ─────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col items-center justify-center gap-8 px-4 py-10">
        {/* Stable focal-word display */}
        <WordDisplay token={token} paused={isPaused} />

        {/* Sentence context strip */}
        <SentenceContext
          model={model}
          currentTokenId={state.currentTokenId}
          paused={isPaused}
        />
      </main>

      {/* ── Controls bar ──────────────────────────────────────────────────── */}
      <ReaderControls
        state={state}
        totalTokens={model.tokens.length}
        controls={controls}
        onExit={onExit}
        analysisStatus={analysisStatus}
        currentDifficulty={currentDifficulty}
      />
    </div>
  )
}
