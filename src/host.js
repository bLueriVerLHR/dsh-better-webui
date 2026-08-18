/**
 * better-webui host half: real two-step session delete, archive-coupled.
 *
 * A plain function plugin (no build step). It registers one dedicated
 * connection RPC channel `/better-webui`; the browser half calls
 * `ctx.connection.rpc.call('/better-webui', '<method>', payload)` and the
 * transport decodes the envelope, so the handler below receives the payload
 * object directly and returns `{ ok, value | error }`.
 *
 * Delete semantics (all three mutate the real storage layer, nothing is a
 * display flag):
 * - `trash`  — quiesce a live agent best-effort, flush buffered events into
 *   the durable log, archive the session through the native
 *   `workspaceRegistry` (it disappears from every sidebar list immediately),
 *   then move the whole per-session storage directory into this DSH home's
 *   trash area and record the move with an `archived` marker.
 * - `restore` — move the directory back and un-archive the id through the
 *   registry's operation queue, so the session returns to its sidebar group.
 * - `destroy` — delete the stored copy plus any residue at the original
 *   location permanently, and drop the id from the archive set.
 * - `cancel` — stop a running agent without touching the session.
 * - `restoreArchived` — drop one id from the registry archive set so the
 *   session returns to its sidebar group (native archive has no unarchive).
 * - `archive` — hide one session through the native `archiveSession`; the
 *   retract flow archives its fork source so only the rewritten child stays
 *   in the sidebar.
 * - `purgeArchived` — drop ids from the registry archive set whose sessions
 *   no longer exist anywhere (neither live nor persisted): cleans the dead
 *   rows earlier manual cleanups left behind. Returns the purged ids so the
 *   client can refresh its lists.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const WAIT_FOR_IDLE_MS = 3000
const CHANNEL = '/better-webui'

/** One trashed session, as persisted in the trash index. */
/** @typedef {{ sessionId: string, title: string, cwd: string | undefined, trashedAt: number,
 *              sessionDir: string, trashDir: string, archived: boolean }} TrashRecord */

/** @typedef {{ sessionId: string, title: string, cwd: string | undefined, trashedAt: number,
 *              archived: boolean }} TrashItemView */

/** @typedef {{ id: string, cwd?: string }} HeaderLike */

/** @typedef {{ list(signal?: AbortSignal): Promise<readonly HeaderLike[]>, locate(meta: HeaderLike): { path: string } | undefined }} PersistenceLike */

/** @typedef {{ get(id: string): { header: HeaderLike } | undefined, flush(session: unknown): Promise<boolean> }} SessionStoreLike */

/** @typedef {{ get(id: string): { cancel(cause: string): void, whenIdle(): Promise<void> } | undefined }} AgentRegistryLike */

/**
 * The workspace registry face this plugin uses. `unarchive`/`forgetArchived`
 * ride the registry's serialized operation queue and durable state writer
 * (TS-private members that remain ordinary methods at runtime); the api-proxy
 * storage watcher then pushes `host/archived-sessions-changed` to every
 * client on commit, so no extra notification is needed.
 * @typedef {{ archivedSessionIds: readonly string[],
 *             archiveSession(id: string): Promise<void>,
 *             enqueueOperation<T>(op: () => Promise<T>): Promise<T>,
 *             requireState(): { archivedSessionIds: string[] },
 *             setState(state: { archivedSessionIds: string[] }): Promise<void> }} RegistryLike */

const delay = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

/** A thrown value as a short wire-safe error result. */
function failure(error) {
  return {
    ok: false,
    error: {
      code: 'internal',
      message: error instanceof Error ? error.message : String(error),
      details: {},
    },
  }
}

/** Join text parts for log lines; undefined/null/empty drop out. */
function where(...parts) {
  return parts.filter((part) => part !== undefined && part !== null && part !== '').join(' ') || 'better-webui'
}

/**
 * Mutate the registry archive set through its serialized operation queue.
 * Runs even when the runtime lost the private members (future refactor):
 * the archive-coupling degrades to a logged no-op instead of failing trash.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 * @param {(registry: RegistryLike) => Promise<void>} mutate - archive-set mutation inside the queue.
 * @param {string} label - log scope.
 */
