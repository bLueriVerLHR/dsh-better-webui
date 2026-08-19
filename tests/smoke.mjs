/**
 * jsdom integration test for the better-webui client bundle — a real DOM, the
 * app's exact React version, real portals, and dispatched click events.
 *
 * v0.5 scope: the plugin contributes exactly ONE surface — the sidebar-foot
 * archive tool. This walks its whole flow against the built lib/client.js:
 * popover open, live/legacy/dead rows, restore RPC, two-step permanent
 * delete, dead-record purge, and toasts. It also asserts the retired v0.4
 * surfaces (header trash, footer trash bin) are gone.
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
let rpcResponse = async () => ({ ok: true, value: { items: [] } })
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

const footerReg = registrations.find((r) => r.spec.name === 'sidebar.footer.action')
check(registrations.length === 1 && footerReg !== undefined, 'apply() 只注册一个贡献（侧栏归档工具）')
check(registrations.every((r) => r.spec.name !== 'conversation.session.header.actions'), '不再注册标题栏垃圾桶（已移除）')
check(document.getElementById('better-webui-style') !== null, '样式表已注入 <head>')

const injected = footerReg.spec.inject()
check(typeof injected.api.restore === 'function' && typeof injected.api.destroy === 'function'
  && typeof injected.api.purge === 'function' && typeof injected.api.listTrash === 'function',
  'inject 面提供 restore/destroy/purge/listTrash API')

/* Locale seat over the registered dictionary. */
const dicts = {}
const t = (key, params) => {
  let text = dicts.zh[key] ?? key
  if (params !== undefined) for (const [name, value] of Object.entries(params)) text = text.replace(`{${name}}`, String(value))
  return text
}
plugin.apply.call(null, { ...mockCtx, locale: { register: (ns, d) => { Object.assign(dicts, d); return () => {} } } })
check(dicts.zh !== undefined && dicts.zh['destroyConfirm'] === '再次点击以彻底删除', 'zh 词典含二次确认文案')

/* 3. Mount the tool with a live-archived row, a legacy trash record, and a dead id. */
const listState = {
  byId: {
    'session-live': { sessionId: 'session-live', displayTitle: '还活着的归档会话', title: '', blank: false, updatedAt: Date.now() },
  },
}
const workspaceState = {
  archivedSessionIds: ['session-live', 'session-dead'],
  items: [{ title: 'W', cwd: '/w', sessionIds: ['session-live', 'session-dead'] }],
}
rpcResponse = async () => ({ ok: true, value: { items: [{ sessionId: 'session-moved', title: '搬走的会话', cwd: '/w', trashedAt: Date.now() }] } })

const host = document.getElementById('host')
const root_ = ReactDOMClient.createRoot(host)
await new Promise((resolve) => {
  root_.render(h(footerReg.component, {
    api: injected.api,
    t,
    wide: true,
    useSessions: (selector) => selector(listState),
    useWorkspaces: (selector) => selector(workspaceState),
  }))
  setTimeout(resolve, 20)
})

const $ = (sel) => host.querySelector(sel)
const $$ = (sel) => [...host.querySelectorAll(sel)]
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))

check($$('.bwt-tool').length === 1, '只渲染一个工具图标（归档；回收站已移除）')
check($('.bwt-tools') && $('.bwt-tools').getAttribute('data-wide') === 'true', '工具行与 Settings 行对齐（data-wide）')

/* 4. Open the popover: three row kinds. */
const tool = $$('.bwt-tool').find((b) => b.getAttribute('aria-label') === '归档会话')
await new Promise((r) => { click(tool); setTimeout(r, 20) })
let pop = document.body.querySelector('.bwt-pop')
check(pop !== null && pop.textContent.includes('归档会话'), '归档弹层打开')
check(pop !== null && pop.textContent.includes('还活着的归档会话'), '活归档行显示 displayTitle')
check(pop !== null && pop.textContent.includes('搬走的会话'), '遗留回收站记录行仍可管理（恢复/删除）')
const deadRow = pop !== null ? pop.querySelector('.bwt-row[data-dead]') : null
check(deadRow !== null && pop.textContent.includes('会话已删'), '死行置灰并标注「会话已删」')

/* 5. Restore a live-archived row → restore RPC + refresh + toast. */
const rowOf = (label) => [...(pop?.querySelectorAll('.bwt-row') ?? [])].find((row) => row.textContent.includes(label))
const restoreBtn = [...(pop?.querySelectorAll('button') ?? [])].find((b) => b.getAttribute('aria-label') === '恢复' && rowOf('还活着的归档会话')?.contains(b))
if (restoreBtn !== undefined) {
  rpcLog.length = 0
  await new Promise((r) => { click(restoreBtn); setTimeout(r, 20) })
  check(rpcLog.some(([ch, m, p]) => ch === '/better-webui' && m === 'restore' && p.sessionId === 'session-live'), '活归档行「恢复」发出 restore RPC')
  check(rpcLog.some((entry) => entry[0] === 'refresh'), '恢复后刷新会话列表')
  check(document.body.textContent.includes('已恢复'), '恢复 toast 出现')
} else {
  check(false, '活归档行有恢复按钮')
}

/* 6. Two-step delete on the legacy record row. */
const destroyBtn = [...(pop?.querySelectorAll('button') ?? [])].find((b) => b.getAttribute('aria-label') === '彻底删除' && rowOf('搬走的会话')?.contains(b))
if (destroyBtn !== undefined) {
  rpcLog.length = 0
  await new Promise((r) => { click(destroyBtn); setTimeout(r, 10) })
  check(!rpcLog.some(([ch, m]) => ch === '/better-webui' && m === 'destroy'), '第一次点击不发出 destroy（仅确认态）')
  const confirmDestroy = [...document.body.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '再次点击以彻底删除')
  check(confirmDestroy !== undefined, '删除两步确认态出现')
  if (confirmDestroy !== undefined) {
    await new Promise((r) => { click(confirmDestroy); setTimeout(r, 20) })
    check(rpcLog.some(([ch, m, p]) => ch === '/better-webui' && m === 'destroy' && p.sessionId === 'session-moved'), '确认后发出 destroy RPC')
    check(document.body.textContent.includes('已彻底删除'), '删除 toast 出现')
  }
} else {
  check(false, '遗留记录行有彻底删除按钮')
}

/* 7. Dead-record purge: control appears, two-step, RPC fires. */
const purgeBtn = [...(pop?.querySelectorAll('button') ?? [])].find((b) => b.textContent.includes('清除失效记录'))
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

/* 8. Empty archive set + no records → empty state, no purge control. */
rpcResponse = async () => ({ ok: true, value: { items: [] } })
await new Promise((resolve) => {
  root_.render(h(footerReg.component, {
    api: injected.api,
    t,
    wide: true,
    useSessions: (selector) => selector(listState),
    useWorkspaces: (selector) => selector({ ...workspaceState, archivedSessionIds: [] }),
  }))
  setTimeout(resolve, 20)
})
await new Promise((r) => { click(tool); setTimeout(r, 5) }) // close (still open from step 7)
await new Promise((r) => { click(tool); setTimeout(r, 20) }) // reopen; reload now sees the empty records
pop = document.body.querySelector('.bwt-pop')
check(pop !== null && pop.textContent.includes('没有归档会话'), '空态显示「没有归档会话」')
check(pop === null || ![...pop.querySelectorAll('button')].some((b) => b.textContent.includes('清除失效记录')), '无死行时不出现清除入口')

root_.unmount()
console.log(failures.length === 0 ? '\n全部通过 ✓' : `\n${failures.length} 项失败`)
process.exit(failures.length === 0 ? 0 : 1)
