/**
 * better-webui retry host half: configurable LLM retry policy + dedicated
 * retry-policy settings page backend.
 *
 * The native dsh retry policy is **provider-owned**: `dsh-llm-retry` executes
 * the `retryPolicy` found under each `llm-pi-ai.providers.<route>.retryPolicy`
 * (default `maxRetries: 2`, `backoff: { initialDelayMs: 500, maxDelayMs:
 * 10000, jitterRatio: 0.1 }`). There is no global knob — the built-in default
 * is exactly the "too few retries" the user hits. This half closes that gap
 * with one **global default policy** provisioned into every provider that does
 * not deliberately declare its own:
 *
 *   - It owns a `better-webui` settings namespace holding `retry.policy` (the
 *     user's desired global policy — what the settings page edits) and
 *     `retry.lastApplied` (the marker of the last policy this half wrote into
 *     providers, so "we wrote it" is distinguishable from "hand-written").
 *   - On every apply it writes the policy into
 *     `llm-pi-ai.providers.*.retryPolicy` for each provider whose current
 *     retryPolicy is absent OR deep-equals `lastApplied` (i.e. ours); a
 *     provider whose retryPolicy differs from `lastApplied` is a deliberate
 *     hand-written override and is skipped. The written value uses DSH's own
 *     schema (`mode: normal` + `backoff`), so it is served by the exact same
 *     `dsh-llm-retry` machinery and hot-reloads into the live pi-ai adapter
 *     (its `providerRetryPolicy` reads profiles live on settings change) — no
 *     restart needed.
 *
 * Wire: the browser half calls `ctx.connection.rpc.call('/better-webui-retry',
 * '<method>', payload)` and receives `{ ok, value | error }`.
 */

import z from '@deepseek-ai/schemastery'

/** Settings namespace holding the global retry policy + what was last applied. */
export const NS = 'better-webui'
/** The pi-ai provider-profiles namespace this half provisions into. */
export const LLM_NS = 'llm-pi-ai'
/** RPC channel name (browser half must match). */
export const CHANNEL = '/better-webui-retry'
/** Wire version of this channel; the browser half refuses actions when it sees an older host. */
export const WIRE_VERSION = 1

/** The DSH built-in retry policy (dsh-llm retry-policy defaults). */
export const DEFAULT_RETRY_POLICY = Object.freeze({
  maxRetries: 2,
  initialDelayMs: 500,
  maxDelayMs: 10000,
  jitterRatio: 0.1,
})

/** Retry-policy value schema (mirrors dsh-llm's normal-policy shape). */
const policySchema = z.object({
  maxRetries: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER),
  initialDelayMs: z.number().min(0),
  maxDelayMs: z.number().min(0),
  jitterRatio: z.number().min(0).max(1),
})

/** The `better-webui` namespace schema: the global policy + the last-applied marker. */
export const Schema = z.object({
  retry: z.object({
    policy: policySchema.default(DEFAULT_RETRY_POLICY),
    lastApplied: z.union([policySchema, z.never()]).default(undefined),
  }),
})

/** Log prefix. */
function where(label) {
  return label === undefined || label === null || label === ''
    ? 'better-webui-retry'
    : `better-webui-retry ${label}`
}

/** The four policy scalars from either shape (4-scalar or DSH retryPolicy). */
function policyScalars(value) {
  if (value === null || typeof value !== 'object') return undefined
  const backoff = value.backoff !== null && typeof value.backoff === 'object' ? value.backoff : {}
  const maxRetries = value.maxRetries
  const initialDelayMs = value.initialDelayMs ?? backoff.initialDelayMs
  const maxDelayMs = value.maxDelayMs ?? backoff.maxDelayMs
  const jitterRatio = value.jitterRatio ?? backoff.jitterRatio
  if (![maxRetries, initialDelayMs, maxDelayMs, jitterRatio].every(Number.isFinite)) return undefined
  return { maxRetries, initialDelayMs, maxDelayMs, jitterRatio }
}

/** Structural equality for the four policy scalars across both shapes. */
export function policyEqual(a, b) {
  const sa = policyScalars(a)
  const sb = policyScalars(b)
  return sa !== undefined && sb !== undefined
    && sa.maxRetries === sb.maxRetries
    && sa.initialDelayMs === sb.initialDelayMs
    && sa.maxDelayMs === sb.maxDelayMs
    && sa.jitterRatio === sb.jitterRatio
}

