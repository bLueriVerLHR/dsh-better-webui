/**
 * jsdom integration test for the better-webui client bundle — a real DOM, the
 * app's exact React version, real portals, and dispatched click events.
 *
 * v0.8 scope: the plugin contributes exactly ONE surface — a settings
 * section page in the sidebar nav (below the agent-preset page). This walks
 * its whole flow against the built lib/client.js: the page lists
 * live/legacy/dead rows, restore RPC, two-step permanent delete, dead-record
 * purge, empty state, stale-host hint, and toasts. It also asserts the
 * retired v0.4 surfaces (header trash, footer trash bin) and the retired
 * sidebar-foot tool are gone. The v0.7 live-destroy fix adds: a live-but-data
 * -gone archived row (host `listArchive` reports dead+live) greys as
 * "会话已删" with a "重启后清除" marker and no actions.
 *
 * Run: node tests/smoke.mjs   (after `npm run build`)
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const root = dirname(dirname(fileURLToPath(new URL(import.meta.url))))
const require_ = createRequire(join(root, 'package.json'))

const React = require_('react')
const ReactDOM = require_('react-dom')
const ReactDOMClient = require_('react-dom/client')
const h = React.createElement

/* Real browser globals over jsdom. */
const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', {
  url: 'http://127.0.0.1:3080/',
  pretendToBeVisual: true,
})
globalThis.window = dom.window
globalThis.document = dom.window.document
try { globalThis.navigator = dom.window.navigator } catch { /* Node 24 exposes navigator read-only; jsdom's own is used inside the DOM */ }
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Element = dom.window.Element
globalThis.Node = dom.window.Node
globalThis.getComputedStyle = dom.window.getComputedStyle

/* The bundle reads React etc. through the loader's require. */
const P = await import('./primitives-stub.mjs')
const sandboxRequire = (spec) => {
  if (spec === 'react') return React
  if (spec === 'react-dom') return ReactDOM
  if (spec === '@deepseek-ai/dsh-client-ui-primitives') return P
  throw new Error('unexpected require: ' + spec)
}

/* 1. Load the built bundle through the module-loader envelope. */
const source = readFileSync(join(root, 'lib/client.js'), 'utf8')
if (!source.startsWith('window.__ModuleLoader__.load(')) throw new Error('bundle envelope missing')
const captured = {}
dom.window.__ModuleLoader__ = { load: (handoff) => { captured.handoff = handoff } }
const run = new Function('require', 'window', 'document', source)
run(sandboxRequire, dom.window, dom.window.document)
const handoff = captured.handoff
if (handoff === undefined) throw new Error('bundle did not register its factory')

const moduleExports = handoff.factory(sandboxRequire)
const plugin = moduleExports
if (plugin === undefined || typeof plugin.apply !== 'function') {
  throw new Error('factory return value is not a plugin (loader uses the RETURN value as exports)')
}

const failures = []
const check = (ok, label) => {
  if (ok) console.log('  ✓ ' + label)
  else { console.log('  ✗ ' + label); failures.push(label) }
}

/* 2. apply() against a mock client ctx with a scriptable RPC. */
const rpcLog = []
/** ping answers the wire handshake; other methods default to an empty trash. */
let rpcResponse = async (method) => method === 'ping'
  ? { ok: true, value: { v: 3 } }
  : { ok: true, value: { items: [] } }
const registrations = []
const mockCtx = {
  effect(fn) { const dispose = fn() ?? (() => {}); return dispose },
  locale: { register: () => () => {} },
  slots: {
    inject: (slot, begin) => { begin() },
    register: (spec, component) => { registrations.push({ spec, component }) },
  },
  connection: { rpc: { call: async (channel, method, payload) => {
    rpcLog.push([channel, method, payload])
    return rpcResponse(method, payload)
  } } },
  sessions: { refresh: async () => { rpcLog.push(['refresh']) } },
  workspaces: {},
}
plugin.apply(mockCtx)

const itemReg = registrations.find((r) => r.spec.name === 'settings.section')
const notifyReg = registrations.find((r) => r.spec.name === 'conversation.input.dock')
const notifySettingsReg = registrations.find((r) => r.spec.name === 'settings.general.item')
check(itemReg !== undefined && notifyReg !== undefined && notifySettingsReg !== undefined,
  'apply() 注册三个贡献（设置页 + 会话提醒 + 通用设置行）')
