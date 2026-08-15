"use client";

import { useState, useMemo } from "react";
import FileUpload from "./components/FileUpload";
import { ReaderView } from "./components/reader/ReaderView";
import type { ParsedDocument } from "./lib/document";
import { getSourceSpansForRange } from "./lib/document";
import { buildReaderModel } from "./lib/reader/tokenizer";

export default function Home() {
  const [doc, setDoc] = useState<ParsedDocument | null>(null);
  const [readerActive, setReaderActive] = useState(false);

  // Build the reader model once when the document changes.
  // This is memoised here (not inside ReaderView) so it survives
  // ReaderView unmount/remount without rebuilding.
  const readerModel = useMemo(
    () => (doc ? buildReaderModel(doc) : null),
    [doc]
  );

  function handleDocumentParsed(incoming: ParsedDocument | null) {
    setDoc(incoming);
    setReaderActive(false);
  }

  if (readerActive && readerModel) {
    return (
      <ReaderView
        model={readerModel}
        onExit={() => setReaderActive(false)}
      />
    );
  }

  return (
    <main className="flex flex-1 flex-col items-center p-8 gap-8">
      <h1 className="text-2xl font-semibold tracking-tight">
        Turbo Speedreader
      </h1>

      <FileUpload onDocumentParsed={handleDocumentParsed} />

      {doc && readerModel && (
        <button
          onClick={() => setReaderActive(true)}
          className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-blue-500"
        >
          Start Reading — {readerModel.tokens.length.toLocaleString()} words
        </button>
      )}

      {doc && <DebugPanel doc={doc} />}
    </main>
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
