"use client"

import { useEffect, useRef, useCallback, useState } from "react"
import type { ReaderModel } from "@/app/lib/reader/types"
import { useReaderPlayer } from "@/app/lib/reader/player"
import { useAnalysis, getSmoothedMultiplier } from "@/app/lib/analysis/pacing"
import { useHighlighter } from "@/app/lib/highlight/useHighlighter"
import type { ReaderHighlight } from "@/app/lib/highlight/types"
import { WordDisplay } from "./WordDisplay"
import { SentenceContext } from "./SentenceContext"
import { ReaderControls } from "./ReaderControls"
import type { ReadingMode } from "./ReaderControls"

export interface ReaderSession {
  currentTokenId: number
  highlights: ReaderHighlight[]
}

interface Props {
  model: ReaderModel
  onExit: (session: ReaderSession) => void
  initialSession?: ReaderSession | null
  initialMode?: ReadingMode
  onDownloadPdf?: ((highlights: ReaderHighlight[]) => Promise<void>) | null
}

/**
 * Full-page reader shell.
 *
 * Keyboard bindings:
 *   Space   → togglePlayPause
 *   H       → hold to highlight (keydown begins, keyup finalizes)
 *   Escape  → flush in-progress highlight, exit
 *   B       → toggle Baseline / Adaptive mode
 */
const AUTOMATIC_MAX_WPM = 350
const MANUAL_MAX_WPM_CAP = 500
const BOOST_INCREMENT = 25