check(registrations.length === 3, '贡献数量精确为三个')
check(registrations.every((r) => r.spec.name !== 'sidebar.footer.action'), '不再注册侧栏图标（与动态插件面板冲突，已移除）')
check(document.getElementById('better-webui-style') !== null, '样式表已注入 <head>')

const injected = itemReg.spec.inject()
check(typeof injected.api.restore === 'function' && typeof injected.api.destroy === 'function'
  && typeof injected.api.purge === 'function' && typeof injected.api.listArchive === 'function',
  'inject 面提供 restore/destroy/purge/listArchive API')
check(notifyReg.spec.id === 'better-webui-notify' && typeof notifyReg.component === 'function',
  '会话活动提醒注册到 conversation.input.dock（id better-webui-notify）')
check(notifySettingsReg.spec.id === 'better-webui-notify' && typeof notifySettingsReg.component === 'function',
  '提示音设置注册到 settings.general.item（id better-webui-notify）')

/* Locale seat over the registered dictionary. */
const dicts = {}
const t = (key, params) => {
  let text = dicts.zh[key] ?? key
  if (params !== undefined) for (const [name, value] of Object.entries(params)) text = text.replace(`{${name}}`, String(value))
  return text
}
plugin.apply.call(null, { ...mockCtx, locale: { register: (ns, d) => { Object.assign(dicts, d); return () => {} } } })
check(dicts.zh !== undefined && dicts.zh['destroyConfirm'] === '再次点击以彻底删除', 'zh 词典含二次确认文案')

/* 3. Mount the tool with a live-archived row, a dead id, and a live-but-data-gone
   id (destroyed while resident; host says dead+live). */
const listState = {
  byId: {
    'session-live': { sessionId: 'session-live', displayTitle: '还活着的归档会话', title: '', blank: false, updatedAt: Date.now() },
    'session-destroyed-live': { sessionId: 'session-destroyed-live', displayTitle: '刚删的活会话', title: '', blank: false, updatedAt: Date.now() },
  },
}
const workspaceState = {
  archivedSessionIds: ['session-live', 'session-dead', 'session-destroyed-live'],
  items: [{ title: 'W', cwd: '/w', sessionIds: ['session-live', 'session-dead', 'session-destroyed-live'] }],
}
rpcResponse = async (method) => {
  if (method === 'ping') return { ok: true, value: { v: 3 } }
  if (method === 'listArchive') {
    return { ok: true, value: { items: [
      { sessionId: 'session-destroyed-live', dead: true, live: true },
    ] } }
  }
  return { ok: true, value: { items: [] } }
}

const host = document.getElementById('host')
const root_ = ReactDOMClient.createRoot(host)
await new Promise((resolve) => {
  root_.render(h(itemReg.component, {
    api: injected.api,
    t,
    useSessions: (selector) => selector(listState),
    useWorkspaces: (selector) => selector(workspaceState),
  }))
  // The archive page reloads asynchronously (listArchive RPC); give React
  // time to commit the status rows (a tight 20ms wait was intermittently
  // racing the RPC resolution and flaking the destroyed-live row assertion).
  setTimeout(resolve, 80)
})

const $ = (sel) => host.querySelector(sel)
const $$ = (sel) => [...host.querySelectorAll(sel)]
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))

/* 3. The page lists rows immediately — no toggle. */
check($$('.bwt-page').length === 1, '只渲染一个设置页（归档）')
check($('.bwt-title')?.textContent === '归档会话', '页面标题为「归档会话」')
check($$('.bwt-list .bwt-row').length === 3, '页面直接列出 3 行归档（活 / 死 / 销毁的活）')
check($('.bwt-intro') !== null && !$('.bwt-intro').textContent.includes('入口'), '简介为一句平实文案（非「入口」清单式）')
check($('.bwt-footer') !== null && $('.bwt-count') === null, '无数量计数；存在死行时出现清除入口')

