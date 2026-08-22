/**
 * Host-half test for the custom-model reasoning provisioning: the boot pass
 * and the `settings/document-updated` watcher must grant the full
 * `off/minimal/low/medium/high/xhigh/max` reasoning metadata to every custom
 * model that declares none, upgrade a model that still carries the legacy
 * four-level default, never touch a model that already declares its own
 * `reasoningEfforts` (a custom dict, or false), and stay quiet when nothing
 * is missing or when the settings service is absent.
 *
 * Run: node tests/reasoning.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import * as host from '../src/host.js'

const results = []
const check = (ok, label) => { results.push([ok, label]); console.log(`  ${ok ? '✓' : '✗'} ${label}`) }

/* 0. pure decision helpers: the legacy-default upgrade predicate. */
{
  const LEGACY = { off: null, low: 'low', medium: 'medium', high: 'high' }
  const FULL = { off: null, minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' }
  check(host.isLegacyDefaultEfforts(LEGACY) === true, 'isLegacyDefaultEfforts：恰好等于旧默认四档 → true')
  check(host.isLegacyDefaultEfforts(FULL) === false, 'isLegacyDefaultEfforts：全档位 → false')
  check(host.isLegacyDefaultEfforts({ low: 'low', high: 'high' }) === false, 'isLegacyDefaultEfforts：自定义 dict → false')
  check(host.isLegacyDefaultEfforts(false) === false, 'isLegacyDefaultEfforts：false（退出）→ false')
  check(host.isLegacyDefaultEfforts(undefined) === false, 'isLegacyDefaultEfforts：undefined → false')
  check(host.isLegacyDefaultEfforts({ ...LEGACY, max: 'max' }) === false, 'isLegacyDefaultEfforts：旧默认+新档 → false（已含 max）')
}

/* --- a settings-capable mock over a fresh DSH_HOME --- */
const home = mkdtempSync(join(tmpdir(), 'bwt-reason-'))
process.env.DSH_HOME = home
mkdirSync(join(home, 'sessions', 'proj'), { recursive: true })

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

const makeSettings = (initialUser, revision) => {
  let user = initialUser
  let currentRevision = revision
  return {
    describe: () => [{ ns: 'llm-pi-ai', user, revision: currentRevision }],
    mutate: async (ns, ops, expectedRevision) => {
      writes.push({ ns, ops, revision: expectedRevision })
      // Mirror the real service: a committed write is visible to the next describe.
      user = applyOps(JSON.parse(JSON.stringify(user)), ops)
      currentRevision += 1
    },
  }
}

/** The user section with one provider exercising every model shape. */
const userSection = () => ({
  providers: {
    'custom-gateway': {
      api: 'openai-completions',
      baseURL: 'https://gateway.example/v1',
      models: [
        { id: 'plain-model' },
        { id: 'declared-model', reasoningEfforts: { medium: 'medium', high: 'high' } },
        { id: 'opted-out', reasoningEfforts: false },
        { id: 'with-capacity', name: 'Cap', contextWindow: 1000, maxTokens: 100 },
        // A machine-granted legacy four-level default must be upgraded.
        { id: 'legacy-default', reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high' } },
      ],
      modelOverrides: {
        'override-model': { name: 'Override' },
        'override-declared': { reasoningEfforts: { low: 'low' } },
        'override-legacy': { reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high' } },
      },
    },
    'catalog-route': { models: [] },
  },
})

let settingsService = makeSettings(userSection(), 7)
const listeners = []
const services = {
  sessions: { get: () => undefined, list: () => [], flush: async () => false },
  agents: { get: () => undefined },
  sessionPersistence: { list: async () => [], locate: () => undefined },
  workspaceRegistry: {
    get archivedSessionIds() { return [] },
    list: () => [],
    enqueueOperation: (op) => op(),
    requireState: () => ({ archivedSessionIds: [] }),
    setState: async () => {},
  },
}
const ctx = {
  effect(fn) { return fn() ?? (() => {}) },
  connection: { rpc: { handle: () => () => {} } },
  get: (name) => (name === 'settings' ? settingsService : services[name]),
  root: {
    on: (event, callback) => { listeners.push([event, callback]); return () => {} },
  },
}

const fire = (ns) => {
  for (const [event, callback] of listeners) {
    if (event === 'settings/document-updated') callback(ns)
  }
}

/* 1. boot pass provisions the models lacking reasoning metadata. */
host.apply(ctx)
await new Promise((resolve) => setTimeout(resolve, 30))
check(writes.length === 1, '启动补齐只写一次 settings.mutate')
const boot = writes[0]
check(boot.ns === 'llm-pi-ai', '写入的是 llm-pi-ai 命名空间')
const opsByPath = new Map(boot.ops.map((op) => [op.path.join('.'), op]))
const expected = { off: null, minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' }
const granted = opsByPath.get('providers.custom-gateway.models')
check(granted !== undefined && granted.value.length === 5, 'models 整数组一次写出（保留 5 条）')
check(JSON.stringify(granted.value[0].reasoningEfforts) === JSON.stringify(expected),
  '默认档位为 off/minimal/low/medium/high/xhigh/max')
check(JSON.stringify(granted.value[1].reasoningEfforts) === JSON.stringify({ medium: 'medium', high: 'high' }),
  '已声明 dict 的模型原样保留')
check(granted.value[2].reasoningEfforts === false, 'reasoningEfforts:false 的模型原样保留')
check(JSON.stringify(granted.value[3].reasoningEfforts) === JSON.stringify(expected), '带容量的模型同样补上')
check(JSON.stringify(granted.value[4].reasoningEfforts) === JSON.stringify(expected),
  '旧默认四档的模型被升级到全档位')
check(granted.value[0].id === 'plain-model' && granted.value[3].name === 'Cap', '数组条目其余字段保留')
check(JSON.stringify(opsByPath.get('providers.custom-gateway.modelOverrides.override-model.reasoningEfforts').value)
  === JSON.stringify(expected), 'modelOverrides 未声明的补上')
check(!opsByPath.has('providers.custom-gateway.modelOverrides.override-declared.reasoningEfforts'),
  'modelOverrides 已声明的不动')
check(JSON.stringify(opsByPath.get('providers.custom-gateway.modelOverrides.override-legacy.reasoningEfforts').value)
  === JSON.stringify(expected), 'modelOverrides 旧默认四档的升级到全档位')
check(boot.revision === 7, '写入携带读取时的 revision')
check(!opsByPath.has('providers.catalog-route.models'), '无 models 列表的目录路由不动')

/* 2. watcher re-runs the pass; with nothing missing it writes nothing. */
fire('llm-pi-ai')
await new Promise((resolve) => setTimeout(resolve, 20))
check(writes.length === 1, '全已声明时监听触发不再写入')

/* 3. a model added later is provisioned by the watcher. */
settingsService = makeSettings({
  providers: {
    'custom-gateway': {
      models: [{ id: 'plain-model', reasoningEfforts: expected }, { id: 'brand-new' }],
    },
  },
}, 8)
fire('llm-pi-ai')
await new Promise((resolve) => setTimeout(resolve, 20))
check(writes.length === 2, '新增模型触发一次写入')
const later = writes[1].ops.find((op) => op.path.join('.') === 'providers.custom-gateway.models')
check(later !== undefined && later.value[1].reasoningEfforts !== undefined, '新模型补上默认档位')

/* 4. unrelated namespaces do not trigger a pass. */
fire('locale')
await new Promise((resolve) => setTimeout(resolve, 20))
check(writes.length === 2, '无关命名空间不触发补齐')

/* 5. no settings service: apply still works and never throws. */
writes.length = 0
const bareCtx = {
  effect(fn) { return fn() ?? (() => {}) },
  connection: { rpc: { handle: () => () => {} } },
  get: (name) => (name === 'settings' ? undefined : services[name]),
  root: { on: () => () => {} },
}
host.apply(bareCtx)
await new Promise((resolve) => setTimeout(resolve, 20))
check(writes.length === 0, '无 settings 服务时静默跳过、不影响启动')

const failed = results.filter(([ok]) => !ok)
console.log(failed.length === 0 ? '\n全部通过 ✓' : `\n${failed.length} 项失败`)
process.exit(failed.length === 0 ? 0 : 1)
