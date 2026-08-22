/**
 * Host-half test for the model sampling parameters package:
 *   - pure helpers: sectionToConfig / configEqual / applyTemperature;
 *   - the RPC handler (read / apply / reset, clamp, idempotency) over a mocked
 *     settings service;
 *   - the agent/request interceptor with session-scoped pinning: a new session
 *     resolves the effective temperature on its first request, keeps it fixed
 *     within the session, and a later session re-resolves; disabled means "no
 *     temperature override"; a leftover hot mode is cleared at boot.
 *
 * Run: node tests/host.mjs
 */
import assert from 'node:assert/strict'
import {
  sectionToConfig, configEqual, applyTemperature, DEFAULT_TEMPERATURE,
  makeHandler, apply, NS, CHANNEL,
} from '../src/host.js'

const results = []
const check = (ok, label) => { results.push([ok, label]); console.log(`  ${ok ? '✓' : '✗'} ${label}`) }

/* 0. pure helpers. */
{
  check(sectionToConfig(undefined).enabled === false
    && sectionToConfig(undefined).temperature === DEFAULT_TEMPERATURE
    && sectionToConfig(undefined).mode === 'persist', 'sectionToConfig：空 → 默认（禁用 / 1.0 / persist）')
  check(sectionToConfig({ enabled: true, temperature: 0.7, mode: 'hot' }).temperature === 0.7
    && sectionToConfig({ enabled: true, temperature: 0.7, mode: 'hot' }).mode === 'hot', 'sectionToConfig：保留有效字段')
  check(sectionToConfig({ enabled: true, temperature: 9 }).temperature === 9, 'sectionToConfig：不夹取（夹取在 apply 层）')
  check(configEqual(sectionToConfig({ enabled: true, temperature: 0.7, mode: 'hot' }), { enabled: true, temperature: 0.7, mode: 'hot' }) === true, 'configEqual：相同 → true')
  check(configEqual({ enabled: true, temperature: 0.7, mode: 'hot' }, { enabled: true, temperature: 0.8, mode: 'hot' }) === false, 'configEqual：温度不同 → false')
  check(applyTemperature(undefined, { provider: 'p', model: 'm' }).temperature === undefined, 'applyTemperature：pinned undefined → 原样（跟随默认）')
  const applied = applyTemperature(0.7, { provider: 'p', model: 'm' })
  check(applied.temperature === 0.7 && applied.provider === 'p', 'applyTemperature：pinned 数值 → 注入 temperature')
  check(applyTemperature(0.7, { provider: 'p', temperature: 0.7 }).temperature === 0.7
    && Object.keys(applyTemperature(0.7, { provider: 'p', temperature: 0.7 })).length === 2,
    'applyTemperature：已相同 → 返回原对象（不复制）')
}

/* --- settings-capable mock ctx --- */
const writes = []
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

/** Build a mock ctx around a mutable settings section; captures RPC + events. */
function makeCtx({ user }) {
  let current = user === undefined ? undefined : JSON.parse(JSON.stringify(user))
  let revision = 1
  let rpcHandler = null
  const events = {} // eventName -> handler
  const settings = {
    register: () => ({ /* auto-disposed with fiber */ }),
    get: (ns) => current === undefined ? undefined : JSON.parse(JSON.stringify(current)),
    describe: () => [{ ns: NS, user: current, revision }],
    mutate: async (ns, ops, rev) => {
      writes.push({ ns, ops, revision: rev })
      current = applyOps({ ...(current ?? {}) }, ops)
      revision += 1
    },
  }
  const ctx = {
    settings,
    effect() {},
    connection: {
      rpc: { handle: (ch, handler) => { rpcHandler = handler; return () => {} } },
    },
    on: (event, handler) => { events[event] = handler; return () => {} },
  }
  return { ctx, getRpc: () => rpcHandler, events }
}

