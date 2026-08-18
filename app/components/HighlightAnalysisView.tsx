"use client"

import {
  useRef,
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
  useMemo,
} from "react"
import type { ParsedDocument, PdfSource } from "@/app/lib/document/types"
import type { ReaderHighlight } from "@/app/lib/highlight/types"
import type { HighlightAnalysis } from "@/app/lib/highlightAnalysis/types"
import type { HighlightAnalysisControls } from "@/app/lib/highlightAnalysis/useHighlightAnalysis"
import { normalizeHighlightRanges } from "@/app/lib/highlight/normalize"
import { ThemeToggle } from "@/app/components/ThemeToggle"

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  doc: ParsedDocument
  highlights: ReaderHighlight[]
  controls: HighlightAnalysisControls
  onClose: () => void
}

interface TextSegment {
  text: string
  highlightId?: string
}

interface PageSegments {
  pageNum?: number
  charStart: number
  charEnd: number
  segments: TextSegment[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function collapseLineBreaks(text: string): string {
  return text.replace(/\n(?!\n)/g, (_, offset, str: string) =>
    offset > 0 && str[offset - 1] === "\n" ? "\n" : " "
  )
}

function getPdfPageBoundaries(doc: ParsedDocument): number[] {
  if (doc.metadata.fileType !== "pdf") return []
  const boundaries: number[] = []
  let lastPage = -1
  for (const span of doc.spans) {
    if (span.source.kind !== "pdf") continue
    const page = (span.source as PdfSource).page
    if (lastPage !== -1 && page !== lastPage) {
      boundaries.push(span.start)
    }
    lastPage = page
  }
  return boundaries
}

function getSnappedProseWidth(doc: ParsedDocument): number | null {
  if (doc.metadata.fileType !== "pdf") return null
  let minX = Infinity
  let maxRight = -Infinity
  for (const span of doc.spans) {
    if (span.source.kind !== "pdf" || (span.source as PdfSource).page !== 1) continue
    for (const box of (span.source as PdfSource).boxes) {
      if (box.width > 0) {
        minX = Math.min(minX, box.x)
        maxRight = Math.max(maxRight, box.x + box.width)
      }
    }
  }
  if (minX === Infinity) return null
  const widthPt = maxRight - minX
  return Math.max(400, Math.round(widthPt * (96 / 72)))
}

function buildTextSegments(text: string, highlights: ReaderHighlight[]): TextSegment[] {
  if (highlights.length === 0) return [{ text }]
  const sorted = [...highlights].sort((a, b) => a.canonicalStart - b.canonicalStart)
  const segments: TextSegment[] = []
  let cursor = 0
  for (const h of sorted) {
    if (cursor < h.canonicalStart) segments.push({ text: text.slice(cursor, h.canonicalStart) })
    segments.push({ text: text.slice(h.canonicalStart, h.canonicalEnd), highlightId: h.id })
    cursor = h.canonicalEnd
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) })
  return segments
}

function buildPagedSegments(
  doc: ParsedDocument,
  highlights: ReaderHighlight[]
): PageSegments[] {
  const isPdf = doc.metadata.fileType === "pdf"
  const boundaries = getPdfPageBoundaries(doc)
  const rangeBounds = [0, ...boundaries, doc.text.length]

  return rangeBounds.slice(0, -1).map((start, i) => {
    const end = rangeBounds[i + 1]
    const pageNum = boundaries.length > 0 ? i + 1 : undefined
    const pageText = doc.text.slice(start, end)

    const pageHighlights = highlights
      .filter((h) => h.canonicalStart >= start && h.canonicalStart < end)
      .map((h) => ({
        ...h,
        canonicalStart: h.canonicalStart - start,
        canonicalEnd: Math.min(h.canonicalEnd, end) - start,
      }))

    const rawSegments = buildTextSegments(pageText, pageHighlights)
    const segments = isPdf
      ? rawSegments.map((s) => ({ ...s, text: collapseLineBreaks(s.text) }))
      : rawSegments

    return { pageNum, charStart: start, charEnd: end, segments }
  })
}

