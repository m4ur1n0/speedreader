"use client";

import { useRef, useState, DragEvent, ChangeEvent } from "react";
import type { ParsedDocument } from "@/app/lib/document";
import { ScannedPdfError } from "@/app/lib/document";

const ACCEPTED_EXTENSIONS = new Set(["pdf", "txt", "md", "markdown", "epub", "rtf"]);

const ACCEPT_ATTR = ".pdf,.txt,.md,.markdown,.epub,.rtf";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isAccepted(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ACCEPTED_EXTENSIONS.has(ext);
}

// Fast pre-check: scan the first 512 KB for font resources + text operators.
// Scanned-only PDFs embed pages as images with no font dictionaries or BT/ET blocks.
async function isPdfTextBased(file: File): Promise<boolean> {
  const slice = file.slice(0, 512 * 1024);
  const buffer = await slice.arrayBuffer();
  // latin1 maps bytes 0–255 one-to-one to Unicode code points,
  // preserving ASCII sequences like "/Font" and "BT" in binary PDF streams.
  const sample = new TextDecoder("latin1").decode(buffer);
  return sample.includes("/Font") && sample.includes("BT");
}

interface FileUploadProps {
  onDocumentParsed?: (doc: ParsedDocument | null) => void;
}

type ParseState =
  | { status: "idle" }
  | { status: "validating" }
  | { status: "parsing" }
  | { status: "done"; doc: ParsedDocument };

export default function FileUpload({ onDocumentParsed }: FileUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parseState, setParseState] = useState<ParseState>({ status: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(incoming: File) {
    if (!isAccepted(incoming)) {
      setError(`"${incoming.name}" is not a supported file type.`);
      return;
    }

    const ext = incoming.name.split(".").pop()?.toLowerCase();

    if (ext === "pdf") {
      setParseState({ status: "validating" });
      const isText = await isPdfTextBased(incoming);
      if (!isText) {
        setParseState({ status: "idle" });
        setError(`"${incoming.name}" appears to be a scanned PDF. Only text-based PDFs are supported.`);
        return;
      }
    }

    setError(null);
    setFile(incoming);
    setParseState({ status: "parsing" });

    try {
      const { parseFile } = await import("@/app/lib/document");
      const doc = await parseFile(incoming);
      setParseState({ status: "done", doc });
      onDocumentParsed?.(doc);
    } catch (err) {
      if (err instanceof ScannedPdfError) {
        setError(err.message);
      } else {
        setError(`Failed to parse "${incoming.name}": ${(err as Error).message}`);
      }
      setFile(null);
      setParseState({ status: "idle" });
      onDocumentParsed?.(null);
    }
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (picked) handleFile(picked);
    e.target.value = "";
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFile(dropped);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(true);
  }

  function handleDragLeave() {
    setDragging(false);
  }

  function clearFile() {
    setFile(null);
    setError(null);
    setParseState({ status: "idle" });
    onDocumentParsed?.(null);
  }

  const busy = parseState.status === "validating" || parseState.status === "parsing";
  const statusLabel =
    parseState.status === "validating"
      ? "Checking file…"
      : parseState.status === "parsing"
      ? "Parsing…"
      : null;

  return (
    <div className="w-full max-w-lg">
      {!file ? (
        <div
          role="button"
          tabIndex={0}
          onClick={() => !busy && inputRef.current?.click()}
          onKeyDown={(e) => e.key === "Enter" && !busy && inputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-8 py-14 transition-colors ${
            busy
              ? "cursor-wait border-zinc-300 dark:border-zinc-700"
              : dragging
              ? "cursor-pointer border-blue-500 bg-blue-50 dark:bg-blue-950/20"
              : "cursor-pointer border-zinc-300 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-500"
          }`}
        >
          <svg
            className="h-10 w-10 text-zinc-400"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m.75 12 3 3m0 0 3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
            />
          </svg>
          <div className="text-center">
            {statusLabel ? (
              <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                {statusLabel}
              </p>
            ) : (
              <>
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Drop a file here, or{" "}
                  <span className="text-blue-600 dark:text-blue-400">browse</span>
                </p>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                  PDF (text-based), TXT, Markdown, EPUB, RTF
                </p>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-5 py-4">
          <svg
            className="h-8 w-8 shrink-0 text-zinc-500"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
            />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {file.name}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {formatBytes(file.size)}
              {file.type ? ` · ${file.type}` : ""}
              {parseState.status === "parsing" && " · Parsing…"}
              {parseState.status === "done" &&
                ` · ${parseState.doc.text.length.toLocaleString()} chars · ${parseState.doc.spans.length.toLocaleString()} spans`}
            </p>
          </div>
          <button
            onClick={clearFile}
            className="shrink-0 rounded-md p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
            aria-label="Remove file"
          >
            <svg
              className="h-5 w-5"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {error && (
        <p className="mt-2 text-sm text-red-500">{error}</p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        className="sr-only"
        onChange={handleChange}
      />
    </div>
  );
}