export function ReaderView({ model, onExit, initialSession, initialMode, onDownloadPdf }: Props) {
  const [mode, setMode] = useState<ReadingMode>(initialMode ?? "baseline")
  const [exportError, setExportError] = useState<string | null>(null)
  const [manualSpeedBoost, setManualSpeedBoost] = useState(0)
  const manualSpeedBoostRef = useRef(0)
  manualSpeedBoostRef.current = manualSpeedBoost

  const pacingsRef = useRef<ReturnType<typeof useAnalysis>["pacings"]>([])

  function getMultiplier(tokenId: number): number {
    if (mode === "baseline") return 1.0
    return getSmoothedMultiplier(tokenId, pacingsRef.current)
  }

  const [state, controls] = useReaderPlayer(model, undefined, getMultiplier)
  const controlsRef = useRef(controls)
  controlsRef.current = controls

  const playerStateRef = useRef({ currentTokenId: 0, currentBaseWpm: 300 })
  playerStateRef.current = {
    currentTokenId: state.currentTokenId,
    currentBaseWpm: state.currentBaseWpm,
  }

  const highlighter = useHighlighter(model, playerStateRef)
  const highlighterRef = useRef(highlighter)
  highlighterRef.current = highlighter

  const onExitRef = useRef(onExit)
  onExitRef.current = onExit

  const modeRef = useRef(mode)
  modeRef.current = mode

  function handleSpeedUp() {
    const currentBoost = manualSpeedBoostRef.current
    const maxBoost = MANUAL_MAX_WPM_CAP - AUTOMATIC_MAX_WPM
    if (currentBoost >= maxBoost) return
    const newBoost = Math.min(currentBoost + BOOST_INCREMENT, maxBoost)
    const newMax = AUTOMATIC_MAX_WPM + newBoost
    setManualSpeedBoost(newBoost)
    controlsRef.current.manualBoostSpeed(BOOST_INCREMENT, newMax)
  }

  const handleSpeedUpRef = useRef(handleSpeedUp)
  handleSpeedUpRef.current = handleSpeedUp

  useEffect(() => {
    if (!initialSession) return
    if (initialSession.currentTokenId > 0) {
      controls.seekToToken(initialSession.currentTokenId)
    }
    if (initialSession.highlights.length > 0) {
      highlighter.setHighlights(initialSession.highlights)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { pacings, chunks, results, status: analysisStatus, hadErrors: analysisHadErrors, currentChunkResult } = useAnalysis(
    model,
    state.currentTokenId,
  )

  useEffect(() => {
    pacingsRef.current = pacings
  }, [pacings])

  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    containerRef.current?.focus()
  }, [])

  const buildExitSession = useCallback((): ReaderSession => {
    const h = highlighterRef.current
    const { currentTokenId } = playerStateRef.current
    let finalHighlights = [...h.highlights]

    if (h.activeHighlight && model) {
      const endTokenId = Math.min(currentTokenId, model.tokens.length - 1)
      const endToken = model.tokens[endTokenId]
      if (endToken && endTokenId >= h.activeHighlight.startTokenId) {
        finalHighlights = [
          ...finalHighlights,
          {
            id: `h_exit_${Date.now()}`,
            startTokenId: h.activeHighlight.startTokenId,
            endTokenId,
            canonicalStart: h.activeHighlight.canonicalStart,
            canonicalEnd: endToken.canonicalEnd,
          } satisfies ReaderHighlight,
        ]
      }
    }

    return { currentTokenId, highlights: finalHighlights }
  }, [model])

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
        case "h":
        case "H":
          e.preventDefault()
          highlighterRef.current.beginHighlight()
          break
        case "b":
        case "B":
          e.preventDefault()
          setMode((m) => m === "baseline" ? "adaptive" : "baseline")
          break
        case "=":
        case "+":
          e.preventDefault()
          handleSpeedUpRef.current()
          break
        case "Escape":
          e.preventDefault()
          onExitRef.current(buildExitSession())
          break
      }
    }

    function handleKeyUp(e: KeyboardEvent) {
      if (e.key === "h" || e.key === "H") {
        e.preventDefault()
        highlighterRef.current.endHighlight()
      }
    }

    function handleWindowBlur() {
      highlighterRef.current.flushHighlight()
    }

    el.addEventListener("keydown", handleKeyDown)
    el.addEventListener("keyup", handleKeyUp)
    window.addEventListener("blur", handleWindowBlur)
    return () => {
      el.removeEventListener("keydown", handleKeyDown)
      el.removeEventListener("keyup", handleKeyUp)
      window.removeEventListener("blur", handleWindowBlur)
    }
  }, [controls, buildExitSession])

  const token = model.tokens[state.currentTokenId] ?? null
  const isPaused = state.status !== "playing"
  const currentDifficulty = currentChunkResult(state.currentTokenId)

  function handleExit() {
    onExitRef.current(buildExitSession())
  }

  const canDownloadPdf = onDownloadPdf != null && highlighter.highlights.length > 0
  async function handleDownloadPdf() {
    if (!onDownloadPdf) return
    setExportError(null)
    try {
      await onDownloadPdf(highlighter.highlights)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed.")
    }
  }

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="flex flex-col min-h-screen outline-none"
      style={{ background: "var(--bg)" }}
      role="application"
      aria-label="Speedreader"
    >
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <WordDisplay token={token} paused={isPaused} />

        <div className="mt-8 w-full">
          <SentenceContext
            model={model}
            currentTokenId={state.currentTokenId}
            paused={isPaused}
            highlights={highlighter.highlights}
            activeHighlight={highlighter.activeHighlight}
          />
        </div>
      </main>

      {exportError && (
        <div
          role="alert"
          className="mx-4 mb-2 rounded-lg px-4 py-3 text-xs flex items-start gap-3"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--danger)",
            color: "var(--danger)",
          }}
        >
          <span className="flex-1">{exportError}</span>
          <button
            onClick={() => setExportError(null)}
            aria-label="Dismiss"
            style={{ color: "var(--danger)", opacity: 0.7 }}
            className="shrink-0 hover:opacity-100 transition-opacity"
          >
            ×
          </button>
        </div>
      )}

      <ReaderControls
        state={state}
        totalTokens={model.tokens.length}
        controls={controls}
        onExit={handleExit}
        analysisStatus={analysisStatus}
        analysisHadErrors={analysisHadErrors}
        currentDifficulty={currentDifficulty}
        highlightCount={highlighter.highlights.length}
        onDownloadPdf={canDownloadPdf ? handleDownloadPdf : null}
        mode={mode}
        onModeChange={setMode}
        chunks={chunks}
        pacings={pacings}
        manualSpeedBoost={manualSpeedBoost}
        onSpeedUp={handleSpeedUp}
        automaticMaxWpm={AUTOMATIC_MAX_WPM}
        manualMaxWpmCap={MANUAL_MAX_WPM_CAP}
      />
    </div>
  )
}
