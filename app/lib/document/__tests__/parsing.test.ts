import { describe, it, expect } from "vitest"
import { parsePlainText } from "../parsers/plaintext"
import { parseRtf } from "../parsers/rtf"
import { getSourceSpansForRange, findInvariantViolation } from "../utils"
import type { ParsedDocument } from "../types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(name: string, content: string): File {
  return new File([content], name, { type: "text/plain" })
}

/**
 * Asserts the core invariant holds for every span in a document and
 * returns the document for chaining.
 */
function assertInvariant(doc: ParsedDocument): ParsedDocument {
  const bad = findInvariantViolation(doc)
  if (bad) {
    throw new Error(
      `Span ${bad.id} violates invariant:\n` +
        `  span.text = ${JSON.stringify(bad.text)}\n` +
        `  slice     = ${JSON.stringify(doc.text.slice(bad.start, bad.end))}`
    )
  }
  return doc
}

// ---------------------------------------------------------------------------
// Plain-text parser
// ---------------------------------------------------------------------------

describe("parsePlainText", () => {
  it("canonical text equals file content", async () => {
    const content = "Hello, world!\nSecond line."
    const doc = await parsePlainText(makeFile("test.txt", content), "txt")
    expect(doc.text).toBe(content)
  })

  it("invariant: text.slice(start, end) === span.text for every span", async () => {
    const content = "Line one\nLine two\nLine three"
    const doc = await parsePlainText(makeFile("test.txt", content), "txt")
    assertInvariant(doc)
  })

  it("one span per non-empty line", async () => {
    const content = "alpha\n\nbeta\ngamma"
    const doc = await parsePlainText(makeFile("test.txt", content), "txt")
    // 'alpha', 'beta', 'gamma' — the blank line produces no span
    expect(doc.spans).toHaveLength(3)
    expect(doc.spans[0].text).toBe("alpha")
    expect(doc.spans[1].text).toBe("beta")
    expect(doc.spans[2].text).toBe("gamma")
  })

  it("line numbers are 1-based", async () => {
    const content = "first\nsecond\nthird"
    const doc = await parsePlainText(makeFile("test.txt", content), "txt")
    assertInvariant(doc)
    const sources = doc.spans.map((s) => (s.source.kind === "text" ? s.source.line : null))
    expect(sources).toEqual([1, 2, 3])
  })

  it("source offsets equal canonical offsets for plain text", async () => {
    const content = "abc\ndef"
    const doc = await parsePlainText(makeFile("test.txt", content), "txt")
    assertInvariant(doc)
    for (const span of doc.spans) {
      expect(span.source.kind).toBe("text")
      if (span.source.kind === "text") {
        expect(span.source.start).toBe(span.start)
        expect(span.source.end).toBe(span.end)
      }
    }
  })

  it("handles Windows line endings without breaking spans", async () => {
    const content = "line1\r\nline2\r\nline3"
    const doc = await parsePlainText(makeFile("test.txt", content), "txt")
    assertInvariant(doc)
    // Each span should contain the actual text including the \r
    expect(doc.spans[0].text).toBe("line1\r")
    expect(doc.spans[1].text).toBe("line2\r")
    expect(doc.spans[2].text).toBe("line3")
  })
})

// ---------------------------------------------------------------------------
// getSourceSpansForRange
// ---------------------------------------------------------------------------

