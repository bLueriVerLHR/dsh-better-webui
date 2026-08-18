/**
 * jsdom integration test for the better-webui client bundle — a real DOM, the
 * app's exact React version, real portals, and dispatched click events.
 *
 * This is the test that would have caught the missing Undo: it walks the whole
 * user flow (arm → confirm trash → toast with 撤销 → click undo → restore RPC
 * called) against the built lib/client.js, not the source. It also covers the
 * v0.4 surfaces: the user-prompt retract action (fork bridge), the archive
 * popover rows (restore / trash / dead rows / purge), and the displayTitle fix.
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
  sessions: {
    refresh: async () => {},
    open: (id) => rpcLog.push(['open', id]),
    fork: async (opts) => { rpcLog.push(['fork', opts]); return 'session-child' },
  },
  workspaces: { startSession: () => rpcLog.push(['startSession']) },
}
plugin.apply(mockCtx)

const headerReg = registrations.find((r) => r.spec.name === 'conversation.session.header.actions')
const footerReg = registrations.find((r) => r.spec.name === 'sidebar.footer.action')
const retractReg = registrations.find((r) => r.spec.name === 'conversation.chat.user-actions')
check(registrations.length === 3 && headerReg !== undefined && footerReg !== undefined && retractReg !== undefined,
  'apply() 注册三个插槽贡献（header/footer/user-actions）')
check(document.getElementById('better-webui-style') !== null, '样式表已注入 <head>')

/* The api object the components receive (from the register inject factory). */
const injected = headerReg.spec.inject()
check(typeof injected.api.trash === 'function' && typeof injected.api.restore === 'function', 'inject 面提供 trash/restore API')

/* Locale seat over the registered dictionary. */
const dicts = {}
const t = (key, params) => {
  let text = dicts.zh[key] ?? key
  if (params !== undefined) for (const [name, value] of Object.entries(params)) text = text.replace(`{${name}}`, String(value))
  return text
}
plugin.apply.call(null, { ...mockCtx, locale: { register: (ns, d) => { Object.assign(dicts, d); return () => {} } } })
check(dicts.zh !== undefined && dicts.zh['toast.undo'] === '撤销', 'zh 词典含撤销文案')

/* 3. Mount header + footer together: the footer hosts the toast bus listener. */
const listState = {
  byId: {
    'session-x': { sessionId: 'session-x', title: '冒烟会话', displayTitle: '冒烟会话', blank: false, updatedAt: Date.now() },
    'session-arch': { sessionId: 'session-arch', displayTitle: '归档的会话', blank: false, updatedAt: Date.now() },
  },
}
const workspaceState = {
  archivedSessionIds: ['session-arch'],
  items: [{ title: 'W', cwd: '/w', sessionIds: ['session-arch'] }],
}
const sharedProps = {
  api: injected.api,
  t,
  useSessions: (selector) => selector(listState),
  useWorkspaces: (selector) => selector(workspaceState),
}
const host = document.getElementById('host')
const root_ = ReactDOMClient.createRoot(host)
const renderTree = () => new Promise((resolve) => {
  React.version // keep import used
  root_.render(h('div', null,
    h(headerReg.component, { ...sharedProps, sessionId: 'session-x' }),
    h(footerReg.component, { ...sharedProps, wide: true }),
  ))
  setTimeout(resolve, 20)
})
await renderTree()

const $ = (sel) => host.querySelector(sel)
const $$ = (sel) => [...host.querySelectorAll(sel)]
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))

/* header trash button present */
let trashButton = $$('button').find((b) => b.getAttribute('aria-label') === '移入回收站')
check(trashButton !== undefined, '会话头部渲染垃圾桶按钮')

/* footer tools present and aligned */
check($$('.bwt-tool').length === 2, '侧栏底部渲染两个工具（回收站+归档）')
check($('.bwt-tools').getAttribute('data-wide') === 'true', '工具行与 Settings 行对齐（data-wide）')

/* 4. Arm → confirm. */
await new Promise((r) => { click(trashButton); setTimeout(r, 0) })
const confirmButton = $$('button').find((b) => b.getAttribute('aria-label') === '确认移入回收站')
check(confirmButton !== undefined, '第一次点击后出现确认态（✓/✗）')
rpcLog.length = 0
await new Promise((r) => { click(confirmButton); setTimeout(r, 10) })
await new Promise((r) => setTimeout(r, 50))
check(rpcLog.some(([ch, m]) => ch === '/better-webui' && m === 'trash'), '确认后发出 trash RPC')
check(rpcLog.some((entry) => entry[0] === 'startSession'), '删除后切换到新会话')

/* 5. THE UNDO TOAST — rendered into body via portal. */
await new Promise((r) => setTimeout(r, 10))
const toast = document.body.querySelector('.bwt-toast')
check(toast !== null, '删除后出现 toast（portal 渲染到 body）')
const undoButton = [...document.body.querySelectorAll('button')].find((b) => b.textContent === '撤销')
check(undoButton !== undefined, 'toast 内有「撤销」按钮')

