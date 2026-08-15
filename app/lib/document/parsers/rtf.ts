import type { ParsedDocument, TextSpan } from "../types"

/**
 * Minimal RTF plain-text extractor.
 *
 * Handles common control words and \'xx hex escapes.
 * Source spans map to character offsets in the extracted (canonical) text.
 */
export async function parseRtf(file: File): Promise<ParsedDocument> {
  const raw = await file.text()
  const extracted = stripRtf(raw)

  const spans: TextSpan[] = []
  let idCounter = 0
  let lineStart = 0
  let lineNum = 1

  for (let i = 0; i <= extracted.length; i++) {
    const atEnd = i === extracted.length
    const ch = atEnd ? undefined : extracted[i]

    if (ch === "\n" || atEnd) {
      const lineText = extracted.slice(lineStart, i)
      if (lineText.trim().length > 0) {
        spans.push({
          id: `s${idCounter++}`,
          start: lineStart,
          end: i,
          text: lineText,
          source: { kind: "text", start: lineStart, end: i, line: lineNum },
        })
      }
      lineStart = i + 1
      lineNum++
    }
  }

  return {
    text: extracted,
    spans,
    metadata: { fileName: file.name, fileType: "rtf" },
  }
}

/**
 * Strips RTF markup and returns plain Unicode text.
 *
 * Pass order:
 * 1. Remove extended destination groups  {\*\...}
 * 2. Remove well-known non-text groups (fonttbl, colortbl, etc.)
 * 3. Replace paragraph/line break control words with newlines
 * 4. Replace \'xx hex escapes with the CP-1252 character
 * 5. Remove remaining control words / special characters
 * 6. Strip braces and clean up whitespace
 */
function stripRtf(src: string): string {
  let s = src

  // Remove extended destination groups: {\*\word ...}
  s = s.replace(/\{\\\*\\[\s\S]*?\}/g, "")

  // Remove named non-text groups.
  s = s.replace(
    /\{\\(?:fonttbl|colortbl|stylesheet|info|pict|header|footer|headerl|headerr|headerf|footerl|footerr|footerf|ftnsep|ftnsepc|aftnsep|aftnsepc|annotation|shppict|nonshppict|themedata|colorschememapping|latentstyles)[\s\S]*?\}/g,
    ""
  )

  // Paragraph and explicit line breaks → newline.
  s = s.replace(/\\(?:par|pard|sect|page|column)\b\s*/g, "\n")
  s = s.replace(/\\line\b\s*/g, "\n")

  // Tab.
  s = s.replace(/\\tab\b\s*/g, "\t")

  // Escaped braces.
  s = s.replace(/\\\{/g, "{")
  s = s.replace(/\\\}/g, "}")

  // \'xx hex escapes — decode as CP-1252 (best-effort: use code point directly).
  s = s.replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => {
    const code = parseInt(hex, 16)
    return cp1252ToChar(code)
  })

  // Remove all remaining control words (with optional numeric parameter).
  s = s.replace(/\\[a-zA-Z]+(-?\d+)? ?/g, "")

  // Remove backslash followed by a single punctuation character (escaped special).
  s = s.replace(/\\[^a-zA-Z\n]/g, "")

  // Strip remaining braces.
  s = s.replace(/[{}]/g, "")

  // Collapse runs of spaces (but keep newlines).
  s = s.replace(/[ \t]+/g, " ")
  s = s.replace(/\n{3,}/g, "\n\n")

  return s.trim()
}

/** Very rough CP-1252 → string for the 0x80–0x9F range; rest are Unicode-identical. */
function cp1252ToChar(code: number): string {
  const map: Record<number, string> = {
    0x80: "€",
    0x82: "‚",
    0x83: "ƒ",
    0x84: "„",
    0x85: "…",
    0x86: "†",
    0x87: "‡",
    0x88: "ˆ",
    0x89: "‰",
    0x8a: "Š",
    0x8b: "‹",
    0x8c: "Œ",
    0x8e: "Ž",
    0x91: "‘",
    0x92: "’",
    0x93: "“",
    0x94: "”",
    0x95: "•",
    0x96: "–",
    0x97: "—",
    0x98: "˜",
    0x99: "™",
    0x9a: "š",
    0x9b: "›",
    0x9c: "œ",
    0x9e: "ž",
    0x9f: "Ÿ",
  }
  return map[code] ?? String.fromCharCode(code)
}
