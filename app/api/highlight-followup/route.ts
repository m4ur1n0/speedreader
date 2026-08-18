import { NextRequest, NextResponse } from "next/server"
import { GoogleGenAI } from "@google/genai"

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-flash-latest"
const GEMINI_TIMEOUT_MS = 20_000

const SYSTEM_PROMPT = `You are a reading annotation assistant answering a follow-up question about a specific highlighted passage from a document.

You will be given:
- The highlighted passage text
- Context before and after the highlight
- An existing annotation (explanation, key points, relation to reading)
- A user question about this highlight

Answer the question concisely and directly. 2–4 sentences is ideal. Stay focused on the highlighted passage — do not wander into unrelated content. Use the context to give an accurate, grounded answer.`

interface ExistingAnalysis {
  explanation: string
  keyPoints: string[]
  relationToReading: string
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })
  }

  let highlightedText: string
  let contextBefore: string
  let contextAfter: string
  let documentTitle: string | undefined
  let existingAnalysis: ExistingAnalysis
  let question: string

  try {
    const body = await req.json()
    highlightedText = body.highlightedText
    contextBefore = body.contextBefore ?? ""
    contextAfter = body.contextAfter ?? ""
    documentTitle = body.documentTitle
    existingAnalysis = body.existingAnalysis
    question = body.question

    if (typeof highlightedText !== "string" || !highlightedText.trim()) {
      return NextResponse.json({ error: "highlightedText is required" }, { status: 400 })
    }
    if (typeof question !== "string" || !question.trim()) {
      return NextResponse.json({ error: "question is required" }, { status: 400 })
    }
    if (question.length > 500) {
      return NextResponse.json({ error: "question exceeds 500 characters" }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parts: string[] = []
  if (documentTitle) parts.push(`Document: "${documentTitle}"`)
  if (contextBefore) parts.push(`Context before:\n${contextBefore}`)
  parts.push(`Highlighted passage:\n"${highlightedText}"`)
  if (contextAfter) parts.push(`Context after:\n${contextAfter}`)

  if (existingAnalysis) {
    parts.push(
      `Existing annotation:\nExplanation: ${existingAnalysis.explanation}\nKey points: ${existingAnalysis.keyPoints.join("; ")}\nRelation to reading: ${existingAnalysis.relationToReading}`
    )
  }

  parts.push(`Follow-up question: ${question}`)

  const userPrompt = parts.join("\n\n")

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
          temperature: 0.3,
        },
      }),
      timeoutPromise,
    ]).finally(() => clearTimeout(timeoutId))

    const answer = response.text?.trim()
    if (!answer) {
      return NextResponse.json({ error: "Empty response from Gemini" }, { status: 502 })
    }

    return NextResponse.json({ answer: answer.slice(0, 1000) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const status = msg.includes("429") || msg.includes("quota") ? 429 : 502
    return NextResponse.json({ error: `Gemini request failed: ${msg}` }, { status })
  }
}