/* 6. Click undo → restore RPC + refresh. */
rpcLog.length = 0
await new Promise((r) => { click(undoButton); setTimeout(r, 10) })
await new Promise((r) => setTimeout(r, 50))
check(rpcLog.some(([ch, m]) => ch === '/better-webui' && m === 'restore'), '点击撤销后发出 restore RPC')
check(rpcLog.some(([ch, m]) => ch === '/better-webui' && m === 'listTrash')
  || rpcLog.some((entry) => entry[0] === 'refresh'), '撤销后刷新列表/回收站')
check(document.body.textContent.includes('已恢复'), 'toast 切换到「已恢复」')

/* 7. Trash popover: open, restore a row. */
rpcResponse = async () => ({ ok: true, value: { items: [{ sessionId: 'session-y', title: '另一个', cwd: '/w', trashedAt: Date.now() }] } })
const trashTool = $$('.bwt-tool').find((b) => b.getAttribute('aria-label') === '回收站')
await new Promise((r) => { click(trashTool); setTimeout(r, 10) })
await new Promise((r) => setTimeout(r, 10))
let pop = document.body.querySelector('.bwt-pop')
check(pop !== null && pop.textContent.includes('另一个'), '回收站弹层列出条目')
const restoreRow = [...pop.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '恢复')
rpcLog.length = 0
await new Promise((r) => { click(restoreRow); setTimeout(r, 10) })
check(rpcLog.some(([ch, m]) => ch === '/better-webui' && m === 'restore'), '弹层内恢复按钮发出 restore RPC')

/* 8. Destroy two-step in the popover. */
await new Promise((r) => { click(trashTool); setTimeout(r, 5) })
await new Promise((r) => { click(trashTool); setTimeout(r, 5) }) // reopen
pop = document.body.querySelector('.bwt-pop')
const destroyBtn = pop !== null ? [...pop.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '彻底删除') : undefined
check(destroyBtn !== undefined, '弹层内有彻底删除按钮')
if (destroyBtn !== undefined) {
  rpcLog.length = 0
  await new Promise((r) => { click(destroyBtn); setTimeout(r, 5) })
  const confirmDestroy = [...document.body.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '再次点击以彻底删除')
  check(confirmDestroy !== undefined, '第一次点击后变为确认态')
  if (confirmDestroy !== undefined) {
    await new Promise((r) => { click(confirmDestroy); setTimeout(r, 10) })
    check(rpcLog.some(([ch, m]) => ch === '/better-webui' && m === 'destroy'), '确认后发出 destroy RPC')
  }
}

/* 9. Archive popover: info rows, dead rows greyed, restore/trash actions. */
const archiveTool = $$('.bwt-tool').find((b) => b.getAttribute('aria-label') === '归档会话')
await new Promise((r) => { click(archiveTool); setTimeout(r, 10) })
pop = document.body.querySelector('.bwt-pop')
check(pop !== null && pop.textContent.includes('归档会话'), '归档弹层打开')
check(pop !== null && pop.textContent.includes('归档的会话'), '归档行显示 displayTitle（修正无标题问题）')
let archiveRestoreBtn = pop !== null ? [...pop.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '恢复') : undefined
rpcLog.length = 0
if (archiveRestoreBtn !== undefined) {
  await new Promise((r) => { click(archiveRestoreBtn); setTimeout(r, 10) })
}
check(rpcLog.some(([ch, m]) => ch === '/better-webui' && m === 'restoreArchived'), '归档行「恢复」发出 restoreArchived RPC（回侧栏）')

/* archive-row trash action */
const archiveTrashBtn = pop !== null ? [...pop.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '移入回收站') : undefined
if (archiveTrashBtn !== undefined) {
  rpcLog.length = 0
  await new Promise((r) => { click(archiveTrashBtn); setTimeout(r, 10) })
  check(rpcLog.some(([ch, m]) => ch === '/better-webui' && m === 'trash'), '归档行「移入回收站」发出 trash RPC')
} else {
  check(false, '归档行「移入回收站」按钮存在')
}

