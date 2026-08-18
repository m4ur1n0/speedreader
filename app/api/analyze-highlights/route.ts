import { NextRequest, NextResponse } from "next/server"
import { GoogleGenAI } from "@google/genai"
import type { HighlightAnalysisInput, HighlightAnalysisResult } from "@/app/lib/highlightAnalysis/types"

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-flash-latest"
const GEMINI_TIMEOUT_MS = 30_000

const RESPONSE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      id: { type: "string" },
      explanation: { type: "string" },
      keyPoints: { type: "array", items: { type: "string" } },
      relationToReading: { type: "string" },
    },
    required: ["id", "explanation", "keyPoints", "relationToReading"],
  },
}

const SYSTEM_PROMPT = `You are a reading annotation assistant. For each highlighted passage, produce:

explanation: 2–4 concise sentences explaining what the passage means and why it is important. Do NOT merely paraphrase. Go beyond the surface to explain what the author intends and what makes this passage significant.

keyPoints: 2–5 short bullet-point strings worth remembering about this passage.

relationToReading: 1–3 concise sentences explaining how this passage connects to the broader document — the author's argument, the topic being developed, or the surrounding narrative.

Use the provided "context before" and "context after" to ground your explanation in the document's flow. The highlighted text alone is never sufficient context.

Do not write essays. Be concise. These should function as useful study annotations, not paraphrases.

Return a JSON array with one object per input, each having exactly: id (string, matching input), explanation (string), keyPoints (string[]), relationToReading (string).`

function buildUserPrompt(inputs: HighlightAnalysisInput[]): string {
  return inputs
    .map((input) => {
      const lines: string[] = []
      if (input.documentTitle) lines.push(`Document: "${input.documentTitle}"`)
      if (input.contextBefore) lines.push(`Context before:\n${input.contextBefore}`)
      lines.push(`Highlighted passage [id: ${input.id}]:\n"${input.highlightedText}"`)
      if (input.contextAfter) lines.push(`Context after:\n${input.contextAfter}`)
      return lines.join("\n\n")
    })
    .join("\n\n---\n\n")
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })
  }

  let inputs: HighlightAnalysisInput[]
  try {
    const body = await req.json()
    inputs = body.inputs
    if (!Array.isArray(inputs) || inputs.length === 0) {
      return NextResponse.json({ error: "inputs must be a non-empty array" }, { status: 400 })
    }
    if (inputs.length > 10) {
      return NextResponse.json({ error: "Too many inputs per request (max 10)" }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const userPrompt = buildUserPrompt(inputs)

  try {
    const ai = new GoogleGenAI({ apiKey })

    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`Gemini request timed out after ${GEMINI_TIMEOUT_MS}ms`)),
        GEMINI_TIMEOUT_MS
      )
    })

    const response = await Promise.race([
      ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.2,
        },
      }),
      timeoutPromise,
    ]).finally(() => clearTimeout(timeoutId))

    const raw = response.text
    if (!raw) {
      return NextResponse.json({ error: "Empty response from Gemini" }, { status: 502 })
    }

    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return NextResponse.json({ error: "Unexpected Gemini response shape" }, { status: 502 })
    }

    const submittedIds = new Set(inputs.map((i) => i.id))
    const rawById = new Map<string, Record<string, unknown>>()
    for (const item of parsed) {
      const obj = item as Record<string, unknown>
      if (typeof obj.id === "string" && submittedIds.has(obj.id)) {
        rawById.set(obj.id, obj)
      }
    }

    const results: HighlightAnalysisResult[] = inputs.map((input) => {
      const obj = rawById.get(input.id)
      if (!obj) {
        return {
          id: input.id,
          explanation: "",
          keyPoints: [],
          relationToReading: "",
        }
      }
      const explanation = typeof obj.explanation === "string" ? obj.explanation.slice(0, 800) : ""
      const keyPoints = Array.isArray(obj.keyPoints)
        ? (obj.keyPoints as unknown[])
            .filter((k): k is string => typeof k === "string")
            .slice(0, 5)
        : []
      const relationToReading =
        typeof obj.relationToReading === "string" ? obj.relationToReading.slice(0, 400) : ""
      return { id: input.id, explanation, keyPoints, relationToReading }
    })

    return NextResponse.json({ results })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const status = msg.includes("429") || msg.includes("quota") ? 429 : 502
    return NextResponse.json({ error: `Gemini request failed: ${msg}` }, { status })
  }
}
