"use client"

import { useMemo } from "react"
import type { ReaderModel } from "@/app/lib/reader/types"

interface Props {
  model: ReaderModel
  currentTokenId: number
  paused: boolean
}

const MAX_LOOKAHEAD = 60 // tokens to show past the current word

/**
 * Shows the current sentence with three visual zones:
 *   - Already read: muted
 *   - Current word: slightly accented (but not competing with WordDisplay)
 *   - Upcoming: standard secondary text
 *
 * The sentence updates only when the sentenceId changes, preventing
 * unnecessary re-renders during rapid playback within a sentence.
 *
 * When a paragraph or line boundary is crossed, the full sentence refreshes.
 */
export function SentenceContext({ model, currentTokenId, paused }: Props) {
  const currentToken = model.tokens[currentTokenId]

  const sentenceTokens = useMemo(() => {
    if (!currentToken) return []
    const { sentenceId } = currentToken
    const start = model.sentenceFirstToken.get(sentenceId) ?? 0
    const result = []
    for (let i = start; i < model.tokens.length; i++) {
      if (model.tokens[i].sentenceId !== sentenceId) break
      result.push(model.tokens[i])
      // Cap lookahead to avoid enormous sentences (e.g., PDF lines without periods)
      if (result.length > MAX_LOOKAHEAD) break
    }
    return result
  }, [currentToken?.sentenceId, model]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!currentToken || sentenceTokens.length === 0) return null

  return (
    <div
      className={`
        w-full max-w-lg mx-auto px-4 min-h-[3.5rem] flex flex-wrap items-baseline
        justify-center gap-x-1 gap-y-0.5 transition-opacity duration-150
        ${paused ? "opacity-60" : "opacity-100"}
      `}
      aria-hidden="true"
    >
      {sentenceTokens.map((token) => {
        const isPast = token.id < currentTokenId
        const isCurrent = token.id === currentTokenId

        return (
          <span
            key={token.id}
            className={[
              "text-sm leading-relaxed transition-colors duration-75",
              isPast
                ? "text-zinc-300 dark:text-zinc-600"
                : isCurrent
                ? "text-zinc-600 dark:text-zinc-300 font-medium"
                : "text-zinc-500 dark:text-zinc-400",
            ].join(" ")}
          >
            {token.text}
          </span>
        )
      })}
    </div>
  )
}