/* 4. Row states: live row, dead id, and destroyed-live row. */
const listEl = $('.bwt-list')
check(listEl !== null && listEl.textContent.includes('还活着的归档会话'), '活归档行显示 displayTitle')
const deadRow = listEl !== null ? listEl.querySelector('.bwt-row[data-dead]') : null
check(deadRow !== null && listEl.textContent.includes('会话已删'), '死行置灰并标注「会话已删」')
// Dead rows show the truncated id + "…", so match the destroyed-live row by
// its unique "重启后清除" marker rather than the full id.
const destroyedLiveRow = listEl !== null ? [...listEl.querySelectorAll('.bwt-row[data-dead]')]
  .find((row) => row.textContent.includes('重启后清除')) : undefined
check(destroyedLiveRow !== undefined, '销毁的活会话以死行呈现（host listArchive dead+live）')
check(destroyedLiveRow === undefined || destroyedLiveRow.textContent.includes('会话已删'), '销毁的活会话行标注「会话已删」')
check(destroyedLiveRow === undefined || [...destroyedLiveRow.querySelectorAll('button')].length === 0,
  '销毁的活会话行无恢复/删除按钮')

/* 5. Restore a live-archived row → restore RPC + refresh + toast. */
const rowOf = (label) => [...(listEl?.querySelectorAll('.bwt-row') ?? [])].find((row) => row.textContent.includes(label))
const restoreBtn = [...(listEl?.querySelectorAll('button') ?? [])].find((b) => b.getAttribute('aria-label') === '恢复' && rowOf('还活着的归档会话')?.contains(b))
if (restoreBtn !== undefined) {
  rpcLog.length = 0
  await new Promise((r) => { click(restoreBtn); setTimeout(r, 20) })
  check(rpcLog.some(([ch, m, p]) => ch === '/better-webui' && m === 'restore' && p.sessionId === 'session-live'), '活归档行「恢复」发出 restore RPC')
  check(rpcLog.some((entry) => entry[0] === 'refresh'), '恢复后刷新会话列表')
  check(document.body.textContent.includes('已恢复'), '恢复 toast 出现')
} else {
  check(false, '活归档行有恢复按钮')
}

/* 6. Two-step delete on the live-archived row. */
const destroyBtn = [...(listEl?.querySelectorAll('button') ?? [])].find((b) => b.getAttribute('aria-label') === '彻底删除' && rowOf('还活着的归档会话')?.contains(b))
if (destroyBtn !== undefined) {
  rpcLog.length = 0
  await new Promise((r) => { click(destroyBtn); setTimeout(r, 10) })
  check(!rpcLog.some(([ch, m]) => ch === '/better-webui' && m === 'destroy'), '第一次点击不发出 destroy（仅确认态）')
  const confirmDestroy = [...document.body.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '再次点击以彻底删除')
  check(confirmDestroy !== undefined, '删除两步确认态出现')
  if (confirmDestroy !== undefined) {
    await new Promise((r) => { click(confirmDestroy); setTimeout(r, 20) })
    check(rpcLog.some(([ch, m, p]) => ch === '/better-webui' && m === 'destroy' && p.sessionId === 'session-live'), '确认后发出 destroy RPC')
    check(document.body.textContent.includes('已彻底删除'), '删除 toast 出现')
  }
} else {
  check(false, '遗留记录行有彻底删除按钮')
}

/* 7. Dead-record purge: two-step, RPC fires. */
const purgeBtn = [...$$('.bwt-footer button')].find((b) => b.textContent.includes('清除失效记录'))
check(purgeBtn !== undefined, '存在死行时出现「清除失效记录」入口')
if (purgeBtn !== undefined) {
  rpcLog.length = 0
  await new Promise((r) => { click(purgeBtn); setTimeout(r, 10) })
  const purgeConfirm = [...document.body.querySelectorAll('button')].find((b) => b.textContent.includes('再次点击清除'))
  check(purgeConfirm !== undefined, '清除记录两步确认态')
  if (purgeConfirm !== undefined) {
    await new Promise((r) => { click(purgeConfirm); setTimeout(r, 20) })
    check(rpcLog.some(([ch, m]) => ch === '/better-webui' && m === 'purge'), '确认后发出 purge RPC')
  }
}

