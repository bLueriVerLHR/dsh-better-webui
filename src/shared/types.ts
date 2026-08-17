/** Shared wire types between the better-webui host and browser halves. */
import type { SessionId } from '@deepseek-ai/dsh-session'

export interface TrashRecord {
  sessionId: SessionId
  trashedAt: number
}

export interface BranchRecord {
  sessionId: SessionId
  parentSessionId: SessionId
  branchAtSeq: number
}

export interface BetterWebMetadata {
  trash: TrashRecord[]
  branches: BranchRecord[]
}

export interface BranchRequest {
  sessionId: SessionId
  atSeq: number
  childSessionId?: SessionId
}

export interface TrashRequest {
  sessionId: SessionId
}

export interface RestoreRequest {
  sessionId: SessionId
}

export interface DestroyRequest {
  sessionId: SessionId
}
