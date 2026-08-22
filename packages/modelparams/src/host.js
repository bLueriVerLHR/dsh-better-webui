/**
 * better-webui model sampling parameters host half: a global default
 * temperature configured from the composer input box, pinned per session.
 *
 * Mechanism (all official DSH extension points, zero dsh source changes):
 *
 *   - The `agent/request` waterfall (`dsh-agent-loop` buildRequest, fired
 *     before the request is frozen) is the designed "replace the frozen call
 *     configuration" hook. `await next()` yields the `LlmCallConfig` the
 *     machine would use; returning a replacement with `temperature` set flows
 *     it through `prepareCall` → canonicalHeader → frozen request → pi-ai
 *     adapter (`options.temperature`) → wire.
 *
 *   - Session-scoped pinning: the user's model is "a default value for each
 *     new session, fixed within a session". This half keeps a
 *     `Map<sessionId, temperature|undefined>` of the pinned value per live
 *     session. On the FIRST `agent/request` for a session the effective
 *     temperature is resolved from the settings (enabled ? global : undefined)
 *     and stored; every later request of that session reuses the stored value,
 *     so changing the input mid-session affects only NEW sessions. State is
 *     pruned on `agent/disposed`.
 *
 *   - Persist vs hot mode: `mode: 'persist'` writes to settings.yaml and
 *     survives restarts; `mode: 'hot'` applies for the current run and the
 *     boot pass clears it (so a hot value never silently persists).
 *
 * Wire: the browser half calls `ctx.connection.rpc.call('/better-webui-modelparams',
 * '<method>', payload)` and receives `{ ok, value | error }`.
 */

import z from '@deepseek-ai/schemastery'

/** Settings namespace holding the global default temperature + mode. */
export const NS = 'better-webui-modelparams'
/** RPC channel name (browser half must match). */
export const CHANNEL = '/better-webui-modelparams'
/** Wire version of this channel; the browser half refuses actions when it sees an older host. */
export const WIRE_VERSION = 1

/** The DSH/pi-ai default temperature when no override is configured. */
export const DEFAULT_TEMPERATURE = 1.0

/** The `better-webui-modelparams` namespace schema. */
export const Schema = z.object({
  /** Whether to override the model's default temperature at all. */
  enabled: z.boolean().default(false),
  /** The global default temperature (0–2), used for each NEW session. */
  temperature: z.number().min(0).max(2).default(DEFAULT_TEMPERATURE),
  /** persist = survives restart; hot = current run only (cleared at boot). */
  mode: z.union(['persist', 'hot']).default('persist'),
})

/** Log prefix. */
function where(label) {
  return label === undefined || label === null || label === ''
    ? 'better-webui-modelparams'
    : `better-webui-modelparams ${label}`
}

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

/** Structural equality for the three scalar fields (apply-idempotency). */
export function configEqual(a, b) {
  if (a === b) return true
  if (a === null || typeof a !== 'object' || b === null || typeof b !== 'object') return false
  return a.enabled === b.enabled
    && a.temperature === b.temperature
    && a.mode === b.mode
}

/** The persisted section shape as a plain config object (never undefined fields). */
export function sectionToConfig(section) {
  const src = section !== null && typeof section === 'object' ? section : {}
  return {
    enabled: src.enabled === true,
    temperature: typeof src.temperature === 'number' ? src.temperature : DEFAULT_TEMPERATURE,
    mode: src.mode === 'hot' ? 'hot' : 'persist',
  }
}

/**
 * Resolve the effective temperature for one request, given the pinned value
 * for the session. `pinned === undefined` means "follow the model default"
 * (no temperature on the wire); any number means an override.
 * @param {number|undefined} pinned - the session's pinned temperature.
 * @param {object} config - the machine's LlmCallConfig from `next()`.
 * @returns {object} the replacement config (unchanged when nothing to apply).
 */
export function applyTemperature(pinned, config) {
  if (pinned === undefined) return config
  if (config === null || typeof config !== 'object') return config
  if (config.temperature === pinned) return config
  return { ...config, temperature: pinned }
}

/**
 * The `/better-webui-modelparams` channel handler table (Command pattern).
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 * @returns {(endpoint: string, payload: unknown) => Promise<{ok: boolean}>} the channel handler.
 */
