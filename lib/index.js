/**
 * better-webui host half: archived-session management.
 *
 * A plain function plugin (no build step). It registers one dedicated
 * connection RPC channel `/better-webui`; the browser half calls
 * `ctx.connection.rpc.call('/better-webui', '<method>', payload)` and the
 * transport decodes the envelope, so the handler below receives the payload
 * object directly and returns `{ ok, value | error }`.
 *
 * The native UI can archive a session but offers no viewing, unarchive, or
 * delete surface (dsh-workspace README: "archived sessions have no viewing
 * or unarchive surface"). This channel fills exactly that gap:
 *
 * - `listTrash` — legacy trash records (sessions moved into this plugin's
 *   trash area by the retired v0.4 delete flow); they stay restorable here.
 * - `restore` — bring one archived session back to the sidebar: move its
 *   directory out of the trash area when a legacy record exists, then drop
 *   the id from the registry archive set.
 * - `destroy` — permanently delete one archived session: stop a live agent
 *   best-effort, remove every on-disk copy (session dir plus trash-area
 *   residue), drop the legacy record, and clear BOTH durable references —
 *   the registry archive set and the workspace accounting slot — so nothing
 *   of the session remains. The browser guards this with two-step confirm.
 * - `purge` — drop dead references: archive ids and accounting ids whose
 *   sessions exist neither live nor persisted nor in the trash area. Also
 *   run once at boot so past deletes self-heal.
 *
 * Archive-set and accounting writes go through the registry itself: the
 * accounting slot through the public `detachSession`, the archive set
 * through the registry's serialized operation queue (`enqueueOperation` +
 * `setState`, TS-private members that stay ordinary methods at runtime —
 * rc.7 has no public unarchive). Every committed write emits a domain
 * change, and the api-proxy storage watcher pushes
 * `host/archived-sessions-changed` / `host/workspace-changed` frames to all
 * clients, so no extra notification is needed.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const WAIT_FOR_IDLE_MS = 3000
const CHANNEL = '/better-webui'

/** One trashed session from the retired v0.4 delete flow, as persisted in the trash index. */
/** @typedef {{ sessionId: string, title: string, cwd: string | undefined, trashedAt: number,
 *              sessionDir: string, trashDir: string }} TrashRecord */

/** @typedef {{ id: string, cwd?: string }} HeaderLike */

/** @typedef {{ list(signal?: AbortSignal): Promise<readonly HeaderLike[]>, locate(meta: HeaderLike): { path: string } | undefined }} PersistenceLike */

/** @typedef {{ get(id: string): { header: HeaderLike } | undefined, list(): Array<{ header: HeaderLike }>, flush(session: unknown): Promise<boolean> }} SessionStoreLike */

/** @typedef {{ get(id: string): { cancel(cause: string): void, whenIdle(): Promise<void> } | undefined }} AgentRegistryLike */

/**
 * The workspace-registry face this plugin uses beyond its public methods.
 * @typedef {{ archivedSessionIds: readonly string[],
 *             list(): Array<{ detachSession(id: string): Promise<void> }>,
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

/** Log prefix; empty parts drop out. */
function where(...parts) {
  return parts.filter((part) => part !== undefined && part !== null && part !== '').join(' ') || 'better-webui'
}

