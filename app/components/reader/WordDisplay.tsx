"use client"

import type { ReaderToken } from "@/app/lib/reader/types"

interface Props {
  token: ReaderToken | null
  paused: boolean
}

/**
 * ORP-style word display.
 *
 * The focal character always occupies the same x-position regardless of
 * word length, achieved by splitting the word into three parts (before /
 * focus / after) and placing them in two flex columns that meet at the
 * horizontal center of the container.
 */
export function WordDisplay({ token, paused }: Props) {
  if (!token) return null

  const { text, focusIndex, isParagraphStart, isLineStart } = token

  const before = text.slice(0, focusIndex)
  const focus = text[focusIndex] ?? ""
  const after = text.slice(focusIndex + 1)

  const showParaMarker = isParagraphStart
  const showLineMarker = isLineStart && !isParagraphStart

  return (
    <div className="flex flex-col items-center select-none" style={{ gap: "0.75rem" }}>
      {/* Section-boundary indicator */}
      <div className="h-4 flex items-center justify-center">
        {showParaMarker && (
          <span
            className="text-[10px] font-mono tracking-widest text-ink-3"
            aria-hidden="true"
          >
            ¶
          </span>
        )}
        {showLineMarker && (
          <span
            className="text-[10px] font-mono tracking-widest text-ink-3"
            aria-hidden="true"
          >
            ↩
          </span>
        )}
      </div>

      {/* Focal word row */}
      <div
        className={`flex items-baseline w-full max-w-xl transition-opacity duration-100 ${
          paused ? "opacity-35" : "opacity-100"
        }`}
        aria-label={text}
        role="text"
      >
        {/* Left column — right-aligned to center pivot */}
        <div className="flex-1 text-right overflow-visible leading-none" aria-hidden="true">
          <span className="text-5xl font-sans text-ink-1 tracking-tight">
            {before}
          </span>
        </div>

        {/* Focal character — accent blue, the fixation pivot */}
        <span
          className="shrink-0 text-5xl font-sans font-semibold leading-none tracking-tight text-accent"
          aria-hidden="true"
        >
          {focus || " "}
        </span>

        {/* Right column — left-aligned */}
        <div className="flex-1 overflow-visible leading-none" aria-hidden="true">
          <span className="text-5xl font-sans text-ink-1 tracking-tight">
            {after}
          </span>
        </div>
      </div>

      {/* Fixation marker — subtle –•– guide below the focal column */}
      <div
        className={`flex items-center gap-0.5 transition-opacity duration-100 ${paused ? "opacity-20" : "opacity-40"}`}
        aria-hidden="true"
      >
        <div className="w-4 h-px bg-accent" />
        <div className="w-[3px] h-[3px] rounded-full bg-accent" />
        <div className="w-4 h-px bg-accent" />
      </div>
    </div>
  )
}
