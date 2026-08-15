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
 *
 * The focal character is highlighted with the semantic accent colour.
 * Bold weight provides a non-colour fallback for accessibility.
 *
 * Line/paragraph start markers appear above the word as a secondary cue.
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
    <div className="flex flex-col items-center gap-2 select-none">
      {/* Section-boundary indicator */}
      <div className="h-5 flex items-center justify-center">
        {showParaMarker && (
          <span
            className="text-xs tracking-widest text-zinc-400 dark:text-zinc-500"
            aria-hidden="true"
          >
            ¶
          </span>
        )}
        {showLineMarker && (
          <span
            className="text-xs tracking-widest text-zinc-400 dark:text-zinc-500"
            aria-hidden="true"
          >
            ↩
          </span>
        )}
      </div>

      {/* Focal word row */}
      <div
        className={`flex items-baseline w-full max-w-xl transition-opacity duration-75 ${
          paused ? "opacity-40" : "opacity-100"
        }`}
        aria-label={text}
        role="text"
      >
        {/*
         * Left column — right-aligned.
         * flex-1 gives it half the container; text-right pushes content
         * to the right edge, which is the center of the container.
         */}
        <div className="flex-1 text-right overflow-visible leading-none" aria-hidden="true">
          <span className="text-5xl font-sans text-foreground tracking-tight">
            {before}
          </span>
        </div>

        {/* Focal character — the pivot. Always at container midpoint. */}
        <span
          className="shrink-0 text-5xl font-sans font-bold leading-none tracking-tight text-red-600 dark:text-red-400"
          aria-hidden="true"
        >
          {focus || " "}
        </span>

        {/* Right column — left-aligned. */}
        <div className="flex-1 overflow-visible leading-none" aria-hidden="true">
          <span className="text-5xl font-sans text-foreground tracking-tight">
            {after}
          </span>
        </div>
      </div>

      {/* Underline guide — thin line at the baseline of the focal char */}
      <div className="w-2 h-px bg-blue-400 dark:bg-blue-500 mt-0.5" aria-hidden="true" />
    </div>
  )
}
