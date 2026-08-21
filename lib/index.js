/**
 * better-webui host half: archived-session management + custom-model
 * reasoning metadata.
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
 * - `ping` — wire-version handshake. The browser half hot-reloads on file
 *   change while this host half loads only at `dsh web` start, so a newer
 *   client against an older host is a normal transient; the client detects
 *   it here and explains instead of surfacing confusing method errors.
 * - `restore` — bring one archived session back to the sidebar: drop the id
 *   from the registry archive set.
 * - `destroy` — permanently delete one archived session: stop a live agent
 *   best-effort, remove the session directory, and detach the workspace
 *   accounting slot. The registry archive id is cleared ONLY for sessions
 *   that are not live in host memory: a live session cannot be disposed (no
 *   public API), so removing the archive id would make it reappear in the
 *   ungrouped bucket instead of deleting; it stays archived and hidden, the
 *   browser greys the row as "session deleted", and the boot sweep clears
 *   the id once the process restarts. The browser guards this with two-step
 *   confirm.
 * - `listArchive` — the registry archive set with per-id data existence
 *   (`dead`) and host-memory residency (`live`), so the popover can grey a
 *   destroyed live session (data gone, still resident until restart) exactly
 *   like a session that no longer exists.
 * - `purge` — drop dead references: archive ids and accounting ids whose
 *   sessions exist neither live nor persisted. Also run once at boot so past
 *   deletes self-heal.
 *
 * The reasoning side is configuration, not a channel method: the native
 * composer's reasoning-effort menu only appears when the model carries
 * reasoning metadata, and a hand-declared custom model (id/name/capacities
 * in `llm-pi-ai.providers.*.models`) has none — the pi-ai adapter reports
 * `reasoning: false`, so the menu is absent even though the config schema
 * supports `reasoningEfforts`. This half grants the standard
 * `off/low/medium/high` levels to every custom model that declares none,
 * writing through the public `settings` service into the same `llm-pi-ai`
 * namespace the user edits by hand (persisted to `settings.yaml`,
 * hot-reloaded by the adapter, so the next menu open offers the levels
 * exactly like a catalog model). The pass is idempotent, runs at boot and
 * again whenever the namespace changes, and never touches a model that
 * already declares `reasoningEfforts` (set `reasoningEfforts: false` in
 * `settings.yaml` to opt a model out).
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

import { existsSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { registerExaSearchProvider } from './web-search-exa.js'

const WAIT_FOR_IDLE_MS = 3000
const CHANNEL = '/better-webui'
/** Wire version of this channel; the browser half refuses actions when it sees an older host. */
const WIRE_VERSION = 3

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

/** Settings namespace carrying the pi-ai provider profiles (`llm-pi-ai:` in settings.yaml). */
const LLM_PI_AI_NS = 'llm-pi-ai'

/**
 * Default reasoning-effort metadata granted to a custom model with none.
 * The level keys are pi-ai thinking levels; `off: null` means "supported,
 * send nothing", and the string values are the `reasoning_effort` spellings
 * the standard openai-completions dispatch sends. A model declaring its own
 * `reasoningEfforts` (a dict or `false`) is never touched.
 */
const DEFAULT_REASONING_EFFORTS = Object.freeze({ off: null, low: 'low', medium: 'medium', high: 'high' })

/** Whether a model profile entry already declares its own reasoning capability. */
function reasoningDeclared(model) {
  return model !== null && typeof model === 'object' && model.reasoningEfforts !== undefined
}

/**
 * Idempotently grant default reasoning metadata to every custom model that
 * declares none, so the native composer's reasoning-effort menu offers levels
 * for it exactly like a catalog model. Reads the user layer of the
 * `llm-pi-ai` settings namespace and writes the missing `reasoningEfforts`
 * back through the same public service; the file provider persists the change
 * to `settings.yaml` and the pi-ai adapter reads profiles live, so the next
 * menu open shows the levels without a restart. Capability-checked: a
 * deployment without a usable settings service skips with a warning instead
 * of failing the plugin.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 * @param {string} label - log scope.
 */