describe("getSourceSpansForRange", () => {
  async function makeDoc(): Promise<ParsedDocument> {
    const content = "alpha\nbeta\ngamma\ndelta"
    return parsePlainText(makeFile("test.txt", content), "txt")
  }

  it("returns spans overlapping the query range", async () => {
    const doc = await makeDoc()
    assertInvariant(doc)

    // "alpha" is at [0,5], "beta" is at [6,10]
    const [alpha, beta] = doc.spans
    const results = getSourceSpansForRange(doc, 0, 10)
    expect(results).toContain(alpha)
    expect(results).toContain(beta)
  })

  it("excludes spans entirely outside the range", async () => {
    const doc = await makeDoc()
    assertInvariant(doc)

    const [alpha] = doc.spans
    // Range covering only "alpha" [0,5]
    const results = getSourceSpansForRange(doc, 0, 5)
    expect(results).toContain(alpha)
    // "beta" [6,10] should not be included
    expect(results.find((s) => s.text === "beta")).toBeUndefined()
  })

  it("returns empty array when range has no overlapping spans", async () => {
    const doc = await makeDoc()
    // Canonical text: "alpha\nbeta\ngamma\ndelta"
    // The \n at index 5 is not covered by any span
    const results = getSourceSpansForRange(doc, 5, 6)
    expect(results).toHaveLength(0)
  })

  it("correctly handles partial overlap at left boundary", async () => {
    const doc = await makeDoc()
    // "beta" is at [6,10]. A range starting at 8 should still include it.
    const results = getSourceSpansForRange(doc, 8, 11)
    expect(results.find((s) => s.text === "beta")).toBeDefined()
  })

  it("correctly handles partial overlap at right boundary", async () => {
    const doc = await makeDoc()
    // "beta" is at [6,10]. A range ending at 8 should still include it.
    const results = getSourceSpansForRange(doc, 0, 8)
    expect(results.find((s) => s.text === "beta")).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// RTF parser (markup stripping + invariant)
// ---------------------------------------------------------------------------

describe("parseRtf", () => {
  it("extracts readable text from a simple RTF document", async () => {
    const rtf =
      "{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Helvetica;}}" +
      "\\f0\\fs24 Hello, world!\\par This is a test.}"
    const doc = await parseRtf(makeFile("test.rtf", rtf))
    expect(doc.text).toContain("Hello, world!")
    expect(doc.text).toContain("This is a test.")
  })

  it("satisfies the span invariant", async () => {
    const rtf =
      "{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}" +
      "\\pard First paragraph.\\par Second paragraph.}"
    const doc = await parseRtf(makeFile("test.rtf", rtf))
    assertInvariant(doc)
  })

  it("removes fonttbl and colortbl groups", async () => {
    const rtf =
      "{\\rtf1{\\fonttbl\\f0\\fnil\\fcharset0 Arial;}{\\colortbl;\\red0\\green0\\blue0;}" +
      "Just text.}"
    const doc = await parseRtf(makeFile("test.rtf", rtf))
    expect(doc.text).not.toContain("fonttbl")
    expect(doc.text).not.toContain("colortbl")
    expect(doc.text).toContain("Just text.")
    assertInvariant(doc)
  })
})

// ---------------------------------------------------------------------------
// PDF text-item joining logic (tested without a real PDF)
// ---------------------------------------------------------------------------

describe("PDF separator logic (unit-level)", () => {
  /**
   * Simulates what the PDF parser does when assembling canonical text from
   * a sequence of text items.  Lets us test the whitespace heuristics without
   * a real PDF binary.
   */
  function assembleItems(
    items: Array<{
      str: string
      x: number
      y: number
      width: number
      fontH: number
      hasEOL?: boolean
    }>
  ): { text: string; spans: Array<{ start: number; end: number; text: string }> } {
    const SPACE_X_RATIO = 0.15
    const LINE_Y_RATIO = 0.4

    let text = ""
    const spans: Array<{ start: number; end: number; text: string }> = []

    let prevX = NaN
    let prevY = NaN
    let prevRight = NaN
    let prevFontH = NaN

    for (const item of items) {
      const { str, x, y, width, fontH, hasEOL = false } = item
      if (str.length === 0) continue

      if (!isNaN(prevX)) {
        const yDelta = Math.abs(y - prevY)
        const xGap = x - prevRight

        if (yDelta > (prevFontH || fontH) * LINE_Y_RATIO) {
          if (!text.endsWith("\n")) text += "\n"
        } else if (
          xGap > (prevFontH || fontH) * SPACE_X_RATIO &&
          !text.endsWith(" ") &&
          !str.startsWith(" ")
        ) {
          text += " "
        }
      }

      const start = text.length
      text += str
      const end = text.length
      spans.push({ start, end, text: str })

      prevX = x
      prevY = y
      prevRight = x + width
      prevFontH = fontH

      if (hasEOL && !text.endsWith("\n")) {
        text += "\n"
        prevX = NaN
      }
    }

    return { text, spans }
  }

  function assertSpanInvariant(text: string, spans: { start: number; end: number; text: string }[]) {
    for (const s of spans) {
      expect(text.slice(s.start, s.end)).toBe(s.text)
    }
  }

  it("adjacent items with no gap are concatenated directly", () => {
    const { text, spans } = assembleItems([
      { str: "Hel", x: 0, y: 700, width: 15, fontH: 12 },
      { str: "lo", x: 15, y: 700, width: 10, fontH: 12 },
    ])
    expect(text).toBe("Hello")
    assertSpanInvariant(text, spans)
  })

  it("items with a visible gap get a space separator", () => {
    const { text, spans } = assembleItems([
      { str: "Hello", x: 0, y: 700, width: 30, fontH: 12 },
      { str: "world", x: 38, y: 700, width: 30, fontH: 12 }, // 8-unit gap > 12*0.15=1.8
    ])
    expect(text).toBe("Hello world")
    assertSpanInvariant(text, spans)
  })

  it("items on different y-coordinates get a newline separator", () => {
    const { text, spans } = assembleItems([
      { str: "Line one", x: 0, y: 700, width: 60, fontH: 12 },
      { str: "Line two", x: 0, y: 684, width: 60, fontH: 12 }, // Δy = 16 > 12*0.4 = 4.8
    ])
    expect(text).toContain("\n")
    expect(text).toBe("Line one\nLine two")
    assertSpanInvariant(text, spans)
  })

  it("hasEOL appends a newline after the item", () => {
    const { text, spans } = assembleItems([
      { str: "First", x: 0, y: 700, width: 30, fontH: 12, hasEOL: true },
      { str: "Second", x: 0, y: 686, width: 36, fontH: 12 },
    ])
    // "First" is followed by \n from hasEOL; "Second" is on a new line.
    expect(text.startsWith("First\n")).toBe(true)
    assertSpanInvariant(text, spans)
  })

  it("span invariant holds for a multi-item sequence", () => {
    const { text, spans } = assembleItems([
      { str: "The ", x: 0, y: 700, width: 24, fontH: 12 },
      { str: "quick", x: 24, y: 700, width: 30, fontH: 12 },
      { str: " brown", x: 54, y: 700, width: 36, fontH: 12 },
      { str: "fox", x: 0, y: 684, width: 18, fontH: 12 },
    ])
    assertSpanInvariant(text, spans)
  })
})
