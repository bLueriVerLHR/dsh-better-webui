/**
 * Host-half test for the configurable retry policy: the pure decision helpers,
 * the plan/provision logic over a mocked settings service, and the RPC handler
 * shape. It must:
 *   - map the global policy into DSH's retryPolicy shape (mode normal + backoff);
 *   - classify each llm-pi-ai provider as unset / ours / custom / set;
 *   - plan writes only for unset or ours-differs-from-target providers, skipping
 *     hand-written policies and already-at-target routes;
 *   - apply the policy into llm-pi-ai and persist the policy + last-applied
 *     marker into the better-webui namespace;
 *   - be idempotent: a second apply with an unchanged policy writes nothing.
 *
 * Run: node tests/host.mjs
 */
import assert from 'node:assert/strict'
import { policyEqual, policyToRetryPolicy, planRetryOps, readRetry, applyRetry, DEFAULT_RETRY_POLICY } from '../src/host.js'

const results = []
const check = (ok, label) => { results.push([ok, label]); console.log(`  ${ok ? '✓' : '✗'} ${label}`) }

/* 0. pure helpers. */
{
  check(policyEqual(DEFAULT_RETRY_POLICY, { maxRetries: 2, initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 }) === true, 'policyEqual：相同策略 → true')
  check(policyEqual(DEFAULT_RETRY_POLICY, { maxRetries: 5, initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 }) === false, 'policyEqual：次数不同 → false')
  check(policyEqual(null, DEFAULT_RETRY_POLICY) === false, 'policyEqual：null → false')
  const shaped = policyToRetryPolicy({ maxRetries: 6, initialDelayMs: 300, maxDelayMs: 30000, jitterRatio: 0.25 })
  check(shaped.mode === 'normal' && shaped.maxRetries === 6
    && shaped.backoff.initialDelayMs === 300 && shaped.backoff.maxDelayMs === 30000
    && shaped.backoff.jitterRatio === 0.25, 'policyToRetryPolicy：DSH retryPolicy 形状（mode normal + backoff）')
}

/* --- a settings-capable mock over a fresh DSH_HOME --- */
const writes = [] // { ns, ops, revision } for every settings.mutate call

/** Apply path ops to a plain-object section, mirroring the real settings mutate. */
function applyOps(section, ops) {
  for (const op of ops) {
    let node = section
    for (let i = 0; i < op.path.length - 1; i++) {
      const key = op.path[i]
      if (node[key] === null || typeof node[key] !== 'object') node[key] = {}
      node = node[key]
    }
    if (op.op === 'set') node[op.path[op.path.length - 1]] = op.value
  }
  return section
}

/** Build a ctx with a mutable settings service holding the two namespaces. */
function makeCtx({ better, llm }) {
  let betterUser = better
  let llmUser = llm
  let betterRevision = 1
  let llmRevision = 1
  const settings = {
    get: (ns) => {
      if (ns === 'better-webui') return betterUser === undefined ? undefined : JSON.parse(JSON.stringify(betterUser))
      if (ns === 'llm-pi-ai') return llmUser === undefined ? undefined : JSON.parse(JSON.stringify(llmUser))
      return undefined
    },
    describe: () => [
      { ns: 'better-webui', user: betterUser, revision: betterRevision },
      { ns: 'llm-pi-ai', user: llmUser, revision: llmRevision },
    ],
    mutate: async (ns, ops, revision) => {
      writes.push({ ns, ops, revision })
      if (ns === 'better-webui') { betterUser = applyOps({ ...(betterUser ?? {}) }, ops); betterRevision += 1 }
      if (ns === 'llm-pi-ai') { llmUser = applyOps({ ...(llmUser ?? {}) }, ops); llmRevision += 1 }
    },
  }
  const root = { on: () => () => {} }
  return { settings, ctx: { settings, root } }
}

const P1 = { maxRetries: 5, initialDelayMs: 500, maxDelayMs: 30000, jitterRatio: 0.1 }
const P2 = { maxRetries: 8, initialDelayMs: 1000, maxDelayMs: 60000, jitterRatio: 0.2 }
const CUSTOM = { maxRetries: 99, initialDelayMs: 100, maxDelayMs: 5000, jitterRatio: 0.5 }

/* 1. first apply: unset providers get P1, custom provider is skipped, and the
      better-webui namespace records policy + lastApplied = P1. */
