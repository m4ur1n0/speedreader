export type HighlightAnalysisStatus = "pending" | "complete" | "error"
export type FollowUpStatus = "idle" | "loading" | "error"

export interface HighlightAnalysis {
  highlightId: string
  canonicalStart: number
  canonicalEnd: number
  explanation: string
  keyPoints: string[]
  relationToReading: string
  status: HighlightAnalysisStatus
  followUpAnswer?: string
  followUpStatus: FollowUpStatus
}

export interface HighlightAnalysisInput {
  id: string
  highlightedText: string
  contextBefore: string
  contextAfter: string
  documentTitle?: string
}

export interface HighlightAnalysisResult {
  id: string
  explanation: string
  keyPoints: string[]
  relationToReading: string
}