/**
 * Mutate the registry archive set through its serialized operation queue.
 * Capability-checked: a future dsh that renames the private members skips
 * the mutation with a warning instead of failing the caller's flow.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 * @param {(state: { archivedSessionIds: string[] }) => Promise<void> | void} mutate - archive-set mutation inside the queue.
 * @param {string} label - log scope.
 * @returns {Promise<boolean>} whether the mutation committed.
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

/** Remove one session id from every workspace accounting slot (public API). */
async function detachEverywhere(ctx, sessionId, label) {
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined || typeof registry.list !== 'function') return
  for (const workspace of registry.list()) {
    try {
      await workspace.detachSession(sessionId)
    } catch (error) {
      console.warn(`${where(label)}: accounting detach failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

/**
 * The `/better-webui` channel handler table.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 * @returns {(endpoint: string, payload: unknown, signal: AbortSignal) => Promise<{ok: boolean}>} the channel handler.
 */
function makeHandler(ctx) {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const trashRoot = join(home, 'better-webui', 'trash')

  /* --- legacy trash index (records from the retired v0.4 delete flow) --- */

  const loadRecords = () => {
    const index = join(trashRoot, 'trash.json')
    if (!existsSync(index)) return []
    try {
      const parsed = JSON.parse(readFileSync(index, 'utf8'))
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  const saveRecords = (records) => {
    if (records.length === 0 && !existsSync(join(trashRoot, 'trash.json'))) return
    mkdirSync(trashRoot, { recursive: true })
    const index = join(trashRoot, 'trash.json')
    const tmp = `${index}.tmp`
    writeFileSync(tmp, `${JSON.stringify(records, null, 2)}\n`)
    renameSync(tmp, index)
  }

  /* --- session existence helpers --- */

  /** Every session id the host knows: live store plus persistence headers. */
  const knownIds = async () => {
    const known = new Set()
    const store = ctx.get('sessions')
    if (store !== undefined && typeof store.list === 'function') {
      for (const session of store.list()) known.add(session.header.id)
    }
    const persistence = ctx.get('sessionPersistence')
    if (persistence !== undefined) {
      for (const header of await persistence.list()) known.add(header.id)
    }
    return known
  }

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
        // Best-effort: the removal below is correct regardless of agent state.
      }
    }
    const store = ctx.get('sessions')
    const session = store?.get(sessionId)
    if (session !== undefined && store !== undefined) {
      try {
        await store.flush(session)
      } catch {
        // A failing flush keeps whatever is durable; the removal still proceeds.
      }
    }
  }

  /**
   * Accounting ids from the durable storage file — discovery only; every
   * mutation goes through the registry's public `detachSession`. The entity
   * projection filters dead ids out, so this is the only place they are
   * visible. A missing/unreadable file yields an empty list.
   */
  const accountingOnDisk = () => {
    const file = join(home, 'storages', 'workspace.json')
    if (!existsSync(file)) return []
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      const tables = parsed?.tables?.workspaces
      if (tables === null || typeof tables !== 'object') return []
      const ids = []
      for (const record of Object.values(tables)) {
        if (record !== null && typeof record === 'object' && Array.isArray(record.sessionIds)) {
          ids.push(...record.sessionIds)
        }
      }
      return [...new Set(ids)]
    } catch {
      return []
    }
  }

  /* --- channel methods --- */

  const listTrash = () => ({
    items: loadRecords()
      .sort((a, b) => b.trashedAt - a.trashedAt)
      .map(({ sessionId, title, cwd, trashedAt }) => ({ sessionId, title, cwd, trashedAt })),
  })

  const restore = async (payload) => {
    const sessionId = String(payload.sessionId ?? '')
    if (sessionId === '') throw new Error('restore: sessionId is required')
    const records = loadRecords()
    const record = records.find((candidate) => candidate.sessionId === sessionId)
    if (record !== undefined) {
      if (record.trashDir !== '' && existsSync(record.trashDir)) {
        if (record.sessionDir !== '') {
          mkdirSync(dirname(record.sessionDir), { recursive: true })
          // A live writer may have recreated a stub at the original location.
          rmSync(record.sessionDir, { recursive: true, force: true })
        }
        renameSync(record.trashDir, record.sessionDir)
      }
      saveRecords(records.filter((candidate) => candidate.sessionId !== sessionId))
    }
    const registry = ctx.get('workspaceRegistry')
    if (registry?.archivedSessionIds.includes(sessionId) === true) {
      await forgetArchived(ctx, [sessionId], `restore ${sessionId}`)
    }
    return { restored: true }
  }

  const destroy = async (payload) => {
    const sessionId = String(payload.sessionId ?? '')
    if (sessionId === '') throw new Error('destroy: sessionId is required')

    const records = loadRecords()
    const record = records.find((candidate) => candidate.sessionId === sessionId)
    if (record !== undefined) {
      if (record.trashDir !== '') rmSync(record.trashDir, { recursive: true, force: true })
      if (record.sessionDir !== '') rmSync(record.sessionDir, { recursive: true, force: true })
      saveRecords(records.filter((candidate) => candidate.sessionId !== sessionId))
    } else {
      const header = await headerOf(sessionId)
      if (header !== undefined) {
        await quiesce(sessionId)
        const location = ctx.get('sessionPersistence')?.locate(header)
        if (location !== undefined && existsSync(location.path)) {
          rmSync(dirname(location.path), { recursive: true, force: true })
        }
      }
    }

    const registry = ctx.get('workspaceRegistry')
    if (registry?.archivedSessionIds.includes(sessionId) === true) {
      await forgetArchived(ctx, [sessionId], `destroy ${sessionId}`)
    }
    await detachEverywhere(ctx, sessionId, `destroy ${sessionId}`)
    return { destroyed: true }
  }

  /** Drop dead references: archive ids and accounting ids with no session anywhere. */
  const purge = async () => {
    const known = await knownIds()
    const restorable = new Set(loadRecords().map((record) => record.sessionId))
    const alive = (id) => known.has(id) || restorable.has(id)

    const registry = ctx.get('workspaceRegistry')
    const deadArchived = registry === undefined ? [] : [...registry.archivedSessionIds].filter((id) => !alive(id))
    if (deadArchived.length > 0) {
      await forgetArchived(ctx, deadArchived, 'purge archive set')
      for (const id of deadArchived) await detachEverywhere(ctx, id, `purge ${id}`)
    }

    const deadAccounting = accountingOnDisk().filter((id) => !alive(id))
    for (const id of deadAccounting) await detachEverywhere(ctx, id, `purge ${id}`)

    return { purged: deadArchived, detached: deadAccounting }
  }

  const table = {
    listTrash: () => listTrash(),
    restore: (payload) => restore(payload),
    destroy: (payload) => destroy(payload),
    purge: () => purge(),
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

/** Required host services: the RPC channel registry, session persistence, and the workspace registry. */
export const inject = ['connection', 'sessionPersistence', 'workspaceRegistry']

/**
 * Register the `/better-webui` RPC channel, then self-heal dead references
 * left by earlier deletes or manual cleanups (ids accounted or archived for
 * sessions that no longer exist anywhere).
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 */
export function apply(ctx) {
  const handler = makeHandler(ctx)
  const handle = ctx.connection.rpc.handle(CHANNEL, handler, { authority: 'trusted-host' })
  ctx.effect(() => handle, 'better-webui: rpc channel')

  handler('purge', {}).then((result) => {
    if (result.ok !== true) return
    const { purged, detached } = result.value
    if (purged.length > 0 || detached.length > 0) {
      console.warn(`better-webui boot sweep: purged archive ids [${purged.join(', ')}], detached accounting ids [${detached.join(', ')}]`)
    }
  }).catch(() => {
    // The sweep is best-effort maintenance; failures leave the dead rows for the manual purge.
  })
}
