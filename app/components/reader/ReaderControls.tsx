"use client"

import type { PlayerState } from "@/app/lib/reader/types"
import type { ReaderControls as Controls } from "@/app/lib/reader/player"
import type { AnalysisStatus, ChunkDifficultyResult, AnalysisChunk, ChunkPacing } from "@/app/lib/analysis/types"
import { LEVEL_TO_MULTIPLIER } from "@/app/lib/analysis/pacing"
import { formatDuration, estimateNormalReadingSeconds, NORMAL_READING_WPM } from "@/app/lib/reader/statsHelpers"

export type ReadingMode = "baseline" | "adaptive"

interface Props {
  state: PlayerState
  totalTokens: number
  controls: Controls
  onExit: () => void
  analysisStatus: AnalysisStatus
  currentDifficulty: ChunkDifficultyResult | null
  highlightCount: number
  onDownloadPdf?: (() => void) | null
  mode: ReadingMode
  onModeChange: (m: ReadingMode) => void
  chunks: AnalysisChunk[]
  pacings: ChunkPacing[]
}

const LEVEL_COLOR: Record<string, string> = {
  normal: "bg-green-400/40",
  mild: "bg-lime-400/40",
  moderate: "bg-yellow-400/40",
  high: "bg-orange-400/40",
  very_high: "bg-red-400/50",
}

const LEVEL_TEXT: Record<string, string> = {
  normal: "text-green-600 dark:text-green-400",
  mild: "text-lime-600 dark:text-lime-400",
  moderate: "text-yellow-600 dark:text-yellow-400",
  high: "text-orange-600 dark:text-orange-400",
  very_high: "text-red-600 dark:text-red-400",
}

const LEVEL_LABEL: Record<string, string> = {
  normal: "Normal",
  mild: "Mild",
  moderate: "Moderate",
  high: "High",
  very_high: "Very High",
}

