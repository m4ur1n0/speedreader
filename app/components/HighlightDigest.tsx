"use client"

import type { ReaderHighlight } from "@/app/lib/highlight/types"
import { normalizeHighlightRanges } from "@/app/lib/highlight/normalize"

interface Props {
  highlights: ReaderHighlight[]
  canonicalText: string
  /** If provided, clicking a highlight calls this to resume reading from there. */
  onSeekTo?: (tokenId: number) => void
}

const MAX_EXCERPT_CHARS = 300

/**
 * Displays highlighted passages in document order.
 * Text is derived directly from canonical ranges — no LLM or summarization.
 * Overlapping ranges are merged before display.
 */
export function HighlightDigest({ highlights, canonicalText, onSeekTo }: Props) {
  if (highlights.length === 0) return null

  const normalized = normalizeHighlightRanges(highlights)

  return (
    <section className="w-full max-w-2xl space-y-3">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">
        Highlights ({normalized.length})
      </h2>
      <ol className="space-y-3">
        {normalized.map((h, i) => {
          const raw = canonicalText.slice(h.canonicalStart, h.canonicalEnd)
          const excerpt =
            raw.length > MAX_EXCERPT_CHARS
              ? raw.slice(0, MAX_EXCERPT_CHARS).trimEnd() + "…"
              : raw

          return (
            <li
              key={h.id}
              className="flex gap-3 items-start group"
            >
              <span className="shrink-0 mt-0.5 text-xs font-mono text-zinc-400 dark:text-zinc-500 w-5 text-right">
                {i + 1}.
              </span>
              <div className="flex-1 min-w-0">
                <blockquote className="border-l-2 border-amber-400 dark:border-amber-500 pl-3 text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
                  "{excerpt}"
                </blockquote>
                {onSeekTo && (
                  <button
                    onClick={() => onSeekTo(h.startTokenId)}
                    className="mt-1 text-xs text-zinc-400 dark:text-zinc-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                  >
                    Resume from here →
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
