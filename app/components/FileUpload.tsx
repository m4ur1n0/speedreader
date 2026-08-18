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

async function isPdfTextBased(file: File): Promise<boolean> {
  const slice = file.slice(0, 512 * 1024);
  const buffer = await slice.arrayBuffer();
  const sample = new TextDecoder("latin1").decode(buffer);
  return sample.includes("/Font") && sample.includes("BT");
}

interface FileUploadProps {
  onDocumentParsed?: (doc: ParsedDocument | null, file: File | null) => void;
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
      onDocumentParsed?.(doc, incoming);
    } catch (err) {
      if (err instanceof ScannedPdfError) {
        setError(err.message);
      } else {
        setError(`Failed to parse "${incoming.name}": ${(err as Error).message}`);
      }
      setFile(null);
      setParseState({ status: "idle" });
      onDocumentParsed?.(null, null);
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
    onDocumentParsed?.(null, null);
  }

  const busy = parseState.status === "validating" || parseState.status === "parsing";
  const statusLabel =
    parseState.status === "validating"
      ? "Checking…"
      : parseState.status === "parsing"
      ? "Parsing…"
      : null;

  /* Loaded file row */
  if (file) {
    return (
      <div>
        <div
          className="flex items-center gap-3 rounded-lg px-4 py-3 text-sm"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
          }}
        >
          {/* Document icon */}
          <svg
            className="w-4 h-4 shrink-0"
            style={{ color: "var(--ink-3)" }}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
          >
            <rect x="2" y="1" width="12" height="14" rx="1.5" />
            <path d="M5 5h6M5 7.5h6M5 10h4" strokeLinecap="round" />
          </svg>

          <div className="flex-1 min-w-0">
            <p className="truncate font-medium text-ink-1">{file.name}</p>
            <p className="text-[11px] font-mono mt-0.5" style={{ color: "var(--ink-3)" }}>
              {formatBytes(file.size)}
              {parseState.status === "validating" && " · checking…"}
              {parseState.status === "parsing" && " · parsing…"}
              {parseState.status === "done" &&
                ` · ${parseState.doc.text.length.toLocaleString()} chars`}
            </p>
          </div>

          <button
            onClick={clearFile}
            className="shrink-0 p-1 rounded transition-opacity hover:opacity-60"
            style={{ color: "var(--ink-3)" }}
            aria-label="Remove file"
          >
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </button>
        </div>

        {error && (
          <p className="mt-2 text-sm" style={{ color: "var(--danger)" }} role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  /* Drop zone */
  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && !busy && inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed px-8 py-16 transition-colors ${
          busy
            ? "cursor-wait"
            : dragging
            ? "cursor-pointer"
            : "cursor-pointer"
        }`}
        style={{
          borderColor: dragging ? "var(--accent)" : "var(--border)",
          background: dragging ? "var(--accent-soft)" : "transparent",
        }}
      >
        {statusLabel ? (
          <div className="flex flex-col items-center gap-3">
            <div
              className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: "var(--ink-3)", borderTopColor: "transparent" }}
              aria-hidden="true"
            />
            <p className="text-sm font-mono" style={{ color: "var(--ink-3)" }}>
              {statusLabel}
            </p>
          </div>
        ) : (
          <>
            {/* Upload icon */}
            <svg
              className="w-8 h-8"
              style={{ color: "var(--ink-3)" }}
              viewBox="0 0 32 32"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M16 21V11M16 11l-4 4M16 11l4 4" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="4" y="4" width="24" height="24" rx="3" strokeDasharray="0" />
              <path d="M8 22v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" />
            </svg>

            <div className="text-center">
              <p className="text-sm font-medium text-ink-1">
                Drop a file here,{" "}
                <span style={{ color: "var(--accent)" }}>or browse</span>
              </p>
            </div>
          </>
        )}
      </div>

      {error && (
        <p className="mt-2 text-sm" style={{ color: "var(--danger)" }} role="alert">
          {error}
        </p>
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