async function mutateArchiveSet(ctx, mutate, label) {
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined || typeof registry.enqueueOperation !== 'function'
    || typeof registry.requireState !== 'function' || typeof registry.setState !== 'function') {
    console.warn(`${where(label)}: workspace registry exposes no archive-set mutation; skipping`)
    return false
  }
  try {
    await registry.enqueueOperation(async () => {
      const state = registry.requireState()
      await mutate(state)
      await registry.setState(state)
    })
    return true
  } catch (error) {
    console.warn(`${where(label)}: archive-set mutation failed: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

/** Remove ids from the registry archive set. */
function forgetArchived(ctx, ids, label) {
  if (ids.length === 0) return Promise.resolve(true)
  return mutateArchiveSet(ctx, (state) => {
    const drop = new Set(ids)
    state.archivedSessionIds = state.archivedSessionIds.filter((id) => !drop.has(id))
  }, label)
}

/**
 * The `/better-webui` channel handler table.
 *
 * Route shape mirrors the api-gateway's trusted-host posture: same-origin
 * browsers and loopback callers pass; the transport has already validated
 * the envelope before a handler runs.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 * @returns {(endpoint: string, payload: unknown, signal: AbortSignal) => Promise<{ok: boolean}>} the channel handler.
 */
function makeHandler(ctx) {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const trashRoot = join(home, 'better-webui', 'trash')

  const load = () => {
    const index = join(trashRoot, 'trash.json')
    if (!existsSync(index)) return []
    try {
      const parsed = JSON.parse(readFileSync(index, 'utf8'))
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  const save = (records) => {
    mkdirSync(trashRoot, { recursive: true })
    const index = join(trashRoot, 'trash.json')
    const tmp = `${index}.tmp`
    writeFileSync(tmp, `${JSON.stringify(records, null, 2)}\n`)
    renameSync(tmp, index)
  }

  const view = () => [...load()].sort((a, b) => b.trashedAt - a.trashedAt).map((record) => ({
    sessionId: record.sessionId,
    title: record.title,
    cwd: record.cwd,
    trashedAt: record.trashedAt,
    archived: record.archived === true,
  }))

  const headerOf = async (sessionId) => {
    const store = ctx.get('sessions')
    const live = store?.get(sessionId)
    if (live !== undefined) return live.header
    const persistence = ctx.get('sessionPersistence')
    if (persistence === undefined) return undefined
    const headers = await persistence.list()
    return headers.find((header) => header.id === sessionId)
  }

  const quiesce = async (sessionId) => {
    const agents = ctx.get('agents')
    const agent = agents?.get(sessionId)
    if (agent !== undefined) {
      try {
        agent.cancel('disposed')
        await Promise.race([agent.whenIdle(), delay(WAIT_FOR_IDLE_MS)])
      } catch {
        // Best-effort: the move below is correct regardless of agent state.
      }
    }
    const store = ctx.get('sessions')
    const session = store?.get(sessionId)
    if (session !== undefined && store !== undefined) {
      try {
        await store.flush(session)
      } catch {
        // A failing flush keeps whatever is durable; the move still proceeds.
      }
    }
  }

  const trash = async (payload) => {
    const sessionId = String(payload.sessionId ?? '')
    const title = String(payload.title ?? '')
    if (sessionId === '') throw new Error('trash: sessionId is required')
    const records = load()
    if (records.some((record) => record.sessionId === sessionId)) return { items: view() }
    const header = await headerOf(sessionId)
    if (header === undefined) throw new Error(`session "${sessionId}" is neither live nor persisted`)
    await quiesce(sessionId)

    // Native hide first: the session leaves every sidebar list through the
    // registry's own durable path while its directory still exists (the
    // archiveSession existence check passes), then the move takes the bytes.
    let archived = false
    const registry = ctx.get('workspaceRegistry')
    if (registry !== undefined && typeof registry.archiveSession === 'function') {
      try {
        await registry.archiveSession(sessionId)
        archived = true
      } catch (error) {
        console.warn(where('trash', sessionId, `archive-coupling failed: ${error instanceof Error ? error.message : String(error)}`))
      }
    }

    const persistence = ctx.get('sessionPersistence')
    const location = persistence?.locate(header)
    let sessionDir = ''
    let trashDir = ''
    if (location !== undefined && existsSync(location.path)) {
      sessionDir = dirname(location.path)
      trashDir = join(trashRoot, sessionId)
      mkdirSync(trashRoot, { recursive: true })
      rmSync(trashDir, { recursive: true, force: true })
      renameSync(sessionDir, trashDir)
    }

    save([...records, {
      sessionId,
      title,
      cwd: header.cwd,
      trashedAt: Date.now(),
      sessionDir,
      trashDir,
      archived,
    }])
    return { items: view() }
  }

  const restore = async (payload) => {
    const sessionId = String(payload.sessionId ?? '')
    const records = load()
    const record = records.find((candidate) => candidate.sessionId === sessionId)
    if (record === undefined) throw new Error(`session "${sessionId}" is not in the trash`)
    if (record.trashDir !== '' && existsSync(record.trashDir)) {
      if (record.sessionDir !== '') {
        mkdirSync(dirname(record.sessionDir), { recursive: true })
        // A live writer may have recreated a stub at the original location.
        rmSync(record.sessionDir, { recursive: true, force: true })
      }
      renameSync(record.trashDir, record.sessionDir)
    }
    // The restored session was archived by trash; drop the id so it returns
    // to its sidebar group instead of staying hidden in the archive set.
    if (record.archived) await forgetArchived(ctx, [sessionId], `restore ${sessionId}`)
    save(records.filter((candidate) => candidate.sessionId !== sessionId))
    return { items: view() }
  }

  const destroy = async (payload) => {
    const sessionId = String(payload.sessionId ?? '')
    const records = load()
    const record = records.find((candidate) => candidate.sessionId === sessionId)
    if (record === undefined) throw new Error(`session "${sessionId}" is not in the trash`)
    if (record.trashDir !== '') rmSync(record.trashDir, { recursive: true, force: true })
    if (record.sessionDir !== '') rmSync(record.sessionDir, { recursive: true, force: true })
    if (record.archived) await forgetArchived(ctx, [sessionId], `destroy ${sessionId}`)
    save(records.filter((candidate) => candidate.sessionId !== sessionId))
    return { items: view() }
  }

  const cancel = (payload) => {
    const sessionId = String(payload.sessionId ?? '')
    if (sessionId === '') throw new Error('cancel: sessionId is required')
    const agents = ctx.get('agents')
    const agent = agents?.get(sessionId)
    if (agent === undefined) return { cancelled: false }
    agent.cancel('disposed')
    return { cancelled: true }
  }

  /** Drop one id from the archive set so the session returns to the sidebar. */
  const restoreArchived = async (payload) => {
    const sessionId = String(payload.sessionId ?? '')
    if (sessionId === '') throw new Error('restoreArchived: sessionId is required')
    const registry = ctx.get('workspaceRegistry')
    if (registry === undefined) throw new Error('workspace registry is unavailable')
    if (!registry.archivedSessionIds.includes(sessionId)) return { restored: false }
    await forgetArchived(ctx, [sessionId], `restoreArchived ${sessionId}`)
    return { restored: true }
  }

  /** Hide one session through the native archive (retract keeps sources read-only). */
  const archive = async (payload) => {
    const sessionId = String(payload.sessionId ?? '')
    if (sessionId === '') throw new Error('archive: sessionId is required')
    const registry = ctx.get('workspaceRegistry')
    if (registry === undefined) throw new Error('workspace registry is unavailable')
    if (registry.archivedSessionIds.includes(sessionId)) return { archived: false }
    try {
      await registry.archiveSession(sessionId)
    } catch (error) {
      // A session neither live nor persisted cannot be archived; the caller
      // treats this as best-effort and keeps the retract result.
      console.warn(where('archive', sessionId, `failed: ${error instanceof Error ? error.message : String(error)}`))
      return { archived: false }
    }
    return { archived: true }
  }

  const purgeArchived = async () => {
    const registry = ctx.get('workspaceRegistry')
    if (registry === undefined) throw new Error('workspace registry is unavailable')
    const archived = [...registry.archivedSessionIds]
    if (archived.length === 0) return { purged: [], remaining: [] }
    const persistence = ctx.get('sessionPersistence')
    const known = new Set()
    const store = ctx.get('sessions')
    if (store !== undefined) {
      for (const id of archived) if (store.get(id) !== undefined) known.add(id)
    }
    if (persistence !== undefined) {
      for (const header of await persistence.list()) known.add(header.id)
    }
    const purged = archived.filter((id) => !known.has(id))
    if (purged.length === 0) return { purged: [], remaining: archived }
    await forgetArchived(ctx, purged, 'purgeArchived')
    return { purged, remaining: registry.archivedSessionIds }
  }

  const table = {
    listTrash: () => ({ items: view() }),
    trash: (payload) => trash(payload),
    restore: (payload) => restore(payload),
    destroy: (payload) => destroy(payload),
    cancel: (payload) => cancel(payload),
    restoreArchived: (payload) => restoreArchived(payload),
    archive: (payload) => archive(payload),
    purgeArchived: () => purgeArchived(),
  }

  return async (endpoint, payload) => {
    const method = table[endpoint]
    if (method === undefined) {
      return {
        ok: false,
        error: { code: 'bad-request', message: `unknown method "${endpoint}"`, details: {} },
      }
    }
    try {
      return { ok: true, value: await method(payload ?? {}) }
    } catch (error) {
      return failure(error)
    }
  }
}

/** Required host services: the RPC channel registry and session persistence. */
export const inject = ['connection', 'sessionPersistence']

/**
 * Register the `/better-webui` RPC channel.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 */
export function apply(ctx) {
  const handle = ctx.connection.rpc.handle(CHANNEL, makeHandler(ctx), { authority: 'trusted-host' })
  ctx.effect(() => handle, 'better-webui: rpc channel')
}