writes.length = 0
{
  const { ctx } = makeCtx({
    better: undefined,
    llm: { providers: { alpha: { models: [] }, beta: { models: [], retryPolicy: CUSTOM } } },
  })
  const result = await applyRetry(ctx, P1, 'test')
  check(result.ok === true && result.updated.join(',') === 'alpha' && result.skipped.join(',') === 'beta',
    'apply#1：仅未配置的 alpha 写入；手写 beta 跳过')
  const llmWrites = writes.filter((w) => w.ns === 'llm-pi-ai')
  const betterWrites = writes.filter((w) => w.ns === 'better-webui')
  check(llmWrites.length === 1 && llmWrites[0].ops[0].path.join('.') === 'providers.alpha.retryPolicy'
    && llmWrites[0].ops[0].value.maxRetries === 5, 'apply#1：alpha 的 retryPolicy 写入 DSH 形状')
  check(betterWrites.length === 1 && betterWrites[0].ops.some((o) => o.path.join('.') === 'retry.lastApplied'
    && o.value.maxRetries === 5), 'apply#1：better-webui 持久化 lastApplied = P1')

  const view = await readRetry(ctx)
  check(view.policy.maxRetries === 5 && view.providers.length === 2, 'read：返回策略与两个 provider')
  const alpha = view.providers.find((p) => p.route === 'alpha')
  const beta = view.providers.find((p) => p.route === 'beta')
  check(alpha.status === 'set', 'read：alpha 现在是 set（已应用全局策略）')
  check(beta.status === 'custom', 'read：beta 保持 custom（手写，不覆盖）')
}

/* 2. second apply with an UNCHANGED policy writes nothing (idempotent). */
writes.length = 0
{
  const { ctx } = makeCtx({
    better: { retry: { policy: P1, lastApplied: P1 } },
    llm: { providers: { alpha: { models: [], retryPolicy: { mode: 'normal', maxRetries: 5, backoff: { initialDelayMs: 500, maxDelayMs: 30000, jitterRatio: 0.1 } } } } },
  })
  const result = await applyRetry(ctx, P1, 'test')
  check(result.ok === true && result.updated.length === 0 && result.skipped.join(',') === 'alpha'
    && writes.length === 0, 'apply#2：策略未变 → 不写任何东西（幂等）')
}

/* 3. changing the policy: ours (equal lastApplied) providers get updated to P2;
      custom provider stays; already-at-target is untouched. */
writes.length = 0
{
  const { ctx } = makeCtx({
    better: { retry: { policy: P1, lastApplied: P1 } },
    llm: {
      providers: {
        alpha: { models: [], retryPolicy: { mode: 'normal', maxRetries: 5, backoff: { initialDelayMs: 500, maxDelayMs: 30000, jitterRatio: 0.1 } } }, // ours at P1
        beta: { models: [], retryPolicy: CUSTOM }, // hand-written
        gamma: { models: [], retryPolicy: { mode: 'normal', maxRetries: 8, backoff: { initialDelayMs: 1000, maxDelayMs: 60000, jitterRatio: 0.2 } } }, // already P2
      },
    },
  })
  const result = await applyRetry(ctx, P2, 'test')
  check(result.ok === true && result.updated.join(',') === 'alpha'
    && result.skipped.slice().sort().join(',') === 'beta,gamma',
    'apply#3：更新 alpha（ours），跳过 beta（手写）与 gamma（已是 P2）')
  const llmWrites = writes.filter((w) => w.ns === 'llm-pi-ai')
  check(llmWrites.length === 1 && llmWrites[0].ops[0].path[1] === 'alpha'
    && llmWrites[0].ops[0].value.maxRetries === 8, 'apply#3：alpha 被更新为 P2')
}

/* 4. a hand-written policy that happens to match the last-applied value is
      treated as ours (benign: same value, so overwriting is a no-op change). */
writes.length = 0
{
  const { ctx } = makeCtx({
    better: { retry: { policy: P1, lastApplied: P1 } },
    llm: { providers: { alpha: { models: [], retryPolicy: { mode: 'normal', maxRetries: 5, backoff: { initialDelayMs: 500, maxDelayMs: 30000, jitterRatio: 0.1 } } } } },
  })
  const result = await applyRetry(ctx, P2, 'test')
  check(result.updated.join(',') === 'alpha', 'apply#4：与 lastApplied 相同的策略视为 ours，可更新')
}

console.log(failures(results))
process.exit(results.some(([ok]) => !ok) ? 1 : 0)

function failures(results) {
  const failed = results.filter(([ok]) => !ok).length
  return failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败`
}
