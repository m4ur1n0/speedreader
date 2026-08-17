export interface ReaderHighlight {
  id: string
  startTokenId: number
  endTokenId: number
  canonicalStart: number
  canonicalEnd: number
}

/** A highlight still being captured (key held down). */
export interface ActiveHighlight {
  startTokenId: number
  canonicalStart: number
}