/* 8. Empty archive set + no records → empty state, no purge control.
      A fresh `key` remounts the section (the settings panel remounts the
      active section on every navigation) so the mount reload runs again. */
rpcResponse = async (method) => method === 'ping'
  ? { ok: true, value: { v: 3 } }
  : { ok: true, value: { items: [] } }
await new Promise((resolve) => {
  root_.render(h(itemReg.component, {
    key: 'empty',
    api: injected.api,
    t,
    useSessions: (selector) => selector(listState),
    useWorkspaces: (selector) => selector({ ...workspaceState, archivedSessionIds: [] }),
  }))
  setTimeout(resolve, 20)
})
check($('.bwt-empty') !== null && $('.bwt-empty')?.textContent.includes('没有归档会话'), '空态显示「没有归档会话」')
check($('.bwt-footer') === null, '无死行时不出现清除入口')

/* 9. Stale host (no ping / old wire): actions disabled with an explicit hint.
      This is the not-yet-restarted window after a host-half change.
      A fresh `key` remounts the section so the mount checkHost re-runs. */
rpcResponse = async (method) => method === 'ping'
  ? { ok: false, error: { code: 'bad-request', message: 'unknown method "ping"' } }
  : { ok: true, value: { items: [] } }
await new Promise((resolve) => {
  root_.render(h(itemReg.component, {
    key: 'stale',
    api: injected.api,
    t,
    useSessions: (selector) => selector(listState),
    useWorkspaces: (selector) => selector(workspaceState),
  }))
  setTimeout(resolve, 30)
})
check($('.bwt-stale') !== null && $('.bwt-stale')?.textContent.includes('请重启 dsh web'), '旧宿主：提示「请重启 dsh web」')
const staleRestore = [...($('.bwt-list')?.querySelectorAll('button') ?? [])].find((b) => b.getAttribute('aria-label') === '恢复')
const staleDestroy = [...($('.bwt-list')?.querySelectorAll('button') ?? [])].find((b) => b.getAttribute('aria-label') === '彻底删除')
check(staleRestore !== undefined && staleRestore.disabled === true, '旧宿主：恢复按钮禁用')
check(staleDestroy !== undefined && staleDestroy.disabled === true, '旧宿主：删除按钮禁用')

/* 10. Session activity notifications (NotifyDock, sound only) + General
       settings row. jsdom has no AudioContext, so a recording fake stands in:
       each oscillator created counts as one chime note (waiting = 2 notes,
       done = 3). No popup is ever rendered. */
let oscCalls = 0
class FakeAudioCtx {
  constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {} }
  resume() { return Promise.resolve() }
  createOscillator() {
    oscCalls += 1
    return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }
  }
  createGain() {
    return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }
  }
}
dom.window.AudioContext = FakeAudioCtx
dom.window.webkitAudioContext = FakeAudioCtx
window.localStorage.clear()

const notifyHost = document.createElement('div')
document.body.appendChild(notifyHost)
const notifyRoot = ReactDOMClient.createRoot(notifyHost)

const sessionSnap = (overrides) => ({
  sessionId: 'session-live',
  running: false,
  pending: [],
  nodes: [],
  ...overrides,
})
const renderNotify = async (snap, key) => {
  await new Promise((resolve) => {
    notifyRoot.render(h(notifyReg.component, { key, session: snap, t }))
    setTimeout(resolve, 20)
  })
}
const bodyNotify = () => document.body.querySelector('.bwt-notify')

// Baseline: idle with nothing pending → no chime, no popup.
await renderNotify(sessionSnap({}), 'n0')
check(oscCalls === 0 && bodyNotify() === null, '提醒：空闲无 pending 无提示音、无弹窗')

// Waiting: pending grows 0 → non-empty → waiting chime (2 notes), still no popup.
await renderNotify(sessionSnap({}), 'n1')
oscCalls = 0
await renderNotify(sessionSnap({ pending: [{ kind: 'question' }] }), 'n1')
check(oscCalls === 2, '提醒：pending 0→1 触发「等待」双音')
check(bodyNotify() === null, '提醒：等待不弹窗')

