/**
 * Host-half test for the model sampling parameters package:
 *   - pure helpers: sectionToConfig / configEqual / applyTemperature / sectionOf;
 *   - the RPC handler (read / apply / reset, empty→default, clamp, idempotency)
 *     over a mocked settings service using replace;
 *   - the agent/request interceptor with session-scoped pinning: a new session
 *     resolves the effective temperature on its first request, keeps it fixed
 *     within the session, and a later session re-resolves; empty temperature
 *     means "no override"; a leftover hot mode is cleared at boot.
 *
 * Run: node tests/host.mjs
 */
import {
  sectionToConfig, configEqual, applyTemperature, sectionOf, DEFAULT_TEMPERATURE,
  apply, NS,
} from '../src/host.js'

const results = []
const check = (ok, label) => { results.push([ok, label]); console.log(`  ${ok ? '✓' : '✗'} ${label}`) }

/* 0. pure helpers. */
{
  const empty = sectionToConfig(undefined)
  check(empty.temperature === undefined && empty.mode === 'persist', 'sectionToConfig：空 → 温度 undefined（跟随默认）/ persist')
  check(sectionToConfig({ temperature: 0.7, mode: 'hot' }).temperature === 0.7
    && sectionToConfig({ temperature: 0.7, mode: 'hot' }).mode === 'hot', 'sectionToConfig：保留有效字段')
  check(sectionToConfig({ temperature: 9 }).temperature === 9, 'sectionToConfig：不夹取（夹取在 apply 层）')
  check(configEqual(sectionToConfig({ temperature: 0.7, mode: 'hot' }), { temperature: 0.7, mode: 'hot' }) === true, 'configEqual：相同 → true')
  check(configEqual({ temperature: 0.7, mode: 'hot' }, { temperature: 0.8, mode: 'hot' }) === false, 'configEqual：温度不同 → false')
  check(configEqual({ temperature: undefined, mode: 'persist' }, { temperature: 0.7, mode: 'persist' }) === false, 'configEqual：空 vs 有值 → false')
  const of = sectionOf({ temperature: 0.7, mode: 'hot' })
  check(of.temperature === 0.7 && of.mode === 'hot', 'sectionOf：保留有值字段')
  check(sectionOf({ temperature: undefined, mode: 'persist' }).temperature === undefined
    && Object.keys(sectionOf({ temperature: undefined, mode: 'persist' })).join(',') === 'mode',
    'sectionOf：温度空 → 不写 temperature 键（replace 会清掉）')
  check(applyTemperature(undefined, { provider: 'p', model: 'm' }).temperature === undefined, 'applyTemperature：pinned undefined → 原样（跟随默认）')
  const applied = applyTemperature(0.7, { provider: 'p', model: 'm' })
  check(applied.temperature === 0.7 && applied.provider === 'p', 'applyTemperature：pinned 数值 → 注入 temperature')
  check(applyTemperature(0.7, { provider: 'p', temperature: 0.7 }).temperature === 0.7
    && Object.keys(applyTemperature(0.7, { provider: 'p', temperature: 0.7 })).length === 2,
    'applyTemperature：已相同 → 返回原对象（不复制）')
}

/* --- settings-capable mock ctx (replace-based) --- */
const writes = [] // { ns, section, revision } for every settings.replace call

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
    replace: async (ns, section, rev) => {
      writes.push({ ns, section, revision: rev })
      current = JSON.parse(JSON.stringify(section))
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

/* 1. RPC handler: defaults, apply (persist), empty→default, reset, clamp. */
writes.length = 0
{
  const { ctx, getRpc } = makeCtx({ user: undefined })
  apply(ctx)
  const rpc = getRpc()
  check(rpc !== null, 'apply() 注册 RPC 通道')

  const ping = await rpc('ping', {})
  check(ping.ok === true && ping.value.v === 1, 'ping 返回 wire 版本')

  const read0 = await rpc('read', {})
  check(read0.ok === true && read0.value.temperature === undefined && read0.value.mode === 'persist'
    && read0.value.defaultTemperature === DEFAULT_TEMPERATURE,
    'read：空命名空间 → 温度空（默认）/ persist，且返回 defaultTemperature')

  const applyRes = await rpc('apply', { temperature: 0.7, mode: 'persist' })
  check(applyRes.ok === true && applyRes.value.changed === true
    && applyRes.value.config.temperature === 0.7, 'apply：填写 0.7 → 覆盖')
  check(writes.length === 1 && writes[0].ns === NS && writes[0].section.temperature === 0.7
    && writes[0].section.mode === 'persist', 'apply：一次 replace 写入 temperature/mode')

  const read1 = await rpc('read', {})
  check(read1.value.temperature === 0.7, 'apply 后 read 反映新值')

  const applySame = await rpc('apply', { temperature: 0.7, mode: 'persist' })
  check(applySame.value.changed === false && writes.length === 1, 'apply：相同配置 → 幂等不写')

  const cleared = await rpc('apply', { temperature: null, mode: 'persist' })
  check(cleared.ok === true && cleared.value.config.temperature === undefined
    && writes[writes.length - 1].section.temperature === undefined,
    'apply：温度传空 → 清除覆盖（回默认）')

  const clamped = await rpc('apply', { temperature: 5, mode: 'persist' })
  check(clamped.value.config.temperature === 2, 'apply：超范围温度被夹取到 2')

  const bad = await rpc('apply', { temperature: 'abc' })
  check(bad.ok === false, 'apply：非数值温度 → 报错')

  const resetRes = await rpc('reset', {})
  check(resetRes.ok === true && resetRes.value.config.temperature === undefined
    && resetRes.value.config.mode === 'persist', 'reset：清空已保存配置（温度空 / persist）')
}

/* 2. interceptor: session pinning + fixed within session + new session re-pins. */
writes.length = 0
{
  const { ctx, events } = makeCtx({ user: { temperature: 0.6, mode: 'persist' } })
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
  ctx.settings.replace(NS, { temperature: 0.9, mode: 'persist' }, 1)
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

/* 3. empty (no stored override) → the system default (DEFAULT_TEMPERATURE) is
      injected, so the wire always carries a concrete value. */
{
  const { ctx, events } = makeCtx({ user: { mode: 'persist' } })
  apply(ctx)
  const request = events['agent/request']
  const config = await request({ agent: { id: 'c' } }, async () => ({ provider: 'p', model: 'm' }))
  check(config.temperature === DEFAULT_TEMPERATURE && config.provider === 'p',
    '温度空 → 注入系统默认 ' + DEFAULT_TEMPERATURE + '（wire 总有具体值）')
}

/* 4. boot hot-clear: a persisted hot mode is cleared to defaults. */
writes.length = 0
{
  const { ctx } = makeCtx({ user: { temperature: 0.4, mode: 'hot' } })
  apply(ctx)
  // apply() boots synchronously; the hot-clear replace is async — await a tick.
  await new Promise((r) => setTimeout(r, 0))
  const hotWrites = writes.filter((w) => w.ns === NS)
  check(hotWrites.length >= 1 && hotWrites[0].section.mode === 'persist'
    && hotWrites[0].section.temperature === undefined,
    'boot：hot 残留被清除（温度回空 / persist）')
}

console.log(results.some(([ok]) => !ok) ? `\n${results.filter(([ok]) => !ok).length} 项失败` : '\n全部通过 ✓')
process.exit(results.some(([ok]) => !ok) ? 1 : 0)