export function ReaderControls({
  state,
  totalTokens,
  controls,
  onExit,
  analysisStatus,
  currentDifficulty,
  highlightCount,
  onDownloadPdf,
  mode,
  onModeChange,
  chunks,
  pacings,
}: Props) {
  const { status, currentTokenId, currentBaseWpm, activeReadingMs } = state
  const isPlaying = status === "playing"
  const isFinished = status === "finished"

  const progressPct = totalTokens > 0
    ? Math.min(100, (currentTokenId / totalTokens) * 100)
    : 0

  const multiplier = currentDifficulty ? LEVEL_TO_MULTIPLIER[currentDifficulty.level] : 1.0
  const effectiveWpm =
    mode === "adaptive" && multiplier < 1
      ? Math.round(currentBaseWpm * multiplier)
      : currentBaseWpm
  const isSlowed = mode === "adaptive" && multiplier < 0.99

  // ── Estimated time remaining ────────────────────────────────────────────────
  const wordsRemaining = Math.max(0, totalTokens - currentTokenId)
  const estRemSec = effectiveWpm > 0 ? (wordsRemaining / effectiveWpm) * 60 : 0

  // ── Session stats ───────────────────────────────────────────────────────────
  const activeReadingSec = activeReadingMs / 1000
  const avgWpm = activeReadingMs > 0
    ? Math.round((currentTokenId / activeReadingMs) * 60_000)
    : currentBaseWpm

  // ── Difficulty marks for progress bar ──────────────────────────────────────
  // Show a subtle colored mark for each chunk rated above "normal".
  const difficultyMarks = pacings
    .filter((p) => {
      const chunk = chunks.find((c) => c.id === p.chunkId)
      return chunk && p.slowdownMultiplier < 0.99
    })
    .map((p) => {
      const chunk = chunks.find((c) => c.id === p.chunkId)!
      const startPct = (chunk.startTokenId / totalTokens) * 100
      const widthPct = ((chunk.endTokenId - chunk.startTokenId) / totalTokens) * 100
      const level = p.slowdownMultiplier >= 0.95
        ? "mild"
        : p.slowdownMultiplier >= 0.90
        ? "moderate"
        : p.slowdownMultiplier >= 0.85
        ? "high"
        : "very_high"
      return { startPct, widthPct, level }
    })

  return (
    <div className="w-full flex flex-col gap-3 px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 bg-background">

      {/* ── Progress bar with difficulty marks ─────────────────────────────── */}
      <div className="relative h-1.5 w-full rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
        {/* Difficulty region marks (drawn before the progress fill) */}
        {difficultyMarks.map((m, i) => (
          <div
            key={i}
            className={`absolute inset-y-0 ${LEVEL_COLOR[m.level] ?? "bg-orange-400/40"}`}
            style={{ left: `${m.startPct.toFixed(2)}%`, width: `${m.widthPct.toFixed(2)}%` }}
            aria-hidden="true"
          />
        ))}
        <div
          className="absolute inset-y-0 left-0 bg-blue-500 rounded-full transition-all duration-75"
          style={{ width: `${progressPct.toFixed(1)}%` }}
          role="progressbar"
          aria-valuenow={Math.round(progressPct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Reading progress"
        />
      </div>

      {/* ── Main controls row ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        {/* Left: WPM + position */}
        <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums flex-wrap">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {effectiveWpm} <span className="font-normal">WPM</span>
          </span>
          {isSlowed && (
            <span className="text-zinc-400 dark:text-zinc-500">
              (base {currentBaseWpm})
            </span>
          )}
          <span className="text-zinc-300 dark:text-zinc-600" aria-hidden="true">·</span>
          <span>{progressPct.toFixed(0)}%</span>
          <span className="text-zinc-300 dark:text-zinc-600" aria-hidden="true">·</span>
          <span>{formatDuration(estRemSec)} left</span>
          {highlightCount > 0 && (
            <>
              <span className="text-zinc-300 dark:text-zinc-600" aria-hidden="true">·</span>
              <span className="text-amber-600 dark:text-amber-400">
                {highlightCount} {highlightCount === 1 ? "mark" : "marks"}
              </span>
            </>
          )}
        </div>

        {/* Center: play/pause */}
        <button
          onClick={isFinished ? undefined : controls.togglePlayPause}
          disabled={isFinished}
          aria-label={isPlaying ? "Pause" : "Play"}
          className="flex items-center justify-center w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-2 focus-visible:outline-blue-500 shrink-0"
        >
          {isPlaying ? (
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <rect x="3" y="2" width="4" height="12" rx="1" />
              <rect x="9" y="2" width="4" height="12" rx="1" />
            </svg>
          ) : (
            <svg className="w-4 h-4 translate-x-px" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M4 2.5a.5.5 0 0 1 .748-.432l8 5.5a.5.5 0 0 1 0 .864l-8 5.5A.5.5 0 0 1 4 13.5v-11Z" />
            </svg>
          )}
        </button>

        {/* Right: hints + exit */}
        <div className="flex items-center gap-3">
          <span className="hidden sm:block text-xs text-zinc-400 dark:text-zinc-500">
            <kbd className="font-mono">Space</kbd> play/pause
            <span className="mx-1.5 text-zinc-300 dark:text-zinc-600">·</span>
            <kbd className="font-mono">H</kbd> mark
          </span>
          <button
            onClick={onExit}
            aria-label="Exit reader"
            className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors focus-visible:outline-2 focus-visible:outline-blue-500 rounded px-2 py-1"
          >
            <span className="hidden sm:inline mr-1"><kbd className="font-mono">Esc</kbd></span>
            Exit
          </button>
        </div>
      </div>

      {/* ── Mode toggle + difficulty indicator ──────────────────────────────── */}
      <div className="flex items-center gap-4 text-xs min-h-[1.25rem]">
        {/* Baseline / Adaptive toggle */}
        <div className="flex items-center gap-1 rounded-md overflow-hidden border border-zinc-200 dark:border-zinc-700">
          <button
            onClick={() => onModeChange("baseline")}
            className={`px-2.5 py-0.5 text-xs font-medium transition-colors ${
              mode === "baseline"
                ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-100"
                : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
          >
            Baseline
          </button>
          <button
            onClick={() => onModeChange("adaptive")}
            className={`px-2.5 py-0.5 text-xs font-medium transition-colors ${
              mode === "adaptive"
                ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-100"
                : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
          >
            Adaptive
          </button>
        </div>

        {/* Difficulty info */}
        <span className="font-mono text-zinc-400 dark:text-zinc-500">
          {mode === "adaptive" && analysisStatus === "pending" && "analyzing…"}
          {mode === "adaptive" && analysisStatus === "error" && "⚠ analysis unavailable"}
          {mode === "adaptive" && (analysisStatus === "done" || analysisStatus === "idle") && currentDifficulty && (
            <>
              {isSlowed ? (
                <span>
                  <span className={LEVEL_TEXT[currentDifficulty.level]}>
                    {LEVEL_LABEL[currentDifficulty.level]}
                  </span>
                  {" — slowing "}
                  <span className="text-zinc-600 dark:text-zinc-300">
                    {currentBaseWpm} → {effectiveWpm} WPM
                  </span>
                </span>
              ) : (
                <span className="text-zinc-400 dark:text-zinc-600">
                  {LEVEL_LABEL[currentDifficulty.level]} difficulty
                </span>
              )}
            </>
          )}
          {mode === "baseline" && (
            <span className="text-zinc-400 dark:text-zinc-600">AI pacing off</span>
          )}
        </span>
      </div>

      {/* ── Finished state ───────────────────────────────────────────────────── */}
      {isFinished && (
        <div className="flex flex-col gap-3 pt-1 border-t border-zinc-100 dark:border-zinc-800">
          {/* Session summary */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            <span>Words read</span>
            <span className="tabular-nums font-medium text-zinc-700 dark:text-zinc-300">
              {currentTokenId.toLocaleString()}
            </span>
            <span>Active reading</span>
            <span className="tabular-nums font-medium text-zinc-700 dark:text-zinc-300">
              {formatDuration(activeReadingSec)}
            </span>
            <span>Average speed</span>
            <span className="tabular-nums font-medium text-zinc-700 dark:text-zinc-300">
              {avgWpm} WPM
            </span>
            <span>Normal pace would take</span>
            <span className="tabular-nums font-medium text-zinc-700 dark:text-zinc-300">
              {formatDuration(estimateNormalReadingSeconds(currentTokenId))}
            </span>
            {highlightCount > 0 && (
              <>
                <span>Highlights</span>
                <span className="tabular-nums font-medium text-amber-600 dark:text-amber-400">
                  {highlightCount}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              onClick={() => controls.seekToToken(0)}
            >
              Restart
            </button>
            {onDownloadPdf && highlightCount > 0 && (
              <button
                onClick={onDownloadPdf}
                className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition-colors"
              >
                Download highlighted PDF
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