/** The provider-neutral policy → DSH `retryPolicy` shape (omitting retryableCodes → DSH defaults). */
export function policyToRetryPolicy(policy) {
  return {
    mode: 'normal',
    maxRetries: policy.maxRetries,
    backoff: {
      initialDelayMs: policy.initialDelayMs,
      maxDelayMs: policy.maxDelayMs,
      jitterRatio: policy.jitterRatio,
    },
  }
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

/**
 * Read the retry settings view the page needs: the effective global policy,
 * the last-applied marker, and every llm-pi-ai provider route with its current
 * retryPolicy and ownership classification.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 * @returns {Promise<{policy: object, lastApplied: object|undefined, providers: Array<{route: string, current: object|undefined, status: 'unset'|'ours'|'custom'|'set'}>}>}
 */
export async function readRetry(ctx) {
  const settings = ctx.settings
  const better = settings.get(NS)
  const policy = better?.retry?.policy ?? DEFAULT_RETRY_POLICY
  const lastApplied = better?.retry?.lastApplied

  const descriptor = settings.describe().find((entry) => entry.ns === LLM_NS)
  const providers = descriptor?.user?.providers
  const routes = []
  if (providers !== null && typeof providers === 'object') {
    for (const [route, profile] of Object.entries(providers)) {
      if (profile === null || typeof profile !== 'object') continue
      const current = profile.retryPolicy
      let status
      if (current === undefined) status = 'unset'
      else if (policyEqual(current, policy)) status = 'set' // already at the target
      else if (lastApplied !== undefined && policyEqual(current, lastApplied)) status = 'ours'
      else status = 'custom'
      routes.push({ route, current: current ?? undefined, status })
    }
  }
  return { policy, lastApplied, providers: routes }
}

/**
 * Decide which provider routes need the given policy written. A route is
 * written when its current retryPolicy is absent (unset), or when it is ours
 * (deep-equals the previous last-applied marker) and still differs from the
 * target policy. Hand-written policies are never touched; routes already at
 * the target policy need no write (idempotent — a provision pass with nothing
 * missing writes nothing, so it cannot ping-pong).
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 * @param {object} policy - the target policy to provision.
 * @returns {Promise<{updated: string[], skipped: string[], ops: Array<object>, revision: number|undefined}>}
 */
export async function planRetryOps(ctx, policy) {
  const settings = ctx.settings
  const lastApplied = settings.get(NS)?.retry?.lastApplied

  const descriptor = settings.describe().find((entry) => entry.ns === LLM_NS)
  const revision = descriptor?.revision
  const providers = descriptor?.user?.providers
  const updated = []
  const skipped = []
  const ops = []
  if (providers !== null && typeof providers === 'object') {
    for (const [route, profile] of Object.entries(providers)) {
      if (profile === null || typeof profile !== 'object') continue
      const current = profile.retryPolicy
      const ours = lastApplied !== undefined && current !== undefined && policyEqual(current, lastApplied)
      if (current !== undefined && !ours) {
        skipped.push(route) // hand-written or already-matching: never overwrite
        continue
      }
      if (current !== undefined && policyEqual(current, policy)) {
        skipped.push(route) // already at the target: nothing to write
        continue
      }
      updated.push(route)
      ops.push({
        op: 'set',
        path: ['providers', route, 'retryPolicy'],
        value: policyToRetryPolicy(policy),
      })
    }
  }
  return { updated, skipped, ops, revision }
}

/**
 * Apply the user's chosen global retry policy: provision it into every
 * llm-pi-ai provider that does not declare a hand-written retryPolicy, then
 * persist the new policy + last-applied marker into the `better-webui`
 * namespace. Idempotent: an apply that changes nothing writes nothing.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 * @param {object} policy - the four policy scalars (already validated by the caller).
 * @param {string} label - log scope.
 * @returns {Promise<{ok: boolean, updated: string[], skipped: string[], changed: boolean}>}
 */
export async function applyRetry(ctx, policy, label) {
  const settings = ctx.settings

  // 1. Provision into llm-pi-ai providers (reads the CURRENT lastApplied marker).
  const plan = await planRetryOps(ctx, policy)
  if (plan.ops.length > 0) {
    await settings.mutate(LLM_NS, plan.ops, plan.revision)
  }

  // 2. Persist the new policy + marker into the better-webui namespace — only
  //    when it actually changed, so a no-op apply cannot re-trigger watchers.
  const better = settings.get(NS)?.retry
  const changed = better === undefined
    || !policyEqual(better.policy, policy)
    || !policyEqual(better.lastApplied, policy)
  if (changed) {
    const betterDescriptor = settings.describe().find((entry) => entry.ns === NS)
    await settings.mutate(NS, [
      { op: 'set', path: ['retry', 'policy'], value: policy },
      { op: 'set', path: ['retry', 'lastApplied'], value: policy },
    ], betterDescriptor?.revision)
  }

  if (plan.ops.length > 0) {
    console.warn(`${where(label)}: applied global retry policy to ${plan.updated.length} provider(s)${plan.skipped.length > 0 ? `; skipped ${plan.skipped.length} hand-written/already-set` : ''}`)
  }
  return { ok: true, updated: plan.updated, skipped: plan.skipped, changed }
}

/**
 * The `/better-webui-retry` channel handler table.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 * @returns {(endpoint: string, payload: unknown) => Promise<{ok: boolean}>} the channel handler.
 */
export function makeHandler(ctx) {
  const clampPolicy = (value) => {
    const src = value !== null && typeof value === 'object' ? value : {}
    const raw = {
      maxRetries: Number(src.maxRetries),
      initialDelayMs: Number(src.initialDelayMs),
      maxDelayMs: Number(src.maxDelayMs),
      jitterRatio: Number(src.jitterRatio),
    }
    if (!Number.isFinite(raw.maxRetries) || !Number.isFinite(raw.initialDelayMs)
      || !Number.isFinite(raw.maxDelayMs) || !Number.isFinite(raw.jitterRatio)) {
      throw new Error('applyRetry: all four policy fields must be numbers')
    }
    return {
      maxRetries: Math.max(0, Math.round(raw.maxRetries)),
      initialDelayMs: Math.max(0, Math.round(raw.initialDelayMs)),
      maxDelayMs: Math.max(0, Math.round(raw.maxDelayMs)),
      jitterRatio: Math.max(0, Math.min(1, raw.jitterRatio)),
    }
  }

  const table = {
    ping: () => ({ v: WIRE_VERSION }),
    read: () => readRetry(ctx),
    apply: (payload) => applyRetry(ctx, clampPolicy(payload?.policy), 'apply'),
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
 * Register the `/better-webui-retry` RPC channel and the `better-webui`
 * settings namespace, then provision the persisted global retry policy once at
 * boot (covers the case where providers were added after a previous apply) and
 * again whenever the llm-pi-ai section or the better-webui section changes
 * (new providers, or an external settings.yaml edit).
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 */
export function apply(ctx) {
  // The global retry policy + last-applied marker. Registration is an effect
  // on this plugin's fiber, so it is disposed automatically on stop/update.
  const scope = ctx.settings.register(NS, Schema)

  const handler = makeHandler(ctx)
  const handle = ctx.connection.rpc.handle(CHANNEL, handler, { authority: 'trusted-host' })
  ctx.effect(() => handle, 'better-webui-retry: rpc channel')

  // Provision the persisted policy at boot and on settings changes. Idempotent:
  // a pass with nothing missing writes nothing, so it cannot ping-pong.
  const provision = () => {
    const policy = ctx.settings.get(NS)?.retry?.policy ?? DEFAULT_RETRY_POLICY
    void applyRetry(ctx, policy, 'provision')
      .catch((error) => {
        console.warn(`${where('provision')}: retry provisioning failed: ${error instanceof Error ? error.message : String(error)}`)
      })
  }
  provision()
  scope.watch(() => { provision() })
  if (typeof ctx.root?.on === 'function') {
    const disposeSettingsWatcher = ctx.root.on('settings/document-updated', (ns) => {
      if (ns === LLM_NS || ns === NS) provision()
    })
    ctx.effect(() => disposeSettingsWatcher, 'better-webui-retry: settings watcher')
  }
}