/* 10. Retract action on a user prompt row (fork bridge). */
const sessionSnapshot = {
  turnEnds: new Map([[1, 41], [2, 97]]),
  running: false,
  removed: false,
}
const inputActions = { setDraft: (text) => rpcLog.push(['setDraft', text]) }
const retractHost = document.createElement('div')
document.body.append(retractHost)
const retractRoot = ReactDOMClient.createRoot(retractHost)
await new Promise((resolve) => {
  retractRoot.render(h(retractReg.component, {
    api: injected.api,
    t,
    sessionId: 'session-x',
    node: { kind: 'user', seq: 50, time: Date.now(), content: [{ type: 'text', text: '撤回我' }] },
    turn: 2,
    useSession: (selector) => selector(sessionSnapshot),
    inputActions,
  }))
  setTimeout(resolve, 20)
})
const retractButton = [...retractHost.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '撤回并重写')
check(retractButton !== undefined, '用户消息行渲染撤回按钮')
if (retractButton !== undefined) {
  rpcLog.length = 0
  await new Promise((r) => { click(retractButton); setTimeout(r, 5) })
  const retractConfirm = [...retractHost.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '确认撤回：保留此前的对话，重写这条提示词')
  check(retractConfirm !== undefined, '撤回两步确认态出现')
  if (retractConfirm !== undefined) {
    await new Promise((r) => { click(retractConfirm); setTimeout(r, 10) })
    await new Promise((r) => setTimeout(r, 30))
    const forkCall = rpcLog.find((entry) => entry[0] === 'fork')
    check(forkCall !== undefined && forkCall[1].atSeq === 41, '撤回发出 fork RPC，atSeq=上一回合的 turn/end seq（41）')
    check(rpcLog.some((entry) => entry[0] === 'setDraft' && entry[1] === '撤回我'), 'fork 后输入框预填原文')
    check(rpcLog.some((entry) => entry[0] === 'open' && entry[1] === 'session-child'), 'fork 后切到子会话')
    check(rpcLog.some(([ch, m, p]) => ch === '/better-webui' && m === 'archive' && p !== undefined && p.sessionId === 'session-x'), '撤回后源会话自动归档（archive RPC）')
    check(document.body.textContent.includes('已撤回'), '撤回成功 toast')
  }
}
retractRoot.unmount()

/* 11. First prompt: retract disabled. */
const firstHost = document.createElement('div')
document.body.append(firstHost)
const firstRoot = ReactDOMClient.createRoot(firstHost)
await new Promise((resolve) => {
  firstRoot.render(h(retractReg.component, {
    api: injected.api,
    t,
    sessionId: 'session-x',
    node: { kind: 'user', seq: 10, time: Date.now(), content: [{ type: 'text', text: '第一条' }] },
    turn: 1,
    useSession: (selector) => selector(sessionSnapshot),
    inputActions,
  }))
  setTimeout(resolve, 20)
})
const firstButton = [...firstHost.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '撤回并重写')
check(firstButton !== undefined && firstButton.disabled === true, '首条消息撤回按钮禁用（atSeq 无可用前界）')
firstRoot.unmount()

/* 12. Dead archive rows greyed + purge control appears when dead ids exist. */
const deadState = { ...workspaceState, archivedSessionIds: ['session-arch', 'session-gone'] }
const deadListState = { byId: { ...listState.byId } } // session-gone has no summary
await new Promise((resolve) => {
  root_.render(h('div', null,
    h(headerReg.component, { ...sharedProps, sessionId: 'session-x', useSessions: (s) => s(deadListState), useWorkspaces: (s) => s(deadState) }),
    h(footerReg.component, { ...sharedProps, useSessions: (s) => s(deadListState), useWorkspaces: (s) => s(deadState) }),
  ))
  setTimeout(resolve, 20)
})
/* The re-render kept the footer mounted, so the archive popover is still open;
   close then reopen to rebuild its rows against the dead-state hooks. */
await new Promise((r) => { click(archiveTool); setTimeout(r, 5) })
await new Promise((r) => { click(archiveTool); setTimeout(r, 10) })
pop = document.body.querySelector('.bwt-pop')
const deadRow = pop !== null ? pop.querySelector('.bwt-row[data-dead]') : null
check(deadRow !== null && pop.textContent.includes('会话已删'), '死归档行置灰并标注「会话已删」')
const purgeBtn = pop !== null ? [...pop.querySelectorAll('button')].find((b) => b.textContent.includes('清除失效记录')) : undefined
check(purgeBtn !== undefined, '存在死行时出现「清除失效记录」入口')
if (purgeBtn !== undefined) {
  rpcLog.length = 0
  await new Promise((r) => { click(purgeBtn); setTimeout(r, 5) })
  const purgeConfirm = [...document.body.querySelectorAll('button')].find((b) => b.textContent.includes('再次点击清除'))
  check(purgeConfirm !== undefined, '清除记录两步确认态')
  if (purgeConfirm !== undefined) {
    rpcResponse = async (method) => method === 'purgeArchived'
      ? { ok: true, value: { purged: ['session-gone'], remaining: ['session-arch'] } }
      : { ok: true, value: { items: [] } }
    await new Promise((r) => { click(purgeConfirm); setTimeout(r, 15) })
    check(rpcLog.some(([ch, m]) => ch === '/better-webui' && m === 'purgeArchived'), '确认后发出 purgeArchived RPC')
  }
}

root_.unmount()
console.log(failures.length === 0 ? '\n全部通过 ✓' : `\n${failures.length} 项失败`)
process.exit(failures.length === 0 ? 0 : 1)
