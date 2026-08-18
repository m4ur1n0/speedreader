"use client";

import { useState, useMemo } from "react";
import FileUpload from "./components/FileUpload";
import { ReaderView } from "./components/reader/ReaderView";
import type { ReaderSession } from "./components/reader/ReaderView";
import { HighlightDigest } from "./components/HighlightDigest";
import { HighlightAnalysisView } from "./components/HighlightAnalysisView";
import { useHighlightAnalysis } from "./lib/highlightAnalysis/useHighlightAnalysis";
import type { ParsedDocument } from "./lib/document";
import { getSourceSpansForRange } from "./lib/document";
import { buildReaderModel } from "./lib/reader/tokenizer";
import type { ReaderHighlight } from "./lib/highlight/types";
import {
  estimateNormalReadingSeconds,
  estimateSpeedreaderSeconds,
  formatDuration,
  NORMAL_READING_WPM,
} from "./lib/reader/statsHelpers";
import { RAMP_MAX_WPM } from "./lib/reader/types";

export default function Home() {
  const [doc, setDoc] = useState<ParsedDocument | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [readerActive, setReaderActive] = useState(false);
  const [analysisActive, setAnalysisActive] = useState(false);
  const [session, setSession] = useState<ReaderSession | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const readerModel = useMemo(
    () => (doc ? buildReaderModel(doc) : null),
    [doc]
  );

  // Stable empty arrays so useHighlightAnalysis hook doesn't throw when doc/session are null
  const currentHighlights: ReaderHighlight[] = session?.highlights ?? [];

  // Analysis state lives at page level so it survives navigation between views
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

  // Core export — does not catch; callers are responsible for their own error UI.
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

  // Home-page button wrapper: catches and stores error for display on this page.
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

  if (readerActive && readerModel) {
    return (
      <ReaderView
        model={readerModel}
        onExit={handleReaderExit}
        initialSession={session}
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

  return (
    <main className="flex flex-1 flex-col items-center p-8 gap-8">
      <h1 className="text-2xl font-semibold tracking-tight">
        Turbo Speedreader
      </h1>

      <FileUpload onDocumentParsed={handleDocumentParsed} />

      {/* ── Pre-reading stats + action buttons ──────────────────────────────── */}
      {doc && readerModel && (
        <div className="flex flex-col items-center gap-4 w-full max-w-sm">
          {/* Reading time estimates */}
          <ReadingEstimates tokenCount={readerModel.tokens.length} />

          {/* Start / Resume / Restart buttons */}
          <div className="flex items-center gap-3">
            {hasProgress ? (
              <>
                <button
                  onClick={() => setReaderActive(true)}
                  className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-blue-500"
                >
                  Resume — {session!.currentTokenId.toLocaleString()} /{" "}
                  {readerModel.tokens.length.toLocaleString()} words
                </button>
                <button
                  onClick={() => {
                    setSession(null);
                    setReaderActive(true);
                  }}
                  className="px-4 py-3 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-sm font-medium transition-colors"
                >
                  Restart
                </button>
              </>
            ) : (
              <button
                onClick={() => setReaderActive(true)}
                className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-blue-500"
              >
                Start Reading — {readerModel.tokens.length.toLocaleString()} words
              </button>
            )}
          </div>

          {/* Post-reading actions */}
          {hasHighlights && (
            <div className="flex flex-col gap-2 w-full">
              {/* Analyze Highlights */}
              <button
                onClick={() => setAnalysisActive(true)}
                className="w-full px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors"
              >
                Analyze Highlights ({session!.highlights.length}{" "}
                {session!.highlights.length === 1 ? "highlight" : "highlights"})
              </button>

              {/* Download highlighted PDF */}
              <button
                onClick={handleHomePageDownload}
                className="w-full px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors"
              >
                Download Highlighted PDF
              </button>
            </div>
          )}

          {exportError && (
            <p className="text-sm text-red-500 max-w-sm text-center" role="alert">
              {exportError}
            </p>
          )}
        </div>
      )}

      {/* ── Highlight digest ─────────────────────────────────────────────────── */}
      {doc && hasHighlights && (
        <HighlightDigest
          highlights={session!.highlights}
          canonicalText={doc.text}
          onSeekTo={handleResumeSeek}
        />
      )}

      {/* ── Debug panel ──────────────────────────────────────────────────────── */}
      {doc && <DebugPanel doc={doc} />}
    </main>
  );
}

// ─── Pre-reading estimates ───────────────────────────────────────────────────

function ReadingEstimates({ tokenCount }: { tokenCount: number }) {
  const normalSec = estimateNormalReadingSeconds(tokenCount);
  const speedSec = estimateSpeedreaderSeconds(tokenCount, RAMP_MAX_WPM);
  const savedSec = Math.max(0, normalSec - speedSec);

  return (
    <div className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-5 py-4 text-sm">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 tabular-nums">
        <span className="text-zinc-500 dark:text-zinc-400">Words</span>
        <span className="font-medium text-zinc-800 dark:text-zinc-200">
          {tokenCount.toLocaleString()}
        </span>

        <span className="text-zinc-500 dark:text-zinc-400">
          Normal ({NORMAL_READING_WPM} WPM)
        </span>
        <span className="font-medium text-zinc-800 dark:text-zinc-200">
          {formatDuration(normalSec)}
        </span>

        <span className="text-zinc-500 dark:text-zinc-400">
          Speedreader est.
        </span>
        <span className="font-medium text-blue-600 dark:text-blue-400">
          {formatDuration(speedSec)}
        </span>

        {savedSec > 60 && (
          <>
            <span className="text-zinc-500 dark:text-zinc-400">Est. time saved</span>
            <span className="font-medium text-green-600 dark:text-green-400">
              {formatDuration(savedSec)}
            </span>
          </>
        )}
      </div>
      <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
        Estimates only. Speedreader time uses the {RAMP_MAX_WPM}-WPM ramp.
      </p>
    </div>
  );
}

// ─── Debug panel ─────────────────────────────────────────────────────────────

function DebugPanel({ doc }: { doc: ParsedDocument }) {
  const PREVIEW_CHARS = 500;
  const SPAN_ROWS = 12;

  const exampleSpans = getSourceSpansForRange(doc, 0, 100);

  return (
    <div className="w-full max-w-3xl space-y-6 text-sm font-mono">
      <section>
        <h2 className="mb-2 font-sans font-semibold text-zinc-700 dark:text-zinc-300">
          Metadata
        </h2>
        <pre className="rounded-lg bg-zinc-100 dark:bg-zinc-900 p-4 overflow-x-auto text-xs">
          {JSON.stringify(doc.metadata, null, 2)}
        </pre>
      </section>

      <section>
        <h2 className="mb-2 font-sans font-semibold text-zinc-700 dark:text-zinc-300">
          Canonical text — first {PREVIEW_CHARS} chars
          <span className="ml-2 font-normal text-zinc-500">
            ({doc.text.length.toLocaleString()} total · {doc.spans.length.toLocaleString()} spans)
          </span>
        </h2>
        <pre className="rounded-lg bg-zinc-100 dark:bg-zinc-900 p-4 overflow-x-auto text-xs whitespace-pre-wrap">
          {doc.text.slice(0, PREVIEW_CHARS)}
          {doc.text.length > PREVIEW_CHARS && "\n…"}
        </pre>
      </section>

      <section>
        <h2 className="mb-2 font-sans font-semibold text-zinc-700 dark:text-zinc-300">
          First {SPAN_ROWS} spans
        </h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
          <table className="w-full text-xs">
            <thead className="bg-zinc-100 dark:bg-zinc-800 text-left">
              <tr>
                <th className="px-3 py-2">id</th>
                <th className="px-3 py-2">start</th>
                <th className="px-3 py-2">end</th>
                <th className="px-3 py-2">text</th>
                <th className="px-3 py-2">source</th>
              </tr>
            </thead>
            <tbody>
              {doc.spans.slice(0, SPAN_ROWS).map((span) => (
                <tr
                  key={span.id}
                  className="border-t border-zinc-200 dark:border-zinc-700"
                >
                  <td className="px-3 py-1.5 text-zinc-500">{span.id}</td>
                  <td className="px-3 py-1.5">{span.start}</td>
                  <td className="px-3 py-1.5">{span.end}</td>
                  <td className="px-3 py-1.5 max-w-xs truncate">
                    {JSON.stringify(span.text)}
                  </td>
                  <td className="px-3 py-1.5 text-zinc-500 max-w-xs">
                    {formatSource(span.source)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-sans font-semibold text-zinc-700 dark:text-zinc-300">
          getSourceSpansForRange(doc, 0, 100) → {exampleSpans.length} spans
        </h2>
        <pre className="rounded-lg bg-zinc-100 dark:bg-zinc-900 p-4 overflow-x-auto text-xs whitespace-pre-wrap">
          {exampleSpans
            .map(
              (s) =>
                `[${s.start}–${s.end}] ${formatSource(s.source)}: ${JSON.stringify(s.text)}`
            )
            .join("\n")}
        </pre>
      </section>
    </div>
  );
}

function formatSource(source: ParsedDocument["spans"][number]["source"]): string {
  if (source.kind === "pdf") {
    const b = source.boxes[0];
    return `pdf p${source.page} x=${b.x.toFixed(1)} y=${b.y.toFixed(1)} w=${b.width.toFixed(1)} h=${b.height.toFixed(1)}`;
  }
  return `text [${source.start}–${source.end}]${source.line != null ? ` ln${source.line}` : ""}`;
}
