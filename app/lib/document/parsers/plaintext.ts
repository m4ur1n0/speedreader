import type { ParsedDocument, TextSpan } from "../types"

/**
 * Parses TXT and Markdown files.
 *
 * Canonical text equals the file content verbatim (no normalization).
 * PlainTextSource offsets therefore equal canonical offsets and file offsets—
 * all three are the same character position.
 *
 * One span per non-empty line. Empty/whitespace-only lines become gaps
 * between spans (they're still in the canonical text, just uncovered).
 */
export async function parsePlainText(
  file: File,
  fileType: string
): Promise<ParsedDocument> {
  const text = await file.text()
  const spans: TextSpan[] = []
  let idCounter = 0

  let lineStart = 0
  let lineNum = 1

  for (let i = 0; i <= text.length; i++) {
    const atEnd = i === text.length
    const ch = atEnd ? undefined : text[i]

    if (ch === "\n" || atEnd) {
      // Slice is [lineStart, i] — includes the \n char position but the span
      // ends at i (exclusive), so the \n itself is a gap character.
      const lineText = text.slice(lineStart, i)

      if (lineText.trim().length > 0) {
        spans.push({
          id: `s${idCounter++}`,
          start: lineStart,
          end: i,
          text: lineText,
          source: {
            kind: "text",
            start: lineStart,
            end: i,
            line: lineNum,
          },
        })
      }

      lineStart = i + 1
      lineNum++
    }
  }

  return {
    text,
    spans,
    metadata: { fileName: file.name, fileType },
  }
}
