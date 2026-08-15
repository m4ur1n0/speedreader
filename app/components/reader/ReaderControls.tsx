"use client"

import type { PlayerState } from "@/app/lib/reader/types"
import type { ReaderControls as Controls } from "@/app/lib/reader/player"
import type { AnalysisStatus, ChunkDifficultyResult } from "@/app/lib/analysis/types"
import { LEVEL_TO_MULTIPLIER } from "@/app/lib/analysis/pacing"

interface Props {
  state: PlayerState
  totalTokens: number
  controls: Controls
  onExit: () => void
  analysisStatus: AnalysisStatus
  currentDifficulty: ChunkDifficultyResult | null
}

const LEVEL_LABEL: Record<string, string> = {
  normal: "Normal",
  mild: "Mild",
  moderate: "Moderate",
  high: "High",
  very_high: "Very High",
}

const LEVEL_COLOR: Record<string, string> = {
  normal: "text-green-600 dark:text-green-400",
  mild: "text-lime-600 dark:text-lime-400",
  moderate: "text-yellow-600 dark:text-yellow-400",
  high: "text-orange-600 dark:text-orange-400",
  very_high: "text-red-600 dark:text-red-400",
}

/**
 * Minimal reader control bar.
 *
 * Intentionally leaves the play/pause logic in the parent's keyboard handler
 * rather than wiring it to Space here, preserving the future option of
 * reassigning Space to hold-to-highlight.
 */
export function ReaderControls({
  state,
  totalTokens,
  controls,
  onExit,
  analysisStatus,
  currentDifficulty,
}: Props) {
  const { status, currentTokenId, currentBaseWpm } = state
  const isPlaying = status === "playing"
  const isFinished = status === "finished"

  const progressPct = totalTokens > 0
    ? Math.min(100, (currentTokenId / totalTokens) * 100)
    : 0

  const multiplier = currentDifficulty ? LEVEL_TO_MULTIPLIER[currentDifficulty.level] : null

  return (
    <div className="w-full flex flex-col gap-3 px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 bg-background">
      {/* Progress bar */}
      <div className="relative h-1 w-full rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
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

      <div className="flex items-center justify-between gap-4">
        {/* Left: WPM + position info */}
        <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {currentBaseWpm} <span className="font-normal">WPM</span>
          </span>
          <span className="text-zinc-300 dark:text-zinc-600" aria-hidden="true">·</span>
          <span>
            {currentTokenId.toLocaleString()} / {totalTokens.toLocaleString()}
          </span>
          <span className="text-zinc-300 dark:text-zinc-600" aria-hidden="true">·</span>
          <span>{progressPct.toFixed(0)}%</span>
        </div>

        {/* Center: play/pause */}
        <button
          onClick={isFinished ? undefined : controls.togglePlayPause}
          disabled={isFinished}
          aria-label={isPlaying ? "Pause" : "Play"}
          className="flex items-center justify-center w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-2 focus-visible:outline-blue-500"
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

        {/* Right: keyboard hints + exit */}
        <div className="flex items-center gap-3">
          <span className="hidden sm:block text-xs text-zinc-400 dark:text-zinc-500">
            <kbd className="font-mono">Space</kbd> play/pause
          </span>
          <button
            onClick={onExit}
            aria-label="Exit reader"
            className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors focus-visible:outline-2 focus-visible:outline-blue-500 rounded px-2 py-1"
          >
            <span className="hidden sm:inline mr-1">
              <kbd className="font-mono">Esc</kbd>
            </span>
            Exit
          </button>
        </div>
      </div>

      {/* ── Analysis debug strip ─────────────────────────────────────────── */}
      <div className="flex items-center gap-2 text-xs text-zinc-400 dark:text-zinc-500 tabular-nums min-h-[1.25rem]">
        <span className="font-mono">
          {analysisStatus === "pending" && "Analyzing reading difficulty…"}
          {analysisStatus === "error" && "⚠ Analysis unavailable — reading at full speed"}
          {(analysisStatus === "done" || analysisStatus === "idle") && currentDifficulty && (
            <>
              Difficulty:{" "}
              <span className={`font-semibold ${LEVEL_COLOR[currentDifficulty.level]}`}>
                {LEVEL_LABEL[currentDifficulty.level]}
              </span>
              {multiplier !== null && (
                <> · {multiplier.toFixed(2)}×</>
              )}
              {currentDifficulty.reason && (
                <span className="font-sans ml-2 text-zinc-400 dark:text-zinc-600">
                  — {currentDifficulty.reason}
                </span>
              )}
            </>
          )}
        </span>
      </div>

      {isFinished && (
        <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
          Finished.{" "}
          <button
            className="text-blue-600 dark:text-blue-400 hover:underline"
            onClick={() => controls.seekToToken(0)}
          >
            Restart
          </button>
        </p>
      )}
    </div>
  )
}
