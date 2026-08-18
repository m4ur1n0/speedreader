"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import type { ReaderModel, PlayerState } from "./types"
import { RAMP_START_WPM, RAMP_MAX_WPM, RAMP_DURATION_MS } from "./types"
import { getEffectiveWpm, wpmToActiveMs } from "./speed"
import { getTokenDuration } from "./timing"

function makeInitialState(targetMaxWpm: number): PlayerState {
  return {
    status: "idle",
    currentTokenId: 0,
    activeReadingMs: 0,
    currentBaseWpm: RAMP_START_WPM,
    targetMaxWpm,
    sentenceId: 0,
    paragraphId: 0,
  }
}

export interface ReaderControls {
  play(): void
  pause(): void
  /** Currently maps to play/pause toggle. Callers should use this rather
   *  than calling play/pause directly so the Space key handler can later be
   *  reassigned to hold-to-highlight without touching this interface. */
  togglePlayPause(): void
  seekToToken(tokenId: number): void
  seekToSentenceStart(): void
  seekToParagraphStart(): void
  /** Change the ramp ceiling. Takes effect at the next token. */
  setTargetMaxWpm(wpm: number): void
  /** Warp the ramp state so the next token uses this WPM. Does not move
   *  the reading position. */
  setCurrentWpm(wpm: number): void
  /** Atomically raise the ramp ceiling to newMax and bump current WPM by
   *  increment. Used by manual "Faster" control so both changes are in one
   *  state update and stay consistent. */
  manualBoostSpeed(increment: number, newMax: number): void
}

/**
 * Core player hook.
 *
 * Scheduling: one setTimeout per token, cancelled by the effect cleanup.
 * No interval drift — each timeout fires for exactly that token's duration,
 * then the state update triggers the next effect run.
 *
 * activeReadingMs accumulates wall time that elapsed while status === "playing".
 * Paused time is excluded, preserving ramp accuracy.
 *
 * getMultiplier: optional per-token difficulty multiplier supplied by the
 * analysis layer. Defaults to 1.0 when absent or not yet available.
 */
