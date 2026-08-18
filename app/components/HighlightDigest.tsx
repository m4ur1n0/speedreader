"use client"

import type { ReaderHighlight } from "@/app/lib/highlight/types"
import { normalizeHighlightRanges } from "@/app/lib/highlight/normalize"

interface Props {
  highlights: ReaderHighlight[]
  canonicalText: string
  onSeekTo?: (tokenId: number) => void
}

const MAX_EXCERPT_CHARS = 350

/**
 * Displays highlighted passages in document order.
 * Text is derived directly from canonical ranges — no LLM or summarization.
 * Overlapping ranges are merged before display.
 */
export function HighlightDigest({ highlights, canonicalText, onSeekTo }: Props) {
  if (highlights.length === 0) return null

  const normalized = normalizeHighlightRanges(highlights)

  return (
    <section className="w-full">
      {/* Section header */}
      <div
        className="flex items-center gap-3 mb-5 pb-3"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <h2 className="text-[11px] font-mono uppercase tracking-widest text-ink-3">
          Highlights
        </h2>
        <span className="text-[11px] font-mono text-ink-3">
          {normalized.length}
        </span>
      </div>

      {/* Highlight list */}
      <ol className="space-y-6">
        {normalized.map((h, i) => {
          const raw = canonicalText.slice(h.canonicalStart, h.canonicalEnd)
          const excerpt =
            raw.length > MAX_EXCERPT_CHARS
              ? raw.slice(0, MAX_EXCERPT_CHARS).trimEnd() + "…"
              : raw

          return (
            <li key={h.id} className="flex gap-4 group">
              {/* Number */}
              <span
                className="shrink-0 w-5 text-right text-[11px] font-mono pt-[3px]"
                style={{ color: "var(--ink-3)" }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>

              {/* Content */}
              <div className="flex-1 min-w-0">
                {/* Left accent rule */}
                <div
                  className="pl-3 py-0.5"
                  style={{ borderLeft: "2px solid var(--hl-border)" }}
                >
                  <p
                    className="text-sm leading-relaxed text-ink-1"
                    style={{ fontFamily: "var(--font-serif)" }}
                  >
                    {excerpt}
                  </p>
                </div>

                {onSeekTo && (
                  <button
                    onClick={() => onSeekTo(h.startTokenId)}
                    className="mt-2 text-[11px] font-mono text-ink-3 hover:text-accent transition-colors"
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