// Done: running true→false with empty pending and a non-interrupted tail →
// done chime (3 notes).
await renderNotify(sessionSnap({ running: true }), 'n3')
oscCalls = 0
await renderNotify(sessionSnap({ running: false, nodes: [{ kind: 'assistant', seq: 1 }] }), 'n3')
check(oscCalls === 3, '提醒：running true→false 触发「完成」三音')
check(bodyNotify() === null, '提醒：完成不弹窗')

// Interrupted stop is NOT a completion.
await renderNotify(sessionSnap({ running: true }), 'n4')
oscCalls = 0
await renderNotify(sessionSnap({ running: false, nodes: [{ kind: 'assistant', seq: 2, interrupted: true }] }), 'n4')
check(oscCalls === 0, '提醒：被中断的回合不触发完成音')

// Retry-exhaustion failure: turn ends with a turn-error node → error chime
// (2 low notes), never the "done" chime.
await renderNotify(sessionSnap({ running: true }), 'n4b')
oscCalls = 0
await renderNotify(sessionSnap({ running: false, nodes: [{ kind: 'turn-error', seq: 3, turn: 1, step: 1, message: 'boom' }] }), 'n4b')
check(oscCalls === 2, '提醒：重试耗尽失败触发「错误」双音（非完成音）')

// Output-token cap end → also an error/attention chime, not done.
await renderNotify(sessionSnap({ running: true }), 'n4c')
oscCalls = 0
await renderNotify(sessionSnap({ running: false, nodes: [{ kind: 'turn-max-tokens', seq: 4, turn: 1, step: 1 }] }), 'n4c')
check(oscCalls === 2, '提醒：输出上限结束触发「错误」双音（非完成音）')

// Disabled pref → no chime even on a genuine transition.
window.localStorage.setItem('better-webui:notify:enabled', '0')
await renderNotify(sessionSnap({}), 'n5')
oscCalls = 0
await renderNotify(sessionSnap({ pending: [{ kind: 'question' }] }), 'n5')
check(oscCalls === 0, '提醒：开关关闭时不发提示音')

notifyRoot.unmount()
notifyHost.remove()

/* 11. General-settings row: on/off switch + volume slider, persisted to
       localStorage (pure client — no host data). */
window.localStorage.clear()
const settingsHost = document.createElement('div')
document.body.appendChild(settingsHost)
const settingsRoot = ReactDOMClient.createRoot(settingsHost)
await new Promise((resolve) => {
  settingsRoot.render(h(notifySettingsReg.component, { t }))
  setTimeout(resolve, 20)
})

const switchEl = settingsHost.querySelector('.bwt-switch')
const sliderEl = settingsHost.querySelector('.bwt-volume input[type=range]')
check(switchEl !== null && switchEl.getAttribute('role') === 'switch'
  && switchEl.getAttribute('aria-checked') === 'true', '通用设置：默认开关开启')
check(sliderEl !== null && sliderEl.value === '80' && sliderEl.disabled === false,
  '通用设置：默认音量 80 且滑块可用')

await new Promise((r) => { click(switchEl); setTimeout(r, 20) })
check(window.localStorage.getItem('better-webui:notify:enabled') === '0'
  && switchEl.getAttribute('aria-checked') === 'false', '通用设置：关闭开关写入 localStorage')
check(sliderEl.disabled === true, '通用设置：关闭后滑块禁用')

await new Promise((r) => { click(switchEl); setTimeout(r, 20) })
check(window.localStorage.getItem('better-webui:notify:enabled') === '1', '通用设置：重新开启')

// The slider listens to native events: `input` (dragging) only persists the
// value; `change` (release) previews the chime once.
oscCalls = 0
sliderEl.value = '35'
sliderEl.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
await new Promise((r) => setTimeout(r, 20))
check(window.localStorage.getItem('better-webui:notify:volume') === '35', '通用设置：音量滑块拖动写入 localStorage')
check(oscCalls === 0, '通用设置：拖动中不试听')
sliderEl.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
await new Promise((r) => setTimeout(r, 20))
check(oscCalls === 3, '通用设置：松手时试听一次（完成三音）')

settingsRoot.unmount()
settingsHost.remove()

root_.unmount()
console.log(failures.length === 0 ? '\n全部通过 ✓' : `\n${failures.length} 项失败`)
process.exit(failures.length === 0 ? 0 : 1)