export function useReaderPlayer(
  model: ReaderModel | null,
  initialTargetMaxWpm: number = RAMP_MAX_WPM,
  getMultiplier?: (tokenId: number) => number
): [PlayerState, ReaderControls] {
  const [state, setState] = useState<PlayerState>(() =>
    makeInitialState(initialTargetMaxWpm)
  )

  // Refs for values needed inside setTimeout without adding to effect deps.
  // Updated synchronously during every render so they always hold latest values.
  const activeReadingMsRef = useRef(state.activeReadingMs)
  const targetMaxWpmRef = useRef(state.targetMaxWpm)
  const getMultiplierRef = useRef(getMultiplier)
  activeReadingMsRef.current = state.activeReadingMs
  targetMaxWpmRef.current = state.targetMaxWpm
  getMultiplierRef.current = getMultiplier

  // Reset when the document changes.
  useEffect(() => {
    setState(makeInitialState(initialTargetMaxWpm))
  }, [model]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scheduling effect ─────────────────────────────────────────────────────
  // Fires when status becomes "playing" or currentTokenId advances.
  // Each invocation owns exactly one setTimeout; the cleanup cancels it.
  useEffect(() => {
    if (state.status !== "playing" || !model) return

    const token = model.tokens[state.currentTokenId]
    if (!token) {
      setState((prev) => ({ ...prev, status: "finished" }))
      return
    }

    const effectiveWpm = getEffectiveWpm(
      activeReadingMsRef.current,
      targetMaxWpmRef.current,
      RAMP_START_WPM,
      RAMP_DURATION_MS
    )
    const baseDuration = 60_000 / effectiveWpm
    const difficultyMultiplier = getMultiplierRef.current?.(token.id) ?? 1.0
    const duration = getTokenDuration(token, baseDuration, difficultyMultiplier)

    const tokenStart = performance.now()

    const id = setTimeout(() => {
      const elapsed = performance.now() - tokenStart

      setState((prev) => {
        // Guard: if the player was paused or seeked while this timeout was
        // pending, prev.currentTokenId or status will have changed — bail.
        if (prev.status !== "playing" || prev.currentTokenId !== token.id) {
          return prev
        }

        const nextId = token.id + 1
        if (nextId >= model.tokens.length) {
          return {
            ...prev,
            status: "finished",
            activeReadingMs: prev.activeReadingMs + elapsed,
          }
        }

        const next = model.tokens[nextId]
        const newActiveMs = prev.activeReadingMs + elapsed
        const newWpm = getEffectiveWpm(
          newActiveMs,
          prev.targetMaxWpm,
          RAMP_START_WPM,
          RAMP_DURATION_MS
        )

        return {
          ...prev,
          currentTokenId: nextId,
          activeReadingMs: newActiveMs,
          currentBaseWpm: Math.round(newWpm),
          sentenceId: next.sentenceId,
          paragraphId: next.paragraphId,
        }
      })
    }, duration)

    return () => clearTimeout(id)
  }, [state.status, state.currentTokenId, model]) // intentionally omits activeReadingMs / targetMaxWpm — see refs

  // ── Controls ──────────────────────────────────────────────────────────────

  const play = useCallback(() => {
    setState((prev) => {
      if (prev.status === "playing" || prev.status === "finished") return prev
      return { ...prev, status: "playing" }
    })
  }, [])

  const pause = useCallback(() => {
    setState((prev) => {
      if (prev.status !== "playing") return prev
      return { ...prev, status: "paused" }
    })
  }, [])

  const togglePlayPause = useCallback(() => {
    setState((prev) => {
      if (prev.status === "playing") return { ...prev, status: "paused" }
      if (prev.status === "paused" || prev.status === "idle")
        return { ...prev, status: "playing" }
      return prev
    })
  }, [])

  const seekToToken = useCallback(
    (tokenId: number) => {
      if (!model) return
      const clamped = Math.max(0, Math.min(tokenId, model.tokens.length - 1))
      const token = model.tokens[clamped]
      if (!token) return
      setState((prev) => ({
        ...prev,
        currentTokenId: clamped,
        sentenceId: token.sentenceId,
        paragraphId: token.paragraphId,
      }))
    },
    [model]
  )

  const seekToSentenceStart = useCallback(() => {
    if (!model) return
    setState((prev) => {
      const firstId = model.getSentenceStart(prev.currentTokenId)
      const token = model.tokens[firstId]
      if (!token) return prev
      return {
        ...prev,
        currentTokenId: firstId,
        sentenceId: token.sentenceId,
        paragraphId: token.paragraphId,
      }
    })
  }, [model])

  const seekToParagraphStart = useCallback(() => {
    if (!model) return
    setState((prev) => {
      const firstId = model.getParagraphStart(prev.currentTokenId)
      const token = model.tokens[firstId]
      if (!token) return prev
      return {
        ...prev,
        currentTokenId: firstId,
        sentenceId: token.sentenceId,
        paragraphId: token.paragraphId,
      }
    })
  }, [model])

  const setTargetMaxWpm = useCallback((wpm: number) => {
    setState((prev) => ({ ...prev, targetMaxWpm: wpm }))
  }, [])

  const setCurrentWpm = useCallback((wpm: number) => {
    setState((prev) => ({
      ...prev,
      activeReadingMs: wpmToActiveMs(
        wpm,
        prev.targetMaxWpm,
        RAMP_START_WPM,
        RAMP_DURATION_MS
      ),
      currentBaseWpm: Math.round(wpm),
    }))
  }, [])

  const manualBoostSpeed = useCallback((increment: number, newMax: number) => {
    setState((prev) => {
      const newCurrentWpm = Math.min(prev.currentBaseWpm + increment, newMax)
      return {
        ...prev,
        targetMaxWpm: newMax,
        activeReadingMs: wpmToActiveMs(newCurrentWpm, newMax, RAMP_START_WPM, RAMP_DURATION_MS),
        currentBaseWpm: Math.round(newCurrentWpm),
      }
    })
  }, [])

  const controls: ReaderControls = {
    play,
    pause,
    togglePlayPause,
    seekToToken,
    seekToSentenceStart,
    seekToParagraphStart,
    setTargetMaxWpm,
    setCurrentWpm,
    manualBoostSpeed,
  }

  return [state, controls]
}
