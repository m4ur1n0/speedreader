export type DifficultyLevel = "normal" | "mild" | "moderate" | "high" | "very_high"

export interface AnalysisChunk {
  id: number
  startTokenId: number
  /** Exclusive upper bound — token at endTokenId is NOT in this chunk. */
  endTokenId: number
  text: string
}

export interface ChunkDifficultyResult {
  id: number
  /** Numeric difficulty 1–5 (1=easy, 5=very hard). */
  difficulty: number
  level: DifficultyLevel
  factors: string[]
  reason: string
}

export interface ChunkPacing {
  chunkId: number
  startTokenId: number
  endTokenId: number
  /** 1.00 = normal speed, 0.80 = very_high difficulty (reader slows down). */
  slowdownMultiplier: number
}

export type AnalysisStatus =
  | "idle"
  | "pending"
  | "done"
  | "error"