async function provisionCustomModelReasoning(ctx, label) {
  const settings = ctx.get('settings')
  if (settings === undefined || typeof settings.describe !== 'function' || typeof settings.mutate !== 'function') {
    console.warn(`${where(label)}: settings service unavailable; custom-model reasoning levels stay unconfigured`)
    return
  }
  let descriptor
  try {
    descriptor = settings.describe().find((entry) => entry.ns === LLM_PI_AI_NS)
  } catch (error) {
    console.warn(`${where(label)}: could not read settings: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  const providers = descriptor?.user?.providers
  if (providers === null || typeof providers !== 'object') return
  const ops = []
  for (const [route, profile] of Object.entries(providers)) {
    if (profile === null || typeof profile !== 'object') continue
    // `models` is an array, and settings path ops only traverse plain objects,
    // so one op replaces the whole array with every entry preserved and the
    // missing `reasoningEfforts` granted in place.
    if (Array.isArray(profile.models)) {
      const needsGrant = profile.models.some((model) => !reasoningDeclared(model))
      if (needsGrant) {
        ops.push({
          op: 'set',
          path: ['providers', route, 'models'],
          value: profile.models.map((model) => (
            reasoningDeclared(model)
              ? model
              : { ...model, reasoningEfforts: { ...DEFAULT_REASONING_EFFORTS } }
          )),
        })
      }
    }
    // `modelOverrides` is a dict, so a per-entry op reaches each model directly.
    if (profile.modelOverrides !== null && typeof profile.modelOverrides === 'object') {
      for (const [modelId, model] of Object.entries(profile.modelOverrides)) {
        if (reasoningDeclared(model)) continue
        ops.push({
          op: 'set',
          path: ['providers', route, 'modelOverrides', modelId, 'reasoningEfforts'],
          value: { ...DEFAULT_REASONING_EFFORTS },
        })
      }
    }
  }
  if (ops.length === 0) return
  try {
    await settings.mutate(LLM_PI_AI_NS, ops, descriptor.revision)
    console.warn(`${where(label)}: granted default reasoning levels to ${ops.length} custom model(s)`)
  } catch (error) {
    console.warn(`${where(label)}: reasoning-level write failed: ${error instanceof Error ? error.message : String(error)}`)
  }
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

  /**
   * The archive set with per-id data existence and host-memory residency, so
   * the popover can grey a destroyed live session (data gone, still resident
   * until restart) exactly like a session that no longer exists. Headers are
   * fetched once for the whole set, not per id.
   */
  const listArchive = async () => {
    const registry = ctx.get('workspaceRegistry')
    const ids = registry === undefined ? [] : [...registry.archivedSessionIds]
    const store = ctx.get('sessions')
    const persistence = ctx.get('sessionPersistence')
    const headers = persistence === undefined ? [] : await persistence.list()
    const headerById = new Map(headers.map((header) => [header.id, header]))
    const items = []
    for (const id of ids) {
      const liveSession = store?.get(id)
      const header = liveSession !== undefined ? liveSession.header : headerById.get(id)
      let dead
      if (header === undefined) {
        dead = true
      } else {
        const location = persistence?.locate(header)
        dead = location === undefined || !existsSync(location.path)
      }
      items.push({ sessionId: id, dead, live: liveSession !== undefined })
    }
    return { items }
  }

  const restore = async (payload) => {
    const sessionId = String(payload.sessionId ?? '')
    if (sessionId === '') throw new Error('restore: sessionId is required')
    const registry = ctx.get('workspaceRegistry')
    if (registry?.archivedSessionIds.includes(sessionId) === true) {
      await forgetArchived(ctx, [sessionId], `restore ${sessionId}`)
    }
    return { restored: true }
  }

  const destroy = async (payload) => {
    const sessionId = String(payload.sessionId ?? '')
    if (sessionId === '') throw new Error('destroy: sessionId is required')

    const header = await headerOf(sessionId)
    if (header !== undefined) {
      await quiesce(sessionId)
      const location = ctx.get('sessionPersistence')?.locate(header)
      if (location !== undefined && existsSync(location.path)) {
        rmSync(dirname(location.path), { recursive: true, force: true })
      }
    }

    // A live session stays in host memory (session.list serves it) and there
    // is no public API to dispose it, so dropping the archive id here would
    // make it reappear in the ungrouped bucket instead of deleting. Keep it
    // archived and hidden; the browser greys the row as dead, and the boot
    // sweep clears the id once the process restarts and the session is no
    // longer live.
    const registry = ctx.get('workspaceRegistry')
    const store = ctx.get('sessions')
    const live = store?.get(sessionId) !== undefined
    if (!live && registry?.archivedSessionIds.includes(sessionId) === true) {
      await forgetArchived(ctx, [sessionId], `destroy ${sessionId}`)
    }
    await detachEverywhere(ctx, sessionId, `destroy ${sessionId}`)
    return { destroyed: true, ...live ? { keptArchived: true } : {} }
  }

  /** Drop dead references: archive ids and accounting ids with no session anywhere. */
  const purge = async () => {
    const known = await knownIds()
    const alive = (id) => known.has(id)

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
    ping: () => ({ v: WIRE_VERSION }),
    listArchive: () => listArchive(),
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

// ---------------------------------------------------------------------------
// Thinking-tag splitter (llm/stream waterfall)
//
// scnet's Anthropic-compatible proxy sends the model's thinking text in the
// TEXT channel together with literal closing tags (` response` =
// `<` + `/` + `think` + `>`, and `</thinking>`), while the reasoning blocks it
// declares are often empty. The webui faithfully renders those text blocks as
// conversation, so the user sees thinking as visible prose and an empty Think
// area. This host-side transformer rewrites the chunk stream at the
// `llm/stream` waterfall so that text before the last code-safe closing tag
// becomes a reasoning block (the webui then folds it into the Think
// disclosure), and the remaining text stays visible. Empty reasoning blocks
// (a block-start that never received a reasoning-delta and ends with empty
// text) are CLEARED — their block-start/block-end are not emitted, so the UI
// never shows an empty Think box — and if a following reasoning block carries
// content it simply stands on its own (the empty is absorbed into it). Only
// the text channel is rewritten, never content reasoning blocks.
//
// Deliberately scoped to the scnet provider (the source of the leak) and to
// non-auxiliary calls (compaction / session-title pass through untouched).
// ---------------------------------------------------------------------------

/** REAL literal closing tags, built byte-by-byte (writing them literally gets mangled into the English word "response"). */
const TT_CLOSE_SHORT = String.fromCharCode(60, 47, 116, 104, 105, 110, 107, 62) //  response
const TT_CLOSE_LONG = String.fromCharCode(60, 47, 116, 104, 105, 110, 107, 105, 110, 103, 62) // </thinking>

/**
 * Find the LAST closing marker in `text` that is NOT inside inline backticks
 * or a ``` fenced block. Returns `{ at, len }` or `null`. Everything up to it
 * is reasoning; the text after it is the clean reply.
 * @param {string} text
 */
function ttFindLastClosing(text) {
  let inFence = false
  let inlineOdd = false
  let i = 0
  const n = text.length
  let last = null
  while (i < n) {
    const ch = text.charCodeAt(i)
    if (ch === 96 /* ` */) {
      let j = i
      while (j < n && text.charCodeAt(j) === 96) j++
      const run = j - i
      if (run >= 3) {
        if (inFence) inFence = false
        else if (!inlineOdd) inFence = true
      } else if (!inFence) {
        inlineOdd = !inlineOdd
      }
      i = j
      continue
    }
    if (!inFence && !inlineOdd) {
      if (text.startsWith(TT_CLOSE_LONG, i)) {
        last = { at: i, len: TT_CLOSE_LONG.length }
        i += TT_CLOSE_LONG.length
        continue
      }
      if (text.startsWith(TT_CLOSE_SHORT, i)) {
        last = { at: i, len: TT_CLOSE_SHORT.length }
        i += TT_CLOSE_SHORT.length
        continue
      }
    }
    i++
  }
  return last
}

/** Re-emit a buffered text block unchanged (no marker, or marker-only edge). */
function* ttEmitTextPass(block) {
  yield { type: 'block-start', index: block.index, blockType: 'text' }
  if (block.text.length > 0) yield { type: 'text-delta', index: block.index, text: block.text }
  yield { type: 'block-end', index: block.index, block: { type: 'text', text: block.text } }
}

/** Emit one buffered text block, splitting at the last code-safe closing tag. */
function* ttEmitText(block, counter) {
  const found = ttFindLastClosing(block.text)
  if (found === null) {
    yield * ttEmitTextPass(block)
    return
  }
  const thinking = block.text.slice(0, found.at)
  const reply = block.text.slice(found.at + found.len)
  if (thinking.trim().length === 0) {
    yield * ttEmitTextPass(block)
    return
  }
  counter.split += 1
  const ridx = counter.nextIndex++
  yield { type: 'block-start', index: ridx, blockType: 'reasoning' }
  yield { type: 'reasoning-delta', index: ridx, text: thinking }
  yield { type: 'block-end', index: ridx, block: { type: 'reasoning', text: thinking } }
  if (reply.length > 0) {
    const tidx = counter.nextIndex++
    yield { type: 'block-start', index: tidx, blockType: 'text' }
    yield { type: 'text-delta', index: tidx, text: reply }
    yield { type: 'block-end', index: tidx, block: { type: 'text', text: reply } }
  }
}

/**
 * Hook the `llm/stream` waterfall and rewrite scnet streams so leaked thinking
 * text is split into reasoning blocks and empty reasoning blocks are dropped.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 * @returns {() => void} disposer.
 */
function installThinkingTagSplitter(ctx) {
  const stats = { streams: 0, splits: 0, droppedEmpty: 0 }
  const dispose = ctx.on('llm/stream', (options, next) => {
    if (options.provider !== 'scnet') return next()
    if (options.purpose !== undefined && options.purpose !== null) return next()
    const raw = next()
    stats.streams += 1
    return (async function* () {
      const counter = { nextIndex: 1000, split: 0, droppedEmpty: 0 }
      let buf = null
      const swallowed = new Set()
      const pendingReasoning = new Map()
      try {
        for await (const chunk of raw) {
          switch (chunk.type) {
            case 'block-start': {
              if (chunk.blockType === 'text') {
                if (buf !== null) {
                  yield * ttEmitText(buf, counter)
                  swallowed.add(buf.index)
                  buf = null
                }
                buf = { index: chunk.index, text: '' }
              } else if (chunk.blockType === 'reasoning') {
                pendingReasoning.set(chunk.index, { forwardedStart: false, text: '' })
              } else {
                if (buf !== null) {
                  yield * ttEmitText(buf, counter)
                  swallowed.add(buf.index)
                  buf = null
                }
                yield chunk
              }
              break
            }
            case 'text-delta': {
              if (buf !== null && chunk.index === buf.index) {
                buf.text += chunk.text
              } else {
                yield chunk
              }
              break
            }
            case 'reasoning-delta': {
              const p = pendingReasoning.get(chunk.index)
              if (p !== undefined) {
                p.text += chunk.text
                if (!p.forwardedStart) {
                  yield { type: 'block-start', index: chunk.index, blockType: 'reasoning' }
                  p.forwardedStart = true
                }
                yield chunk
              } else {
                yield chunk
              }
              break
            }
            case 'tool-call-delta': {
              if (buf !== null) {
                yield * ttEmitText(buf, counter)
                swallowed.add(buf.index)
                buf = null
              }
              yield chunk
              break
            }
            case 'block-end': {
              if (chunk.block.type === 'text') {
                if (swallowed.has(chunk.index)) {
                  swallowed.delete(chunk.index)
                  break
                }
                if (buf !== null && chunk.index === buf.index) {
                  yield * ttEmitText(buf, counter)
                  buf = null
                } else {
                  yield chunk
                }
              } else if (chunk.block.type === 'reasoning') {
                // Empty reasoning blocks are CLEARED (or merged into the next
                // content reasoning block): a block that never forwarded a
                // start (no reasoning-delta ever arrived, and the block ends
                // with empty text) is dropped here — neither its block-start
                // nor its block-end is emitted, so the UI never shows an
                // empty Think box. If a following reasoning block carries
                // content it is emitted on its own, which is the "merge" of
                // the empty into it. Content blocks are always forwarded.
                const p = pendingReasoning.get(chunk.index)
                pendingReasoning.delete(chunk.index)
                if (p !== undefined) {
                  if (p.forwardedStart || p.text.length > 0) {
                    yield chunk
                  } else if (chunk.block.text !== undefined && chunk.block.text.length > 0) {
                    // Content that arrived only on block-end (no deltas):
                    // forward it as a proper reasoning block.
                    const text = String(chunk.block.text)
                    yield { type: 'block-start', index: chunk.index, blockType: 'reasoning' }
                    yield { type: 'reasoning-delta', index: chunk.index, text }
                    yield { type: 'block-end', index: chunk.index, block: { type: 'reasoning', text } }
                  } else {
                    counter.droppedEmpty += 1
                  }
                } else {
                  yield chunk
                }
              } else {
                yield chunk
              }
              break
            }
            case 'usage':
            case 'finish': {
              if (buf !== null) {
                yield * ttEmitText(buf, counter)
                swallowed.add(buf.index)
                buf = null
              }
              // Upstream occasionally opens a reasoning block it never closes.
              // Close content blocks cleanly so the stream stays
              // protocol-valid; empty (never-started) ones are dropped instead
              // of emitting an empty Think box.
              for (const [idx, p] of pendingReasoning) {
                if (p.forwardedStart || p.text.length > 0) {
                  if (!p.forwardedStart) {
                    yield { type: 'block-start', index: idx, blockType: 'reasoning' }
                    yield { type: 'reasoning-delta', index: idx, text: p.text }
                  }
                  yield { type: 'block-end', index: idx, block: { type: 'reasoning', text: p.text } }
                } else {
                  counter.droppedEmpty += 1
                }
              }
              pendingReasoning.clear()
              yield chunk
              break
            }
            default:
              yield chunk
          }
        }
      } finally {
        stats.splits += counter.split
        stats.droppedEmpty += counter.droppedEmpty
      }
    })()
  })
  ctx.effect(() => dispose, 'better-webui: thinking-tag splitter')
  return () => dispose
}

/** Required host services: the RPC channel registry, session persistence, and the workspace registry. */
export const inject = ['connection', 'sessionPersistence', 'workspaceRegistry']

/**
 * Register the `/better-webui` RPC channel, self-heal dead references left by
 * earlier deletes or manual cleanups (ids accounted or archived for sessions
 * that no longer exist anywhere), and grant the native reasoning-effort menu
 * to custom models that lack reasoning metadata.
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

  // Grant the reasoning menu to custom models: once at boot, then again
  // whenever the llm-pi-ai section changes (settings.yaml hot-reloads, so a
  // model added by hand is provisioned too). The pass is idempotent — a pass
  // with nothing missing writes nothing — so our own writes cannot ping-pong.
  const provision = () => {
    void provisionCustomModelReasoning(ctx, 'reasoning provision').catch(() => {
      // Best-effort configuration aid; failures already warn inside the pass.
    })
  }
  provision()
  // A second pass after boot settles covers late namespace registration: the
  // pi-ai adapter registers its settings section during its own apply, and if
  // that lands after this plugin's boot pass no document event fires to retry.
  const lateTimer = setTimeout(() => provision(), 2000)
  ctx.effect(() => { clearTimeout(lateTimer) }, 'better-webui: late reasoning provision')
  if (typeof ctx.root?.on === 'function') {
    const disposeSettingsWatcher = ctx.root.on('settings/document-updated', (ns) => {
      if (ns !== LLM_PI_AI_NS) return
      provision()
    })
    ctx.effect(() => disposeSettingsWatcher, 'better-webui: reasoning provisioning watcher')
  }

  // Keyless Exa web search: register a `ctx.web` search provider so the
  // model-facing `web_search` tool (mounted by dsh-base's tool-web row) works
  // without any API key — anonymous Exa hosted MCP by default, REST once an
  // `EXA_API_KEY` appears. The seam's `searchProvider` is switched to this
  // provider's id (`exa`) by this bundle's cordis.patch.yml override. Optional
  // via ctx.get so the rest of this plugin never hard-depends on the web seam.
  const web = ctx.get('web')
  if (web !== undefined) {
    const disposeExa = registerExaSearchProvider(web)
    ctx.effect(() => disposeExa, 'better-webui: exa search provider')
  }

  // Thinking-tag splitter: rewrite scnet llm/stream output so thinking text
  // that leaks into the text channel (with literal </think> tags) becomes
  // reasoning blocks the webui folds into the Think disclosure, and empty
  // upstream reasoning blocks are dropped. No hard dependency — if the `llm`
  // seam or the event bus is unavailable, this simply does nothing.
  if (typeof ctx.on === 'function') {
    try {
      const disposeSplitter = installThinkingTagSplitter(ctx)
      // ctx.effect already registered inside; disposer is redundant but kept for symmetry.
      void disposeSplitter
    } catch (error) {
      console.warn(`better-webui: thinking-tag splitter failed to install: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
