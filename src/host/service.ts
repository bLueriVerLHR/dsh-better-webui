/**
 * Host-side better-webui service: durable trash/restore/destroy metadata and
 * branch creation. Markers are stored in a small JSON file so the browser
 * only ever receives titles, never trashed session content.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {
  BetterWebMetadata, BranchRecord, TrashRecord,
} from '../shared/types.ts'

export interface BetterWebServiceOptions {
  metadataRoot?: string
}

interface MetadataFile {
  trash: TrashRecord[]
  branches: BranchRecord[]
}

export class BetterWebService extends TypertRemoteService {
  static inject = ['sessions']

  private readonly metaPath: string

  constructor(ctx: Context, config: BetterWebServiceOptions = {}) {
    super(ctx, 'betterWebui')
    const root = config.metadataRoot ?? '.'
    this.metaPath = join(root, 'better-webui', 'metadata.json')
    mkdirSync(join(root, 'better-webui'), { recursive: true })
  }

  private load(): MetadataFile {
    if (!existsSync(this.metaPath)) return { trash: [], branches: [] }
    try {
      return JSON.parse(readFileSync(this.metaPath, 'utf8')) as MetadataFile
    } catch {
      return { trash: [], branches: [] }
    }
  }

  private save(file: MetadataFile): void {
    const tmp = `${this.metaPath}.tmp`
    writeFileSync(tmp, JSON.stringify(file, null, 2))
    renameSync(tmp, this.metaPath)
  }

  /** First delete step: mark trashed. */
  @Remote('trash')
  trash(sessionId: SessionId): void {
    const file = this.load()
    if (file.trash.some(r => r.sessionId === sessionId)) return
    file.trash.push({ sessionId, trashedAt: Date.now() })
    this.save(file)
  }

  /** Undo trash. */
  @Remote('restore')
  restore(sessionId: SessionId): void {
    const file = this.load()
    const next = file.trash.filter(r => r.sessionId !== sessionId)
    if (next.length === file.trash.length) return
    file.trash = next
    this.save(file)
  }

  /**
   * Second delete: hard remove session content and its browser metadata.
   * The in-memory/disposed + persistence removal seam is version-specific;
   * implementers should call the harness session-persistence removal API here.
   * This implementation always deletes our metadata so the session disappears
   * from the better-webui list even before the storage seam is wired.
   */
  @Remote('destroy')
  async destroy(sessionId: SessionId): Promise<void> {
    // TODO(storage-seam): dispose the live in-memory session via its owning
    // fiber / `session/disposed`, and remove durable files through the
    // configured `sessionPersistence` / workspace registry removal API.
    const file = this.load()
    file.trash = file.trash.filter(r => r.sessionId !== sessionId)
    file.branches = file.branches.filter(r => r.sessionId !== sessionId)
    this.save(file)
  }

  /** Create a branch from a user-message boundary. */
  @Remote('branch')
  branch(sessionId: SessionId, atSeq: number, childSessionId?: SessionId): SessionId {
    const ctx = this.ctx as unknown as Context
    const sessions = ctx.get('sessions')
    if (sessions === undefined) throw new Error('better-webui: sessions service unavailable')
    const child = sessions.fork(sessionId, atSeq, childSessionId)
    const file = this.load()
    const record: BranchRecord = { sessionId: child.id, parentSessionId: sessionId, branchAtSeq: atSeq }
    file.branches.push(record)
    this.save(file)
    return child.id
  }

  /** Read all better-webui metadata for the client list/tree projection. */
  @Remote('meta')
  meta(): MetadataFile {
    return this.load()
  }

  /** Convert internal metadata to the public shared type (same shape today). */
  toShared(): BetterWebMetadata {
    return this.load()
  }
}
