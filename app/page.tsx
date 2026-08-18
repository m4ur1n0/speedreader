"use client";

import { useState, useMemo } from "react";
import FileUpload from "./components/FileUpload";
import { ReaderView } from "./components/reader/ReaderView";
import type { ReaderSession } from "./components/reader/ReaderView";
import { HighlightDigest } from "./components/HighlightDigest";
import { HighlightAnalysisView } from "./components/HighlightAnalysisView";
import { useHighlightAnalysis } from "./lib/highlightAnalysis/useHighlightAnalysis";
import type { ParsedDocument } from "./lib/document";
import { buildReaderModel } from "./lib/reader/tokenizer";
import type { ReaderHighlight } from "./lib/highlight/types";
import type { ReadingMode } from "./components/reader/ReaderControls";
import {
  estimateNormalReadingSeconds,
  estimateSpeedreaderSeconds,
  formatDuration,
  NORMAL_READING_WPM,
} from "./lib/reader/statsHelpers";
import { RAMP_MAX_WPM } from "./lib/reader/types";
import { ThemeToggle } from "./components/ThemeToggle";

export default function Home() {
  const [doc, setDoc] = useState<ParsedDocument | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [readerActive, setReaderActive] = useState(false);
  const [analysisActive, setAnalysisActive] = useState(false);
  const [session, setSession] = useState<ReaderSession | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [readerMode, setReaderMode] = useState<ReadingMode>("baseline");

  const readerModel = useMemo(
    () => (doc ? buildReaderModel(doc) : null),
    [doc]
  );

  const currentHighlights: ReaderHighlight[] = session?.highlights ?? [];

  const analysisControls = useHighlightAnalysis(
    currentHighlights,
    doc ?? { text: "", spans: [], metadata: { fileName: "", fileType: "" } }
  );

  function handleDocumentParsed(incoming: ParsedDocument | null, file: File | null) {
    setDoc(incoming);
    setSourceFile(file);
    setSession(null);
    setReaderActive(false);
    setAnalysisActive(false);
    setExportError(null);
  }

  function handleReaderExit(s: ReaderSession) {
    setSession(s);
    setReaderActive(false);
  }

  async function handleDownloadPdf(highlights: ReaderHighlight[]) {
    if (!doc || !sourceFile || highlights.length === 0) return;
    if (doc.metadata.fileType === "pdf") {
      const { downloadHighlightedPdf } = await import("./lib/highlight/pdfExport");
      const bytes = await sourceFile.arrayBuffer();
      await downloadHighlightedPdf(bytes, highlights, doc, sourceFile.name);
    } else {
      const { downloadTextAsPdf } = await import("./lib/highlight/textPdfExport");
      await downloadTextAsPdf(doc, highlights, sourceFile.name);
    }
  }

  function handleHomePageDownload() {
    if (!session) return;
    setExportError(null);
    handleDownloadPdf(session.highlights).catch((err) => {
      setExportError(err instanceof Error ? err.message : "Export failed.");
    });
  }

  const hasProgress = !!(session && session.currentTokenId > 0);
  const hasHighlights = !!(session && session.highlights.length > 0);

  function handleResumeSeek(tokenId: number) {
    if (!session) return;
    setSession({ ...session, currentTokenId: tokenId });
    setReaderActive(true);
  }

  // ── Full-screen takeovers ──────────────────────────────────────────────────

  if (readerActive && readerModel) {
    return (
      <ReaderView
        model={readerModel}
        onExit={handleReaderExit}
        initialSession={session}
        initialMode={readerMode}
        onDownloadPdf={doc ? handleDownloadPdf : null}
      />
    );
  }

  if (analysisActive && doc && hasHighlights) {
    return (
      <HighlightAnalysisView
        doc={doc}
        highlights={session!.highlights}
        controls={analysisControls}
        onClose={() => setAnalysisActive(false)}
      />
    );
  }

  // ── Home page ──────────────────────────────────────────────────────────────

  const progressPct = readerModel && hasProgress
    ? Math.round((session!.currentTokenId / readerModel.tokens.length) * 100)
    : 0;

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "var(--bg)" }}>
      {/* ── Minimal header ─────────────────────────────────────────────────── */}
      <header
        className="shrink-0 h-11 flex items-center gap-3 px-5 sm:px-6"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <span
          className="text-[10px] font-mono tracking-[0.22em] uppercase select-none"
          style={{ color: "var(--ink-3)" }}
        >
          turbo
        </span>

        {doc && (
          <>
            <span className="w-px h-3 shrink-0" style={{ background: "var(--border)" }} aria-hidden="true" />
            <span className="text-sm text-ink-2 truncate max-w-[18rem] sm:max-w-sm">
              {doc.metadata.fileName}
            </span>
          </>
        )}

        <div className="ml-auto flex items-center gap-3">
          {doc && (
            <button
              onClick={() => handleDocumentParsed(null, null)}
              className="text-[11px] font-mono transition-colors hover:text-ink-2"
              style={{ color: "var(--ink-3)" }}
            >
              change
            </button>
          )}
          <ThemeToggle />
        </div>
      </header>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col items-center px-5 sm:px-6 py-10 sm:py-14">

        {/* Upload state — no document */}
        {!doc && (
          <div className="w-full max-w-md flex flex-col gap-8 mt-4 sm:mt-8">
            <div className="text-center">
              <h1 className="text-2xl font-semibold tracking-tight text-ink-1">
                Bring in something to read.
              </h1>
              <p className="mt-1.5 text-sm text-ink-3">
                Drop a document to get started.
              </p>
            </div>

            <FileUpload onDocumentParsed={handleDocumentParsed} />

            <p className="text-center text-[11px] font-mono text-ink-3">
              PDF · TXT · EPUB · Markdown · RTF
            </p>
          </div>
        )}

        {/* Document-ready state */}
        {doc && readerModel && (
          <div className="w-full max-w-lg flex flex-col gap-7">

            {/* Document summary */}
            <DocumentSummary
              doc={doc}
              tokenCount={readerModel.tokens.length}
            />

            {/* Mode selector */}
            <ModeSelector mode={readerMode} onChange={setReaderMode} />

            {/* Primary CTA */}
            <div className="flex flex-col gap-2">
              {hasProgress ? (
                <div className="flex gap-2.5">
                  <button
                    onClick={() => setReaderActive(true)}
                    className="flex-1 h-11 rounded-lg text-sm font-medium tracking-tight transition-opacity hover:opacity-90 active:opacity-80 focus-visible:outline-2"
                    style={{
                      background: "var(--accent)",
                      color: "var(--accent-ink)",
                      outlineColor: "var(--accent)",
                    }}
                  >
                    Resume — {progressPct}% complete
                  </button>
                  <button
                    onClick={() => { setSession(null); setReaderActive(true); }}
                    className="h-11 px-4 rounded-lg text-sm text-ink-2 transition-colors hover:text-ink-1"
                    style={{
                      border: "1px solid var(--border)",
                      background: "transparent",
                    }}
                  >
                    Restart
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setReaderActive(true)}
                  className="w-full h-11 rounded-lg text-sm font-medium tracking-tight transition-opacity hover:opacity-90 active:opacity-80 focus-visible:outline-2"
                  style={{
                    background: "var(--accent)",
                    color: "var(--accent-ink)",
                    outlineColor: "var(--accent)",
                  }}
                >
                  Start reading
                  <span className="ml-2 opacity-60 font-mono text-xs">
                    {readerModel.tokens.length.toLocaleString()} words
                  </span>
                </button>
              )}
            </div>

            {/* Post-reading actions */}
            {hasHighlights && (
              <div className="space-y-4">
                <div
                  className="flex items-center justify-between text-sm pt-2"
                  style={{ borderTop: "1px solid var(--border-subtle)" }}
                >
                  <span className="font-mono text-[11px] text-ink-3">
                    {session!.highlights.length}{" "}
                    {session!.highlights.length === 1 ? "highlight" : "highlights"}
                  </span>
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => setAnalysisActive(true)}
                      className="text-sm font-medium transition-colors hover:opacity-80"
                      style={{ color: "var(--accent)" }}
                    >
                      Analyze highlights →
                    </button>
                    <button
                      onClick={handleHomePageDownload}
                      className="text-sm transition-colors hover:text-ink-1"
                      style={{ color: "var(--ink-2)" }}
                    >
                      Export PDF
                    </button>
                  </div>
                </div>

                {exportError && (
                  <p className="text-xs" style={{ color: "var(--danger)" }} role="alert">
                    {exportError}
                  </p>
                )}
              </div>
            )}

            {/* Highlight digest */}
            {hasHighlights && (
              <HighlightDigest
                highlights={session!.highlights}
                canonicalText={doc.text}
                onSeekTo={handleResumeSeek}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// ── Document summary ─────────────────────────────────────────────────────────

function DocumentSummary({
  doc,
  tokenCount,
}: {
  doc: ParsedDocument;
  tokenCount: number;
}) {
  const normalSec = estimateNormalReadingSeconds(tokenCount);
  const speedSec = estimateSpeedreaderSeconds(tokenCount, RAMP_MAX_WPM);
  const savedSec = Math.max(0, normalSec - speedSec);

  return (
    <div className="space-y-4">
      {/* Filename + file type */}
      <div>
        <p
          className="text-[11px] font-mono uppercase tracking-widest mb-1"
          style={{ color: "var(--ink-3)" }}
        >
          {doc.metadata.fileType}
        </p>
        <h2 className="text-lg font-semibold tracking-tight text-ink-1 leading-snug">
          {doc.metadata.fileName}
        </h2>
      </div>

      {/* Reading stats row */}
      <div
        className="grid gap-4 pt-4 text-sm"
        style={{
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          borderTop: "1px solid var(--border-subtle)",
        }}
      >
        <div>
          <p className="text-[10px] font-mono uppercase tracking-wider mb-1" style={{ color: "var(--ink-3)" }}>
            Words
          </p>
          <p className="font-mono tabular-nums text-ink-1 font-medium">
            {tokenCount.toLocaleString()}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-mono uppercase tracking-wider mb-1" style={{ color: "var(--ink-3)" }}>
            Normal ({NORMAL_READING_WPM} WPM)
          </p>
          <p className="font-mono tabular-nums text-ink-2">
            {formatDuration(normalSec)}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-mono uppercase tracking-wider mb-1" style={{ color: "var(--ink-3)" }}>
            With Turbo
          </p>
          <p className="font-mono tabular-nums font-medium" style={{ color: "var(--accent)" }}>
            {formatDuration(speedSec)}
          </p>
          {savedSec > 60 && (
            <p className="text-[10px] font-mono mt-0.5" style={{ color: "var(--success)" }}>
              saves ~{formatDuration(savedSec)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Mode selector ─────────────────────────────────────────────────────────────

function ModeSelector({
  mode,
  onChange,
}: {
  mode: ReadingMode;
  onChange: (m: ReadingMode) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] font-mono uppercase tracking-wider shrink-0" style={{ color: "var(--ink-3)" }}>
        Mode
      </span>

      <div
        className="flex rounded overflow-hidden text-[11px] font-mono"
        style={{ border: "1px solid var(--border)" }}
      >
        <button
          onClick={() => onChange("baseline")}
          className="px-3 py-1.5 transition-colors"
          style={{
            background: mode === "baseline" ? "var(--surface-inset)" : "transparent",
            color: mode === "baseline" ? "var(--ink-1)" : "var(--ink-3)",
          }}
          aria-pressed={mode === "baseline"}
        >
          Baseline
        </button>
        <div className="w-px" style={{ background: "var(--border)" }} aria-hidden="true" />
        <button
          onClick={() => onChange("adaptive")}
          className="px-3 py-1.5 transition-colors"
          style={{
            background: mode === "adaptive" ? "var(--surface-inset)" : "transparent",
            color: mode === "adaptive" ? "var(--ink-1)" : "var(--ink-3)",
          }}
          aria-pressed={mode === "adaptive"}
        >
          Adaptive
        </button>
      </div>

      <span className="text-[11px] text-ink-3 hidden sm:block">
        {mode === "adaptive"
          ? "AI adjusts pace for dense passages"
          : "Consistent pace throughout"}
      </span>
    </div>
  );
}
