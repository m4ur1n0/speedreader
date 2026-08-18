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

const CONTEXT_BEFORE = 20
const CONTEXT_TOTAL = 60

/**
 * Transcript ribbon — a sliding window of the current sentence
 * centered on the current word.
 *
 * Visual zones:
 *   Already read:  very muted
 *   Current word:  slightly elevated
 *   Upcoming:      secondary
 *
 * Highlight styling:
 *   Finalized: amber underline on covered tokens.
 *   Active: amber underline + soft background.
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
    <div className="flex flex-col items-center gap-2 w-full max-w-lg mx-auto px-5">
      {/* Highlight-in-progress indicator */}
      <div
        className={`h-4 flex items-center gap-1.5 text-[10px] font-mono tracking-wide text-hl transition-opacity duration-100 ${
          activeHighlight ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        aria-hidden="true"
      >
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-hl animate-pulse" />
        marking
      </div>

      {/* Token strip */}
      <div
        className={`w-full flex flex-wrap items-baseline justify-center gap-x-[0.3em] gap-y-0.5 transition-opacity duration-150 ${
          paused ? "opacity-50" : "opacity-100"
        }`}
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
                "text-[0.8125rem] leading-relaxed transition-colors duration-75",
                isPast && !isCurrent
                  ? "text-ink-3"
                  : isCurrent
                  ? "text-ink-1 font-medium"
                  : "text-ink-2",
                isFinalized && !isActive
                  ? "underline decoration-hl decoration-2 underline-offset-2"
                  : "",
                isActive && isCurrent
                  ? "underline decoration-hl decoration-2 underline-offset-2 rounded-sm px-px"
                  : isActive
                  ? "underline decoration-hl decoration-2 underline-offset-2 rounded-sm px-px"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={
                isActive
                  ? { backgroundColor: "var(--hl-active)" }
                  : isFinalized && !isActive
                  ? { backgroundColor: "var(--hl-soft)" }
                  : undefined
              }
            >
              {token.text}
            </span>
          )
        })}
      </div>
    </div>
  )
}
