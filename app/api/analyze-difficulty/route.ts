import { NextRequest, NextResponse } from "next/server"
import { GoogleGenAI } from "@google/genai"
import type { AnalysisChunk, ChunkDifficultyResult, DifficultyLevel } from "@/app/lib/analysis/types"

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-flash-latest"

const VALID_LEVELS = new Set<DifficultyLevel>(["normal", "mild", "moderate", "high", "very_high"])

const RESPONSE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      id: { type: "number" },
      difficulty: { type: "number" },
      level: {
        type: "string",
        enum: ["normal", "mild", "moderate", "high", "very_high"],
      },
      factors: { type: "array", items: { type: "string" } },
      reason: { type: "string" },
    },
    required: ["id", "difficulty", "level", "factors", "reason"],
  },
}

const SYSTEM_PROMPT = `You are a reading-difficulty analyst. Assess how much cognitive effort a typical educated adult needs to follow each passage when reading quickly.

CALIBRATION — the vast majority of text should be "normal". Elevate only when there is a genuine comprehension obstacle.

  normal    — Most prose belongs here. Clear narrative, explanation, dialogue, opinion, journalism, popular non-fiction. Uncommon words and vivid writing style do NOT raise the level unless they actively impede comprehension.
  mild      — Some domain-specific terms the reader may need a moment to parse, or moderately complex sentence structure. Light academic or professional writing.
  moderate  — Clearly technical or academic content: multiple defined terms used together, compound conceptual relationships, or notably dense sentence structure. An educated non-specialist would need to re-read occasionally.
  high      — Dense specialised content: formal scientific, mathematical, or legal reasoning; passage requires tracking multiple co-dependent concepts or a chain of logical steps.
  very_high — Reserved for passages that are extremely difficult even for specialists: nested formal reasoning, heavy symbolic notation, extreme concept density, or language that is almost impossible to follow at speed.

What does NOT raise difficulty:
  - Literary or unusual vocabulary that is still contextually clear
  - Long words or sentences that parse easily
  - Dialogue, even with unusual character voices
  - Unfamiliar proper nouns (names, places, brands)
  - Stylistic or rhetorical flourish
  - Slightly formal register

What raises difficulty:
  - New or specialised terminology used without definition
  - Dense conceptual relationships the reader must track simultaneously
  - Abstract reasoning or formal logic
  - Equations, formulas, or symbolic notation
  - Many entities or facts that must be held in working memory
  - Complex syntax where clause dependencies obscure the main point
  - Technical explanations that assume prior domain knowledge

Return a JSON array — one object per input chunk, in the same order — with exactly these fields:
  id (number, matching the input chunk's id), difficulty (1–5 float), level (string), factors (string[]), reason (one sentence max)

Be conservative: when in doubt, assign "normal".`

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })
  }

  let chunks: AnalysisChunk[]
  try {
    const body = await req.json()
    chunks = body.chunks
    if (!Array.isArray(chunks) || chunks.length === 0) {
      return NextResponse.json({ error: "chunks must be a non-empty array" }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const userPrompt = chunks
    .map((c) => `CHUNK ${c.id}:\n${c.text}`)
    .join("\n\n---\n\n")

  try {
    const ai = new GoogleGenAI({ apiKey })

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0,
      },
    })

    const raw = response.text
    if (!raw) {
      return NextResponse.json({ error: "Empty response from Gemini" }, { status: 502 })
    }

    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return NextResponse.json({ error: "Unexpected Gemini response shape" }, { status: 502 })
    }

    // Build a lookup from the model's returned IDs.
    const submittedIds = new Set(chunks.map((c) => c.id))
    const rawById = new Map<number, Record<string, unknown>>()
    for (const item of parsed) {
      const obj = item as Record<string, unknown>
      if (typeof obj.id === "number" && submittedIds.has(obj.id)) {
        rawById.set(obj.id, obj)
      }
    }

    // Produce exactly one result per submitted chunk.
    // Chunks with missing/invalid model output default to normal pacing.
    const results: ChunkDifficultyResult[] = chunks.map((chunk) => {
      const obj = rawById.get(chunk.id)
      if (!obj) {
        return { id: chunk.id, difficulty: 1, level: "normal" as DifficultyLevel, factors: [], reason: "" }
      }
      const difficulty = typeof obj.difficulty === "number" ? Math.min(5, Math.max(1, obj.difficulty)) : 1
      const level: DifficultyLevel = VALID_LEVELS.has(obj.level as DifficultyLevel)
        ? (obj.level as DifficultyLevel)
        : "normal"
      const factors = Array.isArray(obj.factors)
        ? (obj.factors as string[]).filter((f) => typeof f === "string")
        : []
      const reason = typeof obj.reason === "string" ? obj.reason : ""
      return { id: chunk.id, difficulty, level, factors, reason }
    })

    return NextResponse.json({ results })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Gemini request failed: ${msg}` }, { status: 502 })
  }
}
