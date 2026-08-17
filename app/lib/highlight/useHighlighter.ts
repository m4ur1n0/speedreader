"use client"

import { useState, useCallback, useRef } from "react"
import type { ReaderModel } from "../reader/types"
import type { ReaderHighlight, ActiveHighlight } from "./types"
import {
  getCompensatedHighlightStart,
  getCompensatedHighlightEnd,
} from "./compensation"

let idCounter = 0
function nextId() {
  return `h${++idCounter}_${Date.now()}`
}

export interface HighlighterControls {
  /** Call on keydown (non-repeat) to begin capturing. */
  beginHighlight(): void
  /** Call on keyup to finalize the highlight. */
  endHighlight(): void
  /** Finalize any in-progress highlight without forward compensation (e.g. on reader exit). */
  flushHighlight(): void
  highlights: ReaderHighlight[]
  activeHighlight: ActiveHighlight | null
  isHighlighting: boolean
  /** Replace all highlights (used to restore persisted session state). */
  setHighlights: React.Dispatch<React.SetStateAction<ReaderHighlight[]>>
}

/**
 * Manages the hold-to-highlight lifecycle.
 *
 * - beginHighlight() applies backward reaction-time compensation and
 *   sentence-aware snapping to determine the real start token.
 * - endHighlight() applies forward compensation and finalizes the range.
 * - All highlights are stored in canonical token/character ranges.
 * - The player state is read via a ref so this hook has no reactive dependency
 *   on the rapidly-advancing currentTokenId / currentBaseWpm.
 */
export function useHighlighter(
  model: ReaderModel | null,
  /** Ref whose .current always holds the latest PlayerState values we need. */
  playerStateRef: React.RefObject<{ currentTokenId: number; currentBaseWpm: number }>
): HighlighterControls {
  const [highlights, setHighlights] = useState<ReaderHighlight[]>([])
  const [activeHighlight, setActiveHighlight] = useState<ActiveHighlight | null>(null)
  // Keep activeHighlight in a ref so endHighlight/flushHighlight can read it
  // without being reactive dependencies (which would re-create the callbacks
  // on every keydown/keyup and risk stale closures in event listeners).
  const activeRef = useRef<ActiveHighlight | null>(null)

  const beginHighlight = useCallback(() => {
    if (!model || activeRef.current) return
    const { currentTokenId, currentBaseWpm } = playerStateRef.current ?? { currentTokenId: 0, currentBaseWpm: 300 }

    const startTokenId = getCompensatedHighlightStart(
      currentTokenId,
      currentBaseWpm,
      model
    )
    const startToken = model.tokens[startTokenId]
    if (!startToken) return

    const active: ActiveHighlight = {
      startTokenId,
      canonicalStart: startToken.canonicalStart,
    }
    activeRef.current = active
    setActiveHighlight(active)
  }, [model, playerStateRef])

  const endHighlight = useCallback(() => {
    if (!model || !activeRef.current) return
    const { currentTokenId, currentBaseWpm } = playerStateRef.current ?? { currentTokenId: 0, currentBaseWpm: 300 }
    const active = activeRef.current

    const endTokenId = getCompensatedHighlightEnd(
      currentTokenId,
      currentBaseWpm,
      model
    )
    const endToken = model.tokens[endTokenId]
    if (!endToken) {
      activeRef.current = null
      setActiveHighlight(null)
      return
    }

    // Only create a highlight if the range has substance (at least 2 tokens apart).
    if (endTokenId < active.startTokenId) {
      activeRef.current = null
      setActiveHighlight(null)
      return
    }

    const highlight: ReaderHighlight = {
      id: nextId(),
      startTokenId: active.startTokenId,
      endTokenId,
      canonicalStart: active.canonicalStart,
      canonicalEnd: endToken.canonicalEnd,
    }

    activeRef.current = null
    setActiveHighlight(null)
    setHighlights((prev) => [...prev, highlight])
  }, [model, playerStateRef])

  const flushHighlight = useCallback(() => {
    if (!model || !activeRef.current) return
    const { currentTokenId } = playerStateRef.current ?? { currentTokenId: 0, currentBaseWpm: 300 }
    const active = activeRef.current

    const endTokenId = Math.min(currentTokenId, model.tokens.length - 1)
    const endToken = model.tokens[endTokenId]
    if (!endToken || endTokenId < active.startTokenId) {
      activeRef.current = null
      setActiveHighlight(null)
      return
    }

    const highlight: ReaderHighlight = {
      id: nextId(),
      startTokenId: active.startTokenId,
      endTokenId,
      canonicalStart: active.canonicalStart,
      canonicalEnd: endToken.canonicalEnd,
    }

    activeRef.current = null
    setActiveHighlight(null)
    setHighlights((prev) => [...prev, highlight])
  }, [model, playerStateRef])

  return {
    beginHighlight,
    endHighlight,
    flushHighlight,
    highlights,
    activeHighlight,
    isHighlighting: activeHighlight !== null,
    setHighlights,
  }
}
