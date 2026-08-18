import type { ParsedDocument } from "../document/types"
import type { ReaderHighlight } from "../highlight/types"
import type { HighlightAnalysisInput } from "./types"
import { normalizeHighlightRanges } from "../highlight/normalize"

const CONTEXT_CHARS_BEFORE = 600
const CONTEXT_CHARS_AFTER = 400

function lastSentenceBoundaryPos(slice: string): number | null {
  let lastPos = -1
  for (let i = 0; i < slice.length - 1; i++) {
    const c = slice[i]
    if ((c === "." || c === "!" || c === "?") && (slice[i + 1] === " " || slice[i + 1] === "\n")) {
      lastPos = i + 2
    }
  }
  return lastPos >= 0 ? lastPos : null
}

function firstSentenceBoundaryPos(slice: string): number | null {
  for (let i = 0; i < slice.length - 1; i++) {
    const c = slice[i]
    if ((c === "." || c === "!" || c === "?") && (slice[i + 1] === " " || slice[i + 1] === "\n")) {
      return i + 2
    }
  }
  return null
}

function findContextStart(text: string, highlightStart: number): number {
  const rawStart = Math.max(0, highlightStart - CONTEXT_CHARS_BEFORE)
  const slice = text.slice(rawStart, highlightStart)

  // Prefer paragraph boundary
  const paraIdx = slice.lastIndexOf("\n\n")
  if (paraIdx >= 0) return rawStart + paraIdx + 2

  // Then sentence boundary
  const sentPos = lastSentenceBoundaryPos(slice)
  if (sentPos !== null) return rawStart + sentPos

  // Then single newline
  const nlIdx = slice.lastIndexOf("\n")
  if (nlIdx >= 0) return rawStart + nlIdx + 1

  return rawStart
}

function findContextEnd(text: string, highlightEnd: number): number {
  const rawEnd = Math.min(text.length, highlightEnd + CONTEXT_CHARS_AFTER)
  const slice = text.slice(highlightEnd, rawEnd)

  // Prefer paragraph boundary
  const paraIdx = slice.indexOf("\n\n")
  if (paraIdx >= 0) return highlightEnd + paraIdx

  // Then sentence boundary
  const sentPos = firstSentenceBoundaryPos(slice)
  if (sentPos !== null) return highlightEnd + sentPos

  // Then single newline
  const nlIdx = slice.indexOf("\n")
  if (nlIdx >= 0) return highlightEnd + nlIdx

  return rawEnd
}

export function buildHighlightContexts(
  highlights: ReaderHighlight[],
  doc: ParsedDocument
): HighlightAnalysisInput[] {
  const normalized = normalizeHighlightRanges(highlights)
  const text = doc.text
  const title = doc.metadata.fileName

  return normalized.map((h) => {
    const highlightedText = text.slice(h.canonicalStart, h.canonicalEnd).trim()

    const contextBeforeStart = findContextStart(text, h.canonicalStart)
    const contextAfterEnd = findContextEnd(text, h.canonicalEnd)

    const contextBefore = text.slice(contextBeforeStart, h.canonicalStart).trim()
    const contextAfter = text.slice(h.canonicalEnd, contextAfterEnd).trim()

    return {
      id: h.id,
      highlightedText,
      contextBefore,
      contextAfter,
      documentTitle: title,
    }
  })
}
