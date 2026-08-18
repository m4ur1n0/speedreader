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

/**
 * Collapse PDF extraction line-break artifacts.
 * PDF parsers emit \n at every line end in the original layout. These are not
 * intentional soft breaks — the text should reflow. We collapse isolated \n
 * to a space while leaving \n\n+ (real paragraph gaps) intact.
 * Only applied to PDF files, not plain text.
 */
function collapseLineBreaks(text: string): string {
  return text.replace(/\n(?!\n)/g, (_, offset, str: string) =>
    offset > 0 && str[offset - 1] === "\n" ? "\n" : " "
  )
}

/**
 * Returns character offsets in doc.text where each new PDF page begins.
 * Empty array for non-PDF or single-page documents.
 */
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

/**
 * Computes the text-column width of page 1 in screen pixels (96 dpi),
 * by measuring the bounding box extent of all spans on page 1.
 * Returns null for non-PDF or when no box data is available.
 */
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

/**
 * Splits doc.text into page blocks (or one block for non-PDF), builds text
 * segments per block with highlight regions mapped to page-relative offsets,
 * and optionally applies PDF line-break collapsing.
 */
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

    // Highlights that start within this page range (truncated at page boundary)
    const pageHighlights = highlights
      .filter((h) => h.canonicalStart >= start && h.canonicalStart < end)
      .map((h) => ({
        ...h,
        canonicalStart: h.canonicalStart - start,
        canonicalEnd: Math.min(h.canonicalEnd, end) - start,
      }))

    const rawSegments = buildTextSegments(pageText, pageHighlights)

    // For PDFs: collapse single \n to space in each segment's display text
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

  // highlightSpanRefs is shared: desktop uses it for card alignment,
  // mobile uses it for scrollIntoView on prev/next navigation.
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
    // On desktop, card scroll-into-view happens inside DesktopLayout via the rail
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
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      <header className="shrink-0 flex items-center gap-4 px-4 sm:px-6 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          aria-label="Close analysis"
        >
          <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
            AI Analysis — {doc.metadata.fileName}
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {normalized.length} {normalized.length === 1 ? "highlight" : "highlights"}
            {isRunning && " · Analyzing…"}
          </p>
        </div>
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
const RAIL_MAX = 520
const RAIL_DEFAULT = 308

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
  // Position state lives here — desktop-only
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [cardPositions, setCardPositions] = useState<Map<string, number>>(new Map())
  const [rightColHeight, setRightColHeight] = useState(0)

  // Rail resize state
  const [railWidth, setRailWidth] = useState(RAIL_DEFAULT)
  const [isDragging, setIsDragging] = useState(false)
  const dragState = useRef({ startX: 0, startWidth: 0 })

  // Snap to original page width
  const [snapToPage, setSnapToPage] = useState(false)
  const snappedProseWidth = useMemo(() => getSnappedProseWidth(doc), [doc])
  const proseMaxWidth = snapToPage && snappedProseWidth ? snappedProseWidth : 700

  // When active highlight changes, scroll its card into view in the rail
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

  // Recompute after analyses arrive, or when layout changes (rail resize, snap toggle)
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => recomputePositions())
    return () => cancelAnimationFrame(frame)
  }, [analyses, recomputePositions, railWidth, proseMaxWidth])

  // ResizeObserver for viewport changes
  useEffect(() => {
    const observer = new ResizeObserver(() => recomputePositions())
    const container = scrollContainerRef.current
    if (container) observer.observe(container)
    return () => observer.disconnect()
  }, [recomputePositions])

  // ── Drag handle ─────────────────────────────────────────────────────────────
  function handleDragStart(e: React.MouseEvent) {
    e.preventDefault()
    dragState.current = { startX: e.clientX, startWidth: railWidth }
    setIsDragging(true)
  }

  useEffect(() => {
    if (!isDragging) return
    function onMove(e: MouseEvent) {
      const delta = dragState.current.startX - e.clientX // drag left = wider rail
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

  // Cursor lock while dragging so it doesn't flicker when over text
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
          {/* Toolbar: snap button */}
          {snappedProseWidth && (
            <div className="mb-4 flex items-center gap-2">
              <button
                onClick={() => setSnapToPage((p) => !p)}
                title="Constrain prose to original PDF page column width"
                className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border transition-colors ${
                  snapToPage
                    ? "bg-blue-50 dark:bg-blue-950/40 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300"
                    : "border-zinc-200 dark:border-zinc-700 text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-600"
                }`}
              >
                {/* Page icon */}
                <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25">
                  <rect x="2" y="1" width="10" height="12" rx="1" />
                  <path d="M4 4h6M4 6.5h6M4 9h4" strokeLinecap="round" />
                </svg>
                Page width
              </button>
              {snapToPage && snappedProseWidth && (
                <span className="text-xs text-zinc-400 dark:text-zinc-500">{snappedProseWidth}px</span>
              )}
            </div>
          )}

          {/* Prose container — left-anchored, width driven by snap or default */}
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
          className={`w-[6px] shrink-0 cursor-col-resize relative group ${isDragging ? "z-10" : ""}`}
          title="Drag to resize"
          aria-hidden="true"
        >
          <div className={`absolute inset-y-0 left-[2px] w-[2px] transition-colors rounded-full ${
            isDragging
              ? "bg-blue-500"
              : "bg-zinc-200 dark:bg-zinc-700 group-hover:bg-blue-400 dark:group-hover:bg-blue-500"
          }`} />
        </div>

        {/* Annotation rail */}
        <div
          className="shrink-0 relative border-l border-zinc-100 dark:border-zinc-800"
          style={{ width: railWidth, height: rightColHeight || undefined }}
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
                className="px-4 py-3"
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

// ── Mobile layout — full-width document + bottom sheet ────────────────────────

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

      {sheetHighlight && (
        <div
          className="absolute bottom-0 left-0 right-0 z-20 flex flex-col rounded-t-2xl bg-white dark:bg-zinc-900 shadow-[0_-8px_40px_rgba(0,0,0,0.15)] dark:shadow-[0_-8px_40px_rgba(0,0,0,0.5)]"
          style={{ maxHeight: "70vh" }}
        >
          <div className="flex justify-center pt-2.5 pb-1 shrink-0">
            <div className="w-9 h-1 rounded-full bg-zinc-300 dark:bg-zinc-600" />
          </div>

          <div className="flex items-center gap-3 px-4 py-2 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
            <div className="flex items-center gap-1">
              <button
                onClick={() => sheetIdx > 0 && onNavigate(normalized[sheetIdx - 1].id)}
                disabled={sheetIdx <= 0}
                className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                aria-label="Previous highlight"
              >
                <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M10.78 3.22a.75.75 0 0 1 0 1.06L7.06 8l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" />
                </svg>
              </button>
              <button
                onClick={() => sheetIdx < normalized.length - 1 && onNavigate(normalized[sheetIdx + 1].id)}
                disabled={sheetIdx >= normalized.length - 1}
                className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                aria-label="Next highlight"
              >
                <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M5.22 3.22a.75.75 0 0 0 0 1.06L8.94 8l-3.72 3.72a.75.75 0 1 0 1.06 1.06l4.25-4.25a.75.75 0 0 0 0-1.06L6.28 3.22a.75.75 0 0 0-1.06 0Z" />
                </svg>
              </button>
            </div>
            <span className="flex-1 text-xs font-medium text-zinc-500 dark:text-zinc-400 text-center">
              Highlight {sheetIdx + 1} of {normalized.length}
            </span>
            <button
              onClick={onCloseSheet}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              aria-label="Close"
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
              </svg>
            </button>
          </div>

          <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
            <p className="text-xs italic text-zinc-500 dark:text-zinc-400 leading-snug line-clamp-3">
              &ldquo;{doc.text.slice(sheetHighlight.canonicalStart, sheetHighlight.canonicalEnd)}&rdquo;
            </p>
          </div>

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
              <div className="flex items-center gap-2 text-xs text-zinc-400 dark:text-zinc-500">
                <span className="inline-block w-3 h-3 border-2 border-zinc-300 border-t-zinc-500 rounded-full animate-spin" />
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
    <div className="font-serif text-[1.0625rem] leading-[1.8] text-zinc-800 dark:text-zinc-200 break-words hyphens-auto selection:bg-blue-100 dark:selection:bg-blue-900">
      {pagedSegments.map((page, pageIdx) => (
        <div key={pageIdx}>
          {/* Page break separator — only between pages, not before the first */}
          {pageIdx > 0 && showPageBreaks && (
            <div className="my-10 flex flex-col items-center gap-2" aria-hidden="true">
              <div className="w-full border-t border-dashed border-zinc-200 dark:border-zinc-700" />
              {page.pageNum && (
                <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-300 dark:text-zinc-600 select-none">
                  Page {page.pageNum}
                </span>
              )}
            </div>
          )}

          {/* Each page's text — whitespace-pre-wrap preserves \n\n paragraph gaps */}
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
                  className={[
                    "cursor-pointer rounded-sm transition-colors",
                    isActive
                      ? "bg-amber-400 dark:bg-amber-500"
                      : "bg-amber-200 dark:bg-amber-800/60 hover:bg-amber-300 dark:hover:bg-amber-700/70",
                  ].join(" ")}
                  style={{ WebkitTextFillColor: "inherit" }}
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

const MAX_EXCERPT_CHARS = 120
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

  // Clear the input only when a successful response arrives (loading → idle).
  // On error the text stays so the user can retry without retyping.
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
    // Do NOT clear followUpText here — it stays until a response arrives
    // so the question isn't lost if the Gemini call fails.
  }

  const borderColor = isActive
    ? "border-amber-500 dark:border-amber-400"
    : "border-zinc-200 dark:border-zinc-700"

  return (
    <div
      onClick={onClick}
      className={[
        "rounded-xl border bg-white dark:bg-zinc-900 shadow-sm cursor-pointer transition-all",
        borderColor,
        isActive ? "ring-1 ring-amber-400 dark:ring-amber-500" : "",
      ].join(" ")}
    >
      {!hideExcerpt && (
        <div className="px-4 pt-3 pb-2 border-b border-zinc-100 dark:border-zinc-800">
          <p className="text-xs text-zinc-500 dark:text-zinc-400 italic leading-snug line-clamp-2">
            &ldquo;{displayExcerpt}&rdquo;
          </p>
        </div>
      )}

      <div className="px-4 py-3 space-y-3">
        {analysis.status === "pending" && (
          <div className="flex items-center gap-2 text-xs text-zinc-400 dark:text-zinc-500">
            <span className="inline-block w-3 h-3 border-2 border-zinc-300 border-t-zinc-500 rounded-full animate-spin" />
            Analyzing…
          </div>
        )}

        {analysis.status === "error" && (
          <div className="text-xs text-red-500 dark:text-red-400 space-y-1">
            <p>Analysis temporarily unavailable.</p>
            <button
              onClick={(e) => { e.stopPropagation(); onRetry() }}
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              Retry
            </button>
          </div>
        )}

        {analysis.status === "complete" && (
          <>
            <div onClick={(e) => e.stopPropagation()}>
              <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-1">
                Why this matters
              </p>
              <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-snug">
                {analysis.explanation}
              </p>
            </div>

            {analysis.keyPoints.length > 0 && (
              <div onClick={(e) => e.stopPropagation()}>
                <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-1">
                  Key points
                </p>
                <ul className="space-y-0.5">
                  {analysis.keyPoints.map((pt, i) => (
                    <li key={i} className="flex gap-1.5 text-sm text-zinc-700 dark:text-zinc-300 leading-snug">
                      <span className="text-amber-500 shrink-0 mt-0.5">•</span>
                      <span>{pt}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div onClick={(e) => e.stopPropagation()}>
              <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-1">
                In this reading
              </p>
              <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-snug">
                {analysis.relationToReading}
              </p>
            </div>

            <div onClick={(e) => e.stopPropagation()} className="pt-1 border-t border-zinc-100 dark:border-zinc-800">
              {analysis.followUpAnswer && (
                <div className="mb-2 rounded-lg bg-blue-50 dark:bg-blue-950/30 px-3 py-2">
                  <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-0.5">Answer</p>
                  <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-snug">
                    {analysis.followUpAnswer}
                  </p>
                </div>
              )}

              {analysis.followUpStatus === "error" && (
                <p className="text-xs text-red-500 dark:text-red-400 mb-2">
                  Follow-up failed. Try again.
                </p>
              )}

              {!showFollowUp ? (
                <button
                  onClick={() => setShowFollowUp(true)}
                  className="text-xs text-zinc-400 dark:text-zinc-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                >
                  Ask about this highlight…
                </button>
              ) : (
                <form onSubmit={handleSubmitFollowUp} className="space-y-1.5">
                  <textarea
                    value={followUpText}
                    onChange={(e) => setFollowUpText(e.target.value)}
                    placeholder="Ask a follow-up question…"
                    rows={2}
                    maxLength={MAX_FOLLOW_UP_CHARS}
                    className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-800 dark:text-zinc-200 placeholder-zinc-400 dark:placeholder-zinc-500 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <div className="flex items-center justify-between">
                    <span className={`text-xs ${followUpText.length > MAX_FOLLOW_UP_CHARS - 50 ? "text-amber-500" : "text-zinc-400"}`}>
                      {followUpText.length}/{MAX_FOLLOW_UP_CHARS}
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => { setShowFollowUp(false); setFollowUpText("") }}
                        className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={!followUpText.trim() || followUpText.length > MAX_FOLLOW_UP_CHARS || analysis.followUpStatus === "loading"}
                        className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-medium transition-colors"
                      >
                        {analysis.followUpStatus === "loading" ? "…" : "Ask"}
                      </button>
                    </div>
                  </div>
                </form>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
