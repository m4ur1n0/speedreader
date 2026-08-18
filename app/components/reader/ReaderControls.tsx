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
  analysisHadErrors?: boolean
  currentDifficulty: ChunkDifficultyResult | null
  highlightCount: number
  onDownloadPdf?: (() => void) | null
  mode: ReadingMode
  onModeChange: (m: ReadingMode) => void
  chunks: AnalysisChunk[]
  pacings: ChunkPacing[]
  manualSpeedBoost: number
  onSpeedUp: () => void
  automaticMaxWpm: number
  manualMaxWpmCap: number
}

/* Difficulty → color for progress bar marks (CSS bg strings) */
const LEVEL_MARK_COLOR: Record<string, string> = {
  mild:     "rgba(234, 179, 8, 0.30)",
  moderate: "rgba(249, 115, 22, 0.30)",
  high:     "rgba(239, 68, 68, 0.35)",
  very_high:"rgba(239, 68, 68, 0.50)",
}

const LEVEL_LABEL: Record<string, string> = {
  normal:   "Normal",
  mild:     "Mild",
  moderate: "Moderate",
  high:     "High",
  very_high:"Dense",
}

export function ReaderControls({
  state,
  totalTokens,
  controls,
  onExit,
  analysisStatus,
  analysisHadErrors = false,
  currentDifficulty,
  highlightCount,
  onDownloadPdf,
  mode,
  onModeChange,
  chunks,
  pacings,
  manualSpeedBoost,
  onSpeedUp,
  automaticMaxWpm,
  manualMaxWpmCap,
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

  const wordsRemaining = Math.max(0, totalTokens - currentTokenId)
  const estRemSec = effectiveWpm > 0 ? (wordsRemaining / effectiveWpm) * 60 : 0

  const activeReadingSec = activeReadingMs / 1000
  const avgWpm = activeReadingMs > 0
    ? Math.round((currentTokenId / activeReadingMs) * 60_000)
    : currentBaseWpm

  /* Difficulty marks for progress bar */
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

  const canSpeedUp = (automaticMaxWpm + manualSpeedBoost) < manualMaxWpmCap
  const effectiveCeiling = automaticMaxWpm + manualSpeedBoost

  /* Adaptive status line text */
  let adaptiveInfo: React.ReactNode = null
  if (mode === "adaptive") {
    if (analysisStatus === "pending") {
      adaptiveInfo = <span className="text-ink-3">analyzing…</span>
    } else if (analysisStatus === "error") {
      adaptiveInfo = <span className="text-ink-3">Adaptive unavailable — baseline pacing</span>
    } else if (currentDifficulty) {
      const label = LEVEL_LABEL[currentDifficulty.level] ?? currentDifficulty.level
      if (isSlowed) {
        adaptiveInfo = (
          <span>
            <span className="text-warning">{label}</span>
            <span className="text-ink-3"> · slowing to {effectiveWpm} WPM</span>
            {analysisHadErrors && <span className="text-ink-3"> · partial</span>}
          </span>
        )
      } else {
        adaptiveInfo = (
          <span className="text-ink-3">
            {label} difficulty{analysisHadErrors && " · partial"}
          </span>
        )
      }
    }
  }

  return (
    <div
      className="shrink-0 w-full"
      style={{
        background: "var(--surface)",
        borderTop: "1px solid var(--border-subtle)",
      }}
    >
      {/* ── Thin progress bar ────────────────────────────────────────────── */}
      <div
        className="relative w-full overflow-hidden"
        style={{ height: "2px", background: "var(--surface-inset)" }}
      >
        {/* Difficulty region marks */}
        {difficultyMarks.map((m, i) => (
          <div
            key={i}
            className="absolute inset-y-0"
            style={{
              left: `${m.startPct.toFixed(2)}%`,
              width: `${m.widthPct.toFixed(2)}%`,
              background: LEVEL_MARK_COLOR[m.level] ?? "rgba(239,68,68,0.3)",
            }}
            aria-hidden="true"
          />
        ))}
        {/* Progress fill */}
        <div
          className="absolute inset-y-0 left-0 transition-all duration-75"
          style={{
            width: `${progressPct.toFixed(1)}%`,
            background: "var(--accent)",
          }}
          role="progressbar"
          aria-valuenow={Math.round(progressPct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Reading progress"
        />
      </div>

      {/* ── Main control strip ───────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 sm:px-5 h-14">

        {/* Left: play/pause + WPM */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={isFinished ? undefined : controls.togglePlayPause}
            disabled={isFinished}
            aria-label={isPlaying ? "Pause" : "Play"}
            className="flex items-center justify-center w-9 h-9 rounded-full disabled:opacity-30 transition-opacity hover:opacity-80 active:opacity-60 focus-visible:outline-2 shrink-0"
            style={{
              background: "var(--ink-1)",
              color: "var(--bg)",
            }}
          >
            {isPlaying ? (
              <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
                <rect x="2.5" y="1.5" width="3.5" height="11" rx="1" />
                <rect x="8" y="1.5" width="3.5" height="11" rx="1" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5 translate-x-px" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
                <path d="M3 2a.5.5 0 0 1 .745-.434l8 5a.5.5 0 0 1 0 .868l-8 5A.5.5 0 0 1 3 12V2Z" />
              </svg>
            )}
          </button>

          {/* WPM display */}
          <div className="flex items-baseline gap-1 tabular-nums">
            <span className="text-[1.375rem] font-mono font-semibold tracking-tight text-ink-1 leading-none">
              {effectiveWpm}
            </span>
            <span className="text-[10px] text-ink-3 font-mono leading-none">WPM</span>
          </div>

          {/* Speed controls */}
          {canSpeedUp ? (
            <button
              onClick={onSpeedUp}
              title={`Faster (=) — raise ceiling to ${effectiveCeiling + 25} WPM`}
              className="text-[10px] font-mono px-1.5 py-0.5 rounded border text-ink-3 transition-colors hover:text-accent focus-visible:outline-accent"
              style={{ borderColor: "var(--border)" }}
              aria-label="Increase reading speed"
            >
              +faster
            </button>
          ) : (
            <span className="text-[10px] font-mono text-ink-3">max</span>
          )}
          {manualSpeedBoost > 0 && (
            <span className="text-[10px] font-mono text-ink-3 hidden sm:inline">
              /{effectiveCeiling}
            </span>
          )}
        </div>

        {/* Center: progress info + adaptive status */}
        <div className="flex-1 min-w-0 flex flex-col items-center">
          <div className="flex items-center gap-2 text-[11px] font-mono text-ink-3 tabular-nums">
            <span>{progressPct.toFixed(0)}%</span>
            <span aria-hidden="true">·</span>
            <span className="hidden xs:inline">{formatDuration(estRemSec)} left</span>
            {highlightCount > 0 && (
              <>
                <span aria-hidden="true" className="hidden sm:inline">·</span>
                <span className="hidden sm:inline text-hl">{highlightCount} {highlightCount === 1 ? "mark" : "marks"}</span>
              </>
            )}
          </div>
          {adaptiveInfo && (
            <div className="text-[10px] font-mono leading-none mt-0.5 hidden sm:block">
              {adaptiveInfo}
            </div>
          )}
        </div>

        {/* Right: mode toggle + kbd hints + exit */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Mode toggle */}
          <div
            className="hidden sm:flex items-center rounded overflow-hidden text-[10px] font-mono"
            style={{ border: "1px solid var(--border)" }}
          >
            <button
              onClick={() => onModeChange("baseline")}
              className={`px-2 py-1 transition-colors ${
                mode === "baseline"
                  ? "text-ink-1 font-medium"
                  : "text-ink-3 hover:text-ink-2"
              }`}
              style={mode === "baseline" ? { background: "var(--surface-inset)" } : undefined}
              aria-pressed={mode === "baseline"}
            >
              B
            </button>
            <div style={{ width: "1px", background: "var(--border)", alignSelf: "stretch" }} />
            <button
              onClick={() => onModeChange("adaptive")}
              className={`px-2 py-1 transition-colors ${
                mode === "adaptive"
                  ? "text-ink-1 font-medium"
                  : "text-ink-3 hover:text-ink-2"
              }`}
              style={mode === "adaptive" ? { background: "var(--surface-inset)" } : undefined}
              aria-pressed={mode === "adaptive"}
              aria-label="Adaptive mode"
            >
              A
            </button>
          </div>

          {/* Keyboard hints — desktop only */}
          <span className="hidden lg:flex items-center gap-1.5 text-[10px] font-mono text-ink-3">
            <kbd className="text-ink-3">Space</kbd>
            <span aria-hidden="true">·</span>
            <kbd className="text-ink-3">H</kbd> mark
            <span aria-hidden="true">·</span>
            <kbd className="text-ink-3">=</kbd> faster
          </span>

          {/* Exit */}
          <button
            onClick={onExit}
            aria-label="Exit reader"
            className="flex items-center gap-1 text-[11px] font-mono text-ink-3 hover:text-ink-1 transition-colors px-2 py-1 rounded focus-visible:outline-accent"
          >
            <span className="hidden sm:inline text-[10px]"><kbd>Esc</kbd></span>
            <span>Exit</span>
          </button>
        </div>
      </div>

      {/* ── Finished reading receipt ─────────────────────────────────────── */}
      {isFinished && (
        <div
          className="px-4 sm:px-5 pb-5 pt-1"
          style={{ borderTop: "1px solid var(--border-subtle)" }}
        >
          <p className="text-[10px] font-mono uppercase tracking-widest text-ink-3 mb-3">
            Session complete
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 mb-4">
            <StatItem label="Words read" value={currentTokenId.toLocaleString()} />
            <StatItem label="Active time" value={formatDuration(activeReadingSec)} />
            <StatItem label="Avg speed" value={`${avgWpm} WPM`} mono />
            <StatItem
              label="Normal pace"
              value={formatDuration(estimateNormalReadingSeconds(currentTokenId))}
            />
            {highlightCount > 0 && (
              <StatItem label="Highlights" value={String(highlightCount)} accent />
            )}
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <button
              className="text-xs text-accent hover:text-accent-hover transition-colors font-medium"
              onClick={() => controls.seekToToken(0)}
            >
              Restart
            </button>
            {onDownloadPdf && highlightCount > 0 && (
              <button
                onClick={onDownloadPdf}
                className="text-xs text-ink-2 hover:text-ink-1 transition-colors"
              >
                Export highlighted PDF
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function StatItem({
  label,
  value,
  mono,
  accent,
}: {
  label: string
  value: string
  mono?: boolean
  accent?: boolean
}) {
  return (
    <div>
      <p className="text-[10px] font-mono uppercase tracking-wider text-ink-3 mb-0.5">{label}</p>
      <p
        className={`text-sm font-medium ${
          accent ? "text-hl" : "text-ink-1"
        } ${mono ? "font-mono tabular-nums" : ""}`}
      >
        {value}
      </p>
    </div>
  )
}