function stackCardPositions(
  idealYs: Map<string, number>,
  cardHeights: Map<string, number>,
  minGap = 10
): Map<string, number> {
  const entries = [...idealYs.entries()].sort((a, b) => a[1] - b[1])
  const result = new Map<string, number>()
  let nextY = 0
  for (const [id, idealY] of entries) {
    const y = Math.max(idealY, nextY)
    result.set(id, y)
    nextY = y + (cardHeights.get(id) ?? 160) + minGap
  }
  return result
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function HighlightAnalysisView({ doc, highlights, controls, onClose }: Props) {
  const { analyses, isRunning, startAnalysis, retryHighlight, askFollowUp } = controls
  const normalized = normalizeHighlightRanges(highlights)
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(false)

  const highlightSpanRefs = useRef<Map<string, HTMLElement>>(new Map())

  const pagedSegments = useMemo(
    () => buildPagedSegments(doc, normalized),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, highlights]
  )

  useEffect(() => {
    if (analyses.size === 0 && !isRunning) startAnalysis()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function check() { setIsMobile(window.innerWidth < 768) }
    check()
    window.addEventListener("resize", check)
    return () => window.removeEventListener("resize", check)
  }, [])

  function handleHighlightClick(id: string) {
    setActiveHighlightId(id)
  }

  function handleCardClick(id: string) {
    setActiveHighlightId(id)
    const span = highlightSpanRefs.current.get(id)
    if (span) span.scrollIntoView({ behavior: "smooth", block: "center" })
  }

  function handleCloseSheet() { setActiveHighlightId(null) }

  function handleSheetNavigate(id: string) {
    setActiveHighlightId(id)
    const span = highlightSpanRefs.current.get(id)
    if (span) span.scrollIntoView({ behavior: "smooth", block: "center" })
  }

  return (
    <div
      className="flex flex-col h-screen overflow-hidden"
      style={{ background: "var(--bg)" }}
    >
      {/* Header */}
      <header
        className="shrink-0 flex items-center gap-4 px-5 py-0 h-11"
        style={{
          background: "var(--surface)",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-xs font-mono text-ink-3 hover:text-ink-1 transition-colors py-1 rounded"
          aria-label="Close analysis"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
            <path d="M10.78 3.22a.75.75 0 0 1 0 1.06L7.06 8l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" />
          </svg>
          Back
        </button>

        <div
          className="w-px h-3.5 shrink-0"
          style={{ background: "var(--border)" }}
          aria-hidden="true"
        />

        <div className="flex-1 min-w-0 flex items-center gap-3">
          <h1 className="text-sm font-medium text-ink-1 truncate">
            {doc.metadata.fileName}
          </h1>
          <span className="text-[11px] font-mono text-ink-3 shrink-0">
            {normalized.length} {normalized.length === 1 ? "highlight" : "highlights"}
            {isRunning && " · analyzing…"}
          </span>
        </div>

        <ThemeToggle />
      </header>

      {isMobile ? (
        <MobileLayout
          doc={doc}
          normalized={normalized}
          pagedSegments={pagedSegments}
          activeHighlightId={activeHighlightId}
          analyses={analyses}
          highlightSpanRefs={highlightSpanRefs}
          onHighlightClick={handleHighlightClick}
          onCloseSheet={handleCloseSheet}
          onNavigate={handleSheetNavigate}
          onRetry={retryHighlight}
          onAskFollowUp={askFollowUp}
        />
      ) : (
        <DesktopLayout
          doc={doc}
          normalized={normalized}
          pagedSegments={pagedSegments}
          activeHighlightId={activeHighlightId}
          analyses={analyses}
          highlightSpanRefs={highlightSpanRefs}
          onHighlightClick={handleHighlightClick}
          onCardClick={handleCardClick}
          onRetry={retryHighlight}
          onAskFollowUp={askFollowUp}
        />
      )}
    </div>
  )
}

// ── Desktop layout ────────────────────────────────────────────────────────────

const RAIL_MIN = 200
const RAIL_MAX = 480
const RAIL_DEFAULT = 288

interface DesktopLayoutProps {
  doc: ParsedDocument
  normalized: ReaderHighlight[]
  pagedSegments: PageSegments[]
  activeHighlightId: string | null
  analyses: Map<string, HighlightAnalysis>
  highlightSpanRefs: React.MutableRefObject<Map<string, HTMLElement>>
  onHighlightClick: (id: string) => void
  onCardClick: (id: string) => void
  onRetry: (id: string) => void
  onAskFollowUp: (id: string, q: string) => void
}

function DesktopLayout({
  doc,
  normalized,
  pagedSegments,
  activeHighlightId,
  analyses,
  highlightSpanRefs,
  onHighlightClick,
  onCardClick,
  onRetry,
  onAskFollowUp,
}: DesktopLayoutProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [cardPositions, setCardPositions] = useState<Map<string, number>>(new Map())
  const [rightColHeight, setRightColHeight] = useState(0)

  const [railWidth, setRailWidth] = useState(RAIL_DEFAULT)
  const [isDragging, setIsDragging] = useState(false)
  const dragState = useRef({ startX: 0, startWidth: 0 })

  const [snapToPage, setSnapToPage] = useState(false)
  const snappedProseWidth = useMemo(() => getSnappedProseWidth(doc), [doc])
  const proseMaxWidth = snapToPage && snappedProseWidth ? snappedProseWidth : 680

  useEffect(() => {
    if (!activeHighlightId) return
    const card = cardRefs.current.get(activeHighlightId)
    if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }, [activeHighlightId])

  const recomputePositions = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const containerTop = container.getBoundingClientRect().top
    const scrollTop = container.scrollTop

    const idealYs = new Map<string, number>()
    for (const [id, el] of highlightSpanRefs.current) {
      const rect = el.getBoundingClientRect()
      idealYs.set(id, rect.top - containerTop + scrollTop)
    }

    const cardHeights = new Map<string, number>()
    for (const [id, el] of cardRefs.current) {
      cardHeights.set(id, el.offsetHeight)
    }

    const positions = stackCardPositions(idealYs, cardHeights)
    setCardPositions(positions)

    let maxBottom = 0
    for (const [id, top] of positions) {
      maxBottom = Math.max(maxBottom, top + (cardHeights.get(id) ?? 160))
    }
    setRightColHeight(Math.max(maxBottom + 32, container.scrollHeight))
  }, [highlightSpanRefs])

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => recomputePositions())
    return () => cancelAnimationFrame(frame)
  }, [analyses, recomputePositions, railWidth, proseMaxWidth])

  useEffect(() => {
    const observer = new ResizeObserver(() => recomputePositions())
    const container = scrollContainerRef.current
    if (container) observer.observe(container)
    return () => observer.disconnect()
  }, [recomputePositions])

  function handleDragStart(e: React.MouseEvent) {
    e.preventDefault()
    dragState.current = { startX: e.clientX, startWidth: railWidth }
    setIsDragging(true)
  }

  useEffect(() => {
    if (!isDragging) return
    function onMove(e: MouseEvent) {
      const delta = dragState.current.startX - e.clientX
      setRailWidth(Math.max(RAIL_MIN, Math.min(RAIL_MAX, dragState.current.startWidth + delta)))
    }
    function onUp() { setIsDragging(false) }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
  }, [isDragging])

  useEffect(() => {
    if (isDragging) {
      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"
    } else {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
    return () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
  }, [isDragging])

  const hasPdfPages = doc.metadata.fileType === "pdf" && (doc.metadata.pageCount ?? 0) > 1

  return (
    <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
      <div className="flex min-h-full max-w-[1600px] mx-auto">

        {/* Document column */}
        <div className="flex-1 min-w-0 px-10 lg:px-16 py-10">
          {snappedProseWidth && (
            <div className="mb-5 flex items-center gap-2">
              <button
                onClick={() => setSnapToPage((p) => !p)}
                className="flex items-center gap-1.5 text-[11px] font-mono px-2 py-1 rounded transition-colors"
                style={{
                  border: "1px solid var(--border)",
                  color: snapToPage ? "var(--accent)" : "var(--ink-3)",
                  borderColor: snapToPage ? "var(--accent-border)" : "var(--border)",
                  background: snapToPage ? "var(--accent-soft)" : "transparent",
                }}
                title="Constrain to original PDF page width"
              >
                <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.25">
                  <rect x="1.5" y="0.5" width="9" height="11" rx="1" />
                  <path d="M3 3h6M3 5.5h6M3 8h3.5" strokeLinecap="round" />
                </svg>
                Page width
              </button>
              {snapToPage && snappedProseWidth && (
                <span className="text-[11px] font-mono" style={{ color: "var(--ink-3)" }}>
                  {snappedProseWidth}px
                </span>
              )}
            </div>
          )}

          <div style={{ maxWidth: proseMaxWidth }}>
            <DocumentText
              pagedSegments={pagedSegments}
              activeHighlightId={activeHighlightId}
              analyses={analyses}
              highlightSpanRefs={highlightSpanRefs}
              showPageBreaks={hasPdfPages}
              onHighlightClick={onHighlightClick}
            />
          </div>
        </div>

        {/* Drag handle */}
        <div
          onMouseDown={handleDragStart}
          className={`w-[5px] shrink-0 cursor-col-resize relative group ${isDragging ? "z-10" : ""}`}
          aria-hidden="true"
        >
          <div
            className="absolute inset-y-0 left-[2px] w-px transition-colors"
            style={{
              background: isDragging
                ? "var(--accent)"
                : "var(--border-subtle)",
            }}
          />
        </div>

        {/* Annotation rail */}
        <div
          className="shrink-0 relative"
          style={{
            width: railWidth,
            height: rightColHeight || undefined,
            borderLeft: "1px solid var(--border-subtle)",
          }}
        >
          {normalized.map((h) => {
            const analysis = analyses.get(h.id)
            if (!analysis) return null
            const top = cardPositions.get(h.id)
            return (
              <div
                key={h.id}
                ref={(el) => {
                  if (el) cardRefs.current.set(h.id, el)
                  else cardRefs.current.delete(h.id)
                }}
                style={top !== undefined ? { position: "absolute", top, left: 0, right: 0 } : undefined}
                className="px-5 py-3"
              >
                <AnnotationCard
                  highlight={h}
                  analysis={analysis}
                  isActive={activeHighlightId === h.id}
                  canonicalText={doc.text}
                  onClick={() => onCardClick(h.id)}
                  onRetry={() => onRetry(h.id)}
                  onAskFollowUp={(q) => onAskFollowUp(h.id, q)}
                />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Mobile layout ─────────────────────────────────────────────────────────────

interface MobileLayoutProps {
  doc: ParsedDocument
  normalized: ReaderHighlight[]
  pagedSegments: PageSegments[]
  activeHighlightId: string | null
  analyses: Map<string, HighlightAnalysis>
  highlightSpanRefs: React.MutableRefObject<Map<string, HTMLElement>>
  onHighlightClick: (id: string) => void
  onCloseSheet: () => void
  onNavigate: (id: string) => void
  onRetry: (id: string) => void
  onAskFollowUp: (id: string, q: string) => void
}

function MobileLayout({
  doc,
  normalized,
  pagedSegments,
  activeHighlightId,
  analyses,
  highlightSpanRefs,
  onHighlightClick,
  onCloseSheet,
  onNavigate,
  onRetry,
  onAskFollowUp,
}: MobileLayoutProps) {
  const sheetHighlight = activeHighlightId
    ? normalized.find((h) => h.id === activeHighlightId) ?? null
    : null
  const sheetIdx = sheetHighlight ? normalized.indexOf(sheetHighlight) : -1
  const sheetAnalysis = sheetHighlight ? analyses.get(sheetHighlight.id) : undefined
  const hasPdfPages = doc.metadata.fileType === "pdf" && (doc.metadata.pageCount ?? 0) > 1

  return (
    <div className="flex-1 relative overflow-hidden">
      <div className="absolute inset-0 overflow-y-auto">
        <div className="px-5 py-8 pb-24">
          <DocumentText
            pagedSegments={pagedSegments}
            activeHighlightId={activeHighlightId}
            analyses={analyses}
            highlightSpanRefs={highlightSpanRefs}
            showPageBreaks={hasPdfPages}
            onHighlightClick={onHighlightClick}
          />
        </div>
      </div>

      {/* Bottom sheet */}
      {sheetHighlight && (
        <div
          className="absolute bottom-0 left-0 right-0 z-20 flex flex-col rounded-t-2xl"
          style={{
            background: "var(--surface-raised)",
            maxHeight: "70vh",
            boxShadow: "0 -4px 32px rgba(0,0,0,0.12)",
          }}
        >
          {/* Drag indicator */}
          <div className="flex justify-center pt-3 pb-1 shrink-0">
            <div className="w-8 h-1 rounded-full" style={{ background: "var(--border)" }} />
          </div>

          {/* Sheet header */}
          <div
            className="flex items-center gap-3 px-4 py-2 shrink-0"
            style={{ borderBottom: "1px solid var(--border-subtle)" }}
          >
            <div className="flex items-center gap-1">
              <button
                onClick={() => sheetIdx > 0 && onNavigate(normalized[sheetIdx - 1].id)}
                disabled={sheetIdx <= 0}
                className="p-1.5 rounded transition-colors disabled:opacity-30"
                style={{ color: "var(--ink-3)" }}
                aria-label="Previous highlight"
              >
                <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M10.78 3.22a.75.75 0 0 1 0 1.06L7.06 8l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" />
                </svg>
              </button>
              <button
                onClick={() => sheetIdx < normalized.length - 1 && onNavigate(normalized[sheetIdx + 1].id)}
                disabled={sheetIdx >= normalized.length - 1}
                className="p-1.5 rounded transition-colors disabled:opacity-30"
                style={{ color: "var(--ink-3)" }}
                aria-label="Next highlight"
              >
                <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M5.22 3.22a.75.75 0 0 0 0 1.06L8.94 8l-3.72 3.72a.75.75 0 1 0 1.06 1.06l4.25-4.25a.75.75 0 0 0 0-1.06L6.28 3.22a.75.75 0 0 0-1.06 0Z" />
                </svg>
              </button>
            </div>
            <span className="flex-1 text-[11px] font-mono text-center" style={{ color: "var(--ink-3)" }}>
              {sheetIdx + 1} of {normalized.length}
            </span>
            <button
              onClick={onCloseSheet}
              className="p-1.5 rounded transition-colors"
              style={{ color: "var(--ink-3)" }}
              aria-label="Close"
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
              </svg>
            </button>
          </div>

          {/* Excerpt preview */}
          <div
            className="px-4 py-3 shrink-0"
            style={{ borderBottom: "1px solid var(--border-subtle)" }}
          >
            <p
              className="text-[0.8125rem] italic leading-snug line-clamp-3"
              style={{ color: "var(--ink-2)", fontFamily: "var(--font-serif)" }}
            >
              &ldquo;{doc.text.slice(sheetHighlight.canonicalStart, sheetHighlight.canonicalEnd)}&rdquo;
            </p>
          </div>

          {/* Analysis content */}
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {sheetAnalysis ? (
              <AnnotationCard
                highlight={sheetHighlight}
                analysis={sheetAnalysis}
                isActive={true}
                canonicalText={doc.text}
                hideExcerpt
                onClick={() => {}}
                onRetry={() => onRetry(sheetHighlight.id)}
                onAskFollowUp={(q) => onAskFollowUp(sheetHighlight.id, q)}
              />
            ) : (
              <div className="flex items-center gap-2 text-[11px] font-mono" style={{ color: "var(--ink-3)" }}>
                <span
                  className="inline-block w-3 h-3 rounded-full border-2 border-t-transparent animate-spin"
                  style={{ borderColor: "var(--ink-3)", borderTopColor: "transparent" }}
                />
                Analyzing…
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Document text renderer ────────────────────────────────────────────────────

interface DocumentTextProps {
  pagedSegments: PageSegments[]
  activeHighlightId: string | null
  analyses: Map<string, HighlightAnalysis>
  highlightSpanRefs: React.MutableRefObject<Map<string, HTMLElement>>
  showPageBreaks: boolean
  onHighlightClick: (id: string) => void
}

function DocumentText({
  pagedSegments,
  activeHighlightId,
  analyses,
  highlightSpanRefs,
  showPageBreaks,
  onHighlightClick,
}: DocumentTextProps) {
  return (
    <div
      className="text-[1.0625rem] leading-[1.8] break-words hyphens-auto"
      style={{
        fontFamily: "var(--font-serif)",
        color: "var(--ink-1)",
        WebkitHyphens: "auto" as React.CSSProperties["WebkitHyphens"],
      }}
    >
      {pagedSegments.map((page, pageIdx) => (
        <div key={pageIdx}>
          {pageIdx > 0 && showPageBreaks && (
            <div className="my-10 flex flex-col items-center gap-2" aria-hidden="true">
              <div className="w-full" style={{ borderTop: "1px dashed var(--border-subtle)" }} />
              {page.pageNum && (
                <span
                  className="text-[9px] font-mono uppercase tracking-widest select-none"
                  style={{ color: "var(--ink-3)" }}
                >
                  Page {page.pageNum}
                </span>
              )}
            </div>
          )}

          <div className="whitespace-pre-wrap">
            {page.segments.map((seg, i) => {
              if (!seg.highlightId) {
                return <span key={i}>{seg.text}</span>
              }
              const id = seg.highlightId
              const isActive = id === activeHighlightId
              const analysis = analyses.get(id)
              const hasAnalysis = analysis?.status === "complete"
              return (
                <mark
                  key={i}
                  ref={(el) => {
                    if (el) highlightSpanRefs.current.set(id, el)
                    else highlightSpanRefs.current.delete(id)
                  }}
                  onClick={() => onHighlightClick(id)}
                  title={hasAnalysis ? "Click to see analysis" : undefined}
                  className="cursor-pointer rounded-sm transition-colors"
                  style={{
                    backgroundColor: isActive ? "var(--hl-active)" : "var(--hl-soft)",
                    WebkitTextFillColor: "inherit",
                  }}
                >
                  {seg.text}
                </mark>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Annotation card ───────────────────────────────────────────────────────────

interface AnnotationCardProps {
  highlight: ReaderHighlight
  analysis: HighlightAnalysis
  isActive: boolean
  canonicalText: string
  hideExcerpt?: boolean
  onClick: () => void
  onRetry: () => void
  onAskFollowUp: (question: string) => void
}

const MAX_EXCERPT_CHARS = 100
const MAX_FOLLOW_UP_CHARS = 500

function AnnotationCard({
  highlight,
  analysis,
  isActive,
  canonicalText,
  hideExcerpt = false,
  onClick,
  onRetry,
  onAskFollowUp,
}: AnnotationCardProps) {
  const [followUpText, setFollowUpText] = useState("")
  const [showFollowUp, setShowFollowUp] = useState(false)

  const prevFollowUpStatus = useRef(analysis.followUpStatus)
  useEffect(() => {
    const prev = prevFollowUpStatus.current
    prevFollowUpStatus.current = analysis.followUpStatus
    if (prev === "loading" && analysis.followUpStatus === "idle") {
      setFollowUpText("")
      setShowFollowUp(false)
    }
  }, [analysis.followUpStatus])

  const excerpt = canonicalText.slice(highlight.canonicalStart, highlight.canonicalEnd)
  const displayExcerpt =
    excerpt.length > MAX_EXCERPT_CHARS
      ? excerpt.slice(0, MAX_EXCERPT_CHARS).trimEnd() + "…"
      : excerpt

  function handleSubmitFollowUp(e: React.FormEvent) {
    e.preventDefault()
    const q = followUpText.trim()
    if (!q || q.length > MAX_FOLLOW_UP_CHARS) return
    onAskFollowUp(q)
  }

  return (
    <div
      onClick={onClick}
      className="cursor-pointer transition-opacity"
      style={{
        opacity: isActive ? 1 : 0.75,
        paddingLeft: "10px",
        borderLeft: isActive
          ? `2px solid var(--hl)`
          : `2px solid var(--border)`,
      }}
    >
      {!hideExcerpt && (
        <p
          className="text-[11px] italic leading-snug mb-2 line-clamp-2"
          style={{
            color: "var(--ink-3)",
            fontFamily: "var(--font-serif)",
          }}
        >
          &ldquo;{displayExcerpt}&rdquo;
        </p>
      )}

      {analysis.status === "pending" && (
        <div className="flex items-center gap-1.5 text-[11px] font-mono" style={{ color: "var(--ink-3)" }}>
          <span
            className="inline-block w-2.5 h-2.5 rounded-full border-[1.5px] border-t-transparent animate-spin"
            style={{ borderColor: "var(--ink-3)", borderTopColor: "transparent" }}
          />
          Analyzing…
        </div>
      )}

      {analysis.status === "error" && (
        <div className="text-[11px] space-y-1">
          <p style={{ color: "var(--danger)" }}>Analysis unavailable.</p>
          <button
            onClick={(e) => { e.stopPropagation(); onRetry() }}
            className="text-accent hover:underline font-mono"
          >
            Retry
          </button>
        </div>
      )}

      {analysis.status === "complete" && (
        <div className="space-y-3">
          {/* Explanation */}
          <div onClick={(e) => e.stopPropagation()}>
            <p
              className="text-[0.8125rem] leading-snug text-ink-1"
            >
              {analysis.explanation}
            </p>
          </div>

          {/* Key points */}
          {analysis.keyPoints.length > 0 && (
            <div onClick={(e) => e.stopPropagation()}>
              <p className="text-[10px] font-mono uppercase tracking-wider mb-1.5" style={{ color: "var(--ink-3)" }}>
                Key ideas
              </p>
              <ul className="space-y-1">
                {analysis.keyPoints.map((pt, i) => (
                  <li key={i} className="flex gap-2 text-[0.8125rem] text-ink-2 leading-snug">
                    <span style={{ color: "var(--hl)" }} className="shrink-0">·</span>
                    <span>{pt}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Relation to reading */}
          <div onClick={(e) => e.stopPropagation()}>
            <p className="text-[10px] font-mono uppercase tracking-wider mb-1" style={{ color: "var(--ink-3)" }}>
              In this reading
            </p>
            <p className="text-[0.8125rem] text-ink-2 leading-snug">
              {analysis.relationToReading}
            </p>
          </div>

          {/* Follow-up */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="pt-2"
            style={{ borderTop: "1px solid var(--border-subtle)" }}
          >
            {analysis.followUpAnswer && (
              <div
                className="mb-3 px-3 py-2 rounded-md"
                style={{ background: "var(--accent-soft)" }}
              >
                <p className="text-[10px] font-mono uppercase tracking-wider mb-1" style={{ color: "var(--accent)" }}>
                  Answer
                </p>
                <p className="text-[0.8125rem] text-ink-1 leading-snug">
                  {analysis.followUpAnswer}
                </p>
              </div>
            )}

            {analysis.followUpStatus === "error" && (
              <p className="text-[11px] mb-2" style={{ color: "var(--danger)" }}>
                Follow-up failed. Try again.
              </p>
            )}

            {!showFollowUp ? (
              <button
                onClick={() => setShowFollowUp(true)}
                className="text-[11px] font-mono transition-colors hover:text-accent"
                style={{ color: "var(--ink-3)" }}
              >
                Ask about this passage…
              </button>
            ) : (
              <form onSubmit={handleSubmitFollowUp} className="space-y-2">
                <textarea
                  value={followUpText}
                  onChange={(e) => setFollowUpText(e.target.value)}
                  placeholder="Ask a follow-up question…"
                  rows={2}
                  maxLength={MAX_FOLLOW_UP_CHARS}
                  className="w-full rounded px-2.5 py-1.5 text-[0.8125rem] placeholder:text-ink-3 resize-none"
                  style={{
                    background: "var(--surface-inset)",
                    border: "1px solid var(--border)",
                    color: "var(--ink-1)",
                    fontFamily: "var(--font-sans)",
                  }}
                />
                <div className="flex items-center justify-between">
                  <span
                    className="text-[11px] font-mono"
                    style={{
                      color: followUpText.length > MAX_FOLLOW_UP_CHARS - 50
                        ? "var(--warning)"
                        : "var(--ink-3)",
                    }}
                  >
                    {followUpText.length}/{MAX_FOLLOW_UP_CHARS}
                  </span>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => { setShowFollowUp(false); setFollowUpText("") }}
                      className="text-[11px] font-mono transition-colors hover:text-ink-1"
                      style={{ color: "var(--ink-3)" }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={!followUpText.trim() || followUpText.length > MAX_FOLLOW_UP_CHARS || analysis.followUpStatus === "loading"}
                      className="text-[11px] font-mono px-2.5 py-1 rounded transition-opacity disabled:opacity-40 text-accent-ink"
                      style={{ background: "var(--accent)" }}
                    >
                      {analysis.followUpStatus === "loading" ? "…" : "Ask"}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