/* 1. RPC handler: defaults, apply (persist), reset, clamp. */
writes.length = 0
{
  const { ctx, getRpc } = makeCtx({ user: undefined })
  apply(ctx)
  const rpc = getRpc()
  check(rpc !== null, 'apply() 注册 RPC 通道')

  const ping = await rpc('ping', {})
  check(ping.ok === true && ping.value.v === 1, 'ping 返回 wire 版本')

  const read0 = await rpc('read', {})
  check(read0.ok === true && read0.value.enabled === false
    && read0.value.temperature === DEFAULT_TEMPERATURE && read0.value.mode === 'persist',
    'read：空命名空间 → 默认配置')

  const applyRes = await rpc('apply', { enabled: true, temperature: 0.7, mode: 'persist' })
  check(applyRes.ok === true && applyRes.value.changed === true
    && applyRes.value.config.temperature === 0.7, 'apply：写入启用 + 温度 0.7')
  check(writes.length === 1 && writes[0].ns === NS && writes[0].ops.length === 3,
    'apply：一次 mutate 三字段（enabled/temperature/mode）')

  const read1 = await rpc('read', {})
  check(read1.value.enabled === true && read1.value.temperature === 0.7, 'apply 后 read 反映新值')

  const applySame = await rpc('apply', { enabled: true, temperature: 0.7, mode: 'persist' })
  check(applySame.value.changed === false && writes.length === 1, 'apply：相同配置 → 幂等不写')

  const clamped = await rpc('apply', { enabled: true, temperature: 5, mode: 'persist' })
  check(clamped.value.config.temperature === 2, 'apply：超范围温度被夹取到 2')

  const bad = await rpc('apply', { enabled: true, temperature: 'abc' })
  check(bad.ok === false, 'apply：非数值温度 → 报错')

  const resetRes = await rpc('reset', {})
  check(resetRes.ok === true && resetRes.value.config.enabled === false
    && resetRes.value.config.temperature === DEFAULT_TEMPERATURE, 'reset：回到默认（禁用 / 1.0 / persist）')
}

/* 2. interceptor: session pinning + fixed within session + new session re-pins. */
writes.length = 0
{
  const { ctx, events } = makeCtx({ user: { enabled: true, temperature: 0.6, mode: 'persist' } })
  apply(ctx)
  const request = events['agent/request']
  const disposed = events['agent/disposed']
  check(typeof request === 'function' && typeof disposed === 'function',
    'apply() 注册 agent/request 拦截器与 agent/disposed 清理')

  const nextFor = (tempInHeader) => async () => tempInHeader === undefined
    ? { provider: 'p', model: 'm' }
    : { provider: 'p', model: 'm', temperature: tempInHeader }

  // Session A: first request pins 0.6 from the global config.
  const a1 = await request({ agent: { id: 'a' } }, nextFor(undefined))
  check(a1.temperature === 0.6, '会话 A 首请求：从全局配置解析并钉住 0.6')

  // Even if the global config changes mid-session, session A keeps 0.6
  // (fixed within a session) because the pin was captured on first request.
  ctx.settings.mutate(NS, [
    { op: 'set', path: ['enabled'], value: true },
    { op: 'set', path: ['temperature'], value: 0.9 },
    { op: 'set', path: ['mode'], value: 'persist' },
  ], 1)
  const a2 = await request({ agent: { id: 'a' } }, nextFor(0.6))
  check(a2.temperature === 0.6, '会话 A 后续请求：全局已改仍保持固定 0.6')

  // Session B: a NEW session re-resolves from the current global config (0.9).
  const b1 = await request({ agent: { id: 'b' } }, nextFor(undefined))
  check(b1.temperature === 0.9, '会话 B 首请求：新会话重新解析最新全局 0.9')

  // disposal prunes the session so a reused id re-pins on its next request.
  disposed({ agent: { id: 'b' } })
  const b2 = await request({ agent: { id: 'b' } }, nextFor(undefined))
  check(b2.temperature === 0.9, '会话 B 销毁后复用 id：重新解析')
}

/* 3. disabled → no temperature override; passthrough keeps machine config. */
{
  const { ctx, events } = makeCtx({ user: { enabled: false, temperature: 0.6, mode: 'persist' } })
  apply(ctx)
  const request = events['agent/request']
  const config = await request({ agent: { id: 'c' } }, async () => ({ provider: 'p', model: 'm' }))
  check(config.temperature === undefined && config.provider === 'p', 'enabled=false → 不注入温度（跟随模型默认）')
}

/* 4. boot hot-clear: a persisted hot mode is cleared to defaults. */
writes.length = 0
{
  const { ctx } = makeCtx({ user: { enabled: true, temperature: 0.4, mode: 'hot' } })
  apply(ctx)
  // apply() boots synchronously; the hot-clear mutate is async — await a tick.
  await new Promise((r) => setTimeout(r, 0))
  const hotWrites = writes.filter((w) => w.ns === NS)
  check(hotWrites.length >= 1 && hotWrites[0].ops.some((o) => o.path.join('.') === 'mode' && o.value === 'persist'),
    'boot：hot 残留被清除为 persist 默认')
}

console.log(results.some(([ok]) => !ok) ? `\n${results.filter(([ok]) => !ok).length} 项失败` : '\n全部通过 ✓')
process.exit(results.some(([ok]) => !ok) ? 1 : 0)
