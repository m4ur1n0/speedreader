"use client"

import { useMemo } from "react"
import type { ReaderModel } from "@/app/lib/reader/types"
import type { ReaderHighlight, ActiveHighlight } from "@/app/lib/highlight/types"

interface Props {
  model: ReaderModel
  currentTokenId: number
  paused: boolean
  highlights: ReaderHighlight[]
  activeHighlight: ActiveHighlight | null
}

/** Tokens to show before the current word. */
const CONTEXT_BEFORE = 20
/** Total window size. */
const CONTEXT_TOTAL = 60

/**
 * Shows a sliding window of the current sentence centered on the current word.
 *
 * Visual zones:
 *   - Already read:  muted
 *   - Current word:  slightly accented (not competing with WordDisplay)
 *   - Upcoming:      standard secondary text
 *
 * The window is anchored to currentTokenId (not sentence start) so the current
 * word is always visible even in very long sentences or PDFs with few sentence
 * boundaries. Adding currentTokenId to the memo deps is the correct fix for the
 * freeze that occurred when the current word advanced past the old fixed-start
 * MAX_LOOKAHEAD limit.
 *
 * Highlight styling:
 *   - Finalized highlights: amber underline on covered tokens.
 *   - Active capture: amber underline + subtle background. The current token
 *     gets a stronger accent so it remains visually distinct from past tokens
 *     even when everything is inside the active range.
 */
export function SentenceContext({
  model,
  currentTokenId,
  paused,
  highlights,
  activeHighlight,
}: Props) {
  const currentToken = model.tokens[currentTokenId]

  const sentenceTokens = useMemo(() => {
    if (!currentToken) return []
    const { sentenceId } = currentToken
    const sentenceStart = model.sentenceFirstToken.get(sentenceId) ?? 0

    // Sliding window: start from sentenceStart or (currentTokenId - CONTEXT_BEFORE),
    // whichever is later, so the current word is always near the front of the strip.
    const windowStart = Math.max(sentenceStart, currentTokenId - CONTEXT_BEFORE)

    const result = []
    for (let i = windowStart; i < model.tokens.length; i++) {
      if (model.tokens[i].sentenceId !== sentenceId) break
      result.push(model.tokens[i])
      if (result.length >= CONTEXT_TOTAL) break
    }
    return result
  }, [currentToken?.sentenceId, currentTokenId, model])

  if (!currentToken || sentenceTokens.length === 0) return null

  const activeStart = activeHighlight?.startTokenId ?? -1
  const activeEnd = activeHighlight ? currentTokenId : -1

  return (
    <div className="flex flex-col items-center gap-1 w-full max-w-lg mx-auto px-4">
      {/* Recording indicator — shown while a highlight is being captured */}
      <div
        className={`h-5 flex items-center gap-1.5 text-xs font-mono text-amber-500 dark:text-amber-400 transition-opacity duration-100 ${
          activeHighlight ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        aria-hidden="true"
      >
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-amber-400 animate-pulse" />
        marking
      </div>

      {/* Token strip */}
      <div
        className={`
          w-full min-h-[3.5rem] flex flex-wrap items-baseline
          justify-center gap-x-1 gap-y-0.5 transition-opacity duration-150
          ${paused ? "opacity-60" : "opacity-100"}
        `}
        aria-hidden="true"
      >
        {sentenceTokens.map((token) => {
          const isPast = token.id < currentTokenId
          const isCurrent = token.id === currentTokenId

          const isFinalized = highlights.some(
            (h) => token.id >= h.startTokenId && token.id <= h.endTokenId
          )
          const isActive =
            activeHighlight !== null &&
            token.id >= activeStart &&
            token.id <= activeEnd

          return (
            <span
              key={token.id}
              className={[
                "text-sm leading-relaxed transition-colors duration-75",
                // Base read-state colour.
                isPast && !isCurrent
                  ? "text-zinc-300 dark:text-zinc-600"
                  : isCurrent
                  ? "text-zinc-700 dark:text-zinc-200 font-semibold"
                  : "text-zinc-500 dark:text-zinc-400",
                // Finalized highlight (no active capture): amber underline only.
                isFinalized && !isActive
                  ? "underline decoration-amber-400 dark:decoration-amber-500 decoration-2 underline-offset-2"
                  : "",
                // Active capture: underline on all captured tokens.
                // Current token inside active range gets a stronger background so
                // it stays visually distinct from muted past tokens.
                isActive && isCurrent
                  ? "underline decoration-amber-500 dark:decoration-amber-400 decoration-2 underline-offset-2 bg-amber-200 dark:bg-amber-800/50 rounded-sm px-px"
                  : isActive
                  ? "underline decoration-amber-400 dark:decoration-amber-500 decoration-2 underline-offset-2 bg-amber-50 dark:bg-amber-950/30 rounded-sm px-px"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {token.text}
            </span>
          )
        })}
      </div>
    </div>
  )
}