export function makeHandler(ctx) {
  const read = () => {
    const section = ctx.settings.get(NS)
    return sectionToConfig(section)
  }

  const clamp = (value) => {
    const src = value !== null && typeof value === 'object' ? value : {}
    const temperature = Number(src.temperature)
    if (!Number.isFinite(temperature)) throw new Error('apply: temperature must be a number')
    return {
      enabled: src.enabled === true,
      temperature: Math.max(0, Math.min(2, temperature)),
      mode: src.mode === 'hot' ? 'hot' : 'persist',
    }
  }

  const apply = async (payload, label) => {
    const next = clamp(payload)
    const current = sectionToConfig(ctx.settings.get(NS))
    if (configEqual(current, next)) {
      return { changed: false, config: next }
    }
    const descriptor = ctx.settings.describe().find((entry) => entry.ns === NS)
    await ctx.settings.mutate(NS, [
      { op: 'set', path: ['enabled'], value: next.enabled },
      { op: 'set', path: ['temperature'], value: next.temperature },
      { op: 'set', path: ['mode'], value: next.mode },
    ], descriptor?.revision)
    console.warn(`${where(label)}: applied ${next.mode} mode, enabled=${next.enabled}, temperature=${next.temperature}`)
    return { changed: true, config: next }
  }

  const table = {
    ping: () => ({ v: WIRE_VERSION }),
    read: () => read(),
    apply: (payload) => apply(payload, 'apply'),
    reset: () => apply({ enabled: false, temperature: DEFAULT_TEMPERATURE, mode: 'persist' }, 'reset'),
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

/** Required host services: the RPC channel registry and the settings service. */
export const inject = ['connection', 'settings']

/**
 * Register the `/better-webui-modelparams` RPC channel and the
 * `better-webui-modelparams` settings namespace, install the `agent/request`
 * interceptor with session-scoped pinning, prune on `agent/disposed`, and
 * clear a leftover `hot` mode at boot.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 */
export function apply(ctx) {
  // Namespace registration is an effect on this plugin's fiber — it is
  // disposed automatically on stop/update, no manual dispose needed.
  const scope = ctx.settings.register(NS, Schema)

  const handler = makeHandler(ctx)
  const handle = ctx.connection.rpc.handle(CHANNEL, handler, { authority: 'trusted-host' })
  ctx.effect(() => handle, 'better-webui-modelparams: rpc channel')

  /** Per-session pinned temperature: Map<sessionId, number|undefined>. */
  const pinnedBySession = new Map()

  // Boot-clear: a leftover 'hot' value from a previous run applies for that
  // run only; on startup reset it so it does not silently re-apply.
  const boot = sectionToConfig(ctx.settings.get(NS))
  if (boot.mode === 'hot') {
    const descriptor = ctx.settings.describe().find((entry) => entry.ns === NS)
    ctx.settings.mutate(NS, [
      { op: 'set', path: ['enabled'], value: false },
      { op: 'set', path: ['temperature'], value: DEFAULT_TEMPERATURE },
      { op: 'set', path: ['mode'], value: 'persist' },
    ], descriptor?.revision)
      .then(() => console.warn(`${where('boot')}: cleared leftover hot-mode sampling config`))
      .catch((error) => {
        console.warn(`${where('boot')}: failed to clear leftover hot mode: ${error instanceof Error ? error.message : String(error)}`)
      })
  }

  // The interceptor: pin the effective temperature per session on its first
  // request, then keep it fixed for the session's lifetime.
  const disposeInterceptor = ctx.on('agent/request', async (payload, next) => {
    const config = await next()
    if (config === null || typeof config !== 'object') return config
    const sid = payload?.agent?.id
    let pinned
    if (sid !== undefined && pinnedBySession.has(sid)) {
      pinned = pinnedBySession.get(sid)
    } else {
      const current = sectionToConfig(ctx.settings.get(NS))
      pinned = current.enabled && typeof current.temperature === 'number'
        ? current.temperature
        : undefined
      if (sid !== undefined) pinnedBySession.set(sid, pinned)
    }
    return applyTemperature(pinned, config)
  })
  ctx.effect(() => disposeInterceptor, 'better-webui-modelparams: agent/request interceptor')

  // Prune per-session state when an agent leaves the registry.
  const disposePrune = ctx.on('agent/disposed', (payload) => {
    const sid = payload?.agent?.id
    if (sid !== undefined) pinnedBySession.delete(sid)
  })
  ctx.effect(() => disposePrune, 'better-webui-modelparams: session prune')
}
