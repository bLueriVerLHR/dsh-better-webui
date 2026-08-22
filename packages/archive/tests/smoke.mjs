/**
 * jsdom integration test for the archive client package (lib/client.js) — a
 * real DOM, the app's exact React version, real portals, and dispatched click
 * events. Walks the archive settings page's whole flow: the page lists
 * live/legacy/dead rows, restore RPC, two-step permanent delete, dead-record
 * purge, empty state, and stale-host hint. The archive package contributes
 * EXACTLY ONE surface — a settings section page in the sidebar nav.
 *
 * Run: node packages/archive/tests/smoke.mjs   (after `npm run build`)
 */
import { createBrowser, loadClientBundle, makeLocaleT, packagePath } from '../../../tests/support/client-harness.mjs'

const browser = createBrowser()
const { dom, ReactDOMClient, h } = browser
const { t, dicts } = makeLocaleT()

/* 1. Load the built archive bundle through the module-loader envelope. */
const plugin = loadClientBundle(browser, packagePath('archive', 'lib', 'client.js'))

const failures = []
const check = (ok, label) => {
  if (ok) console.log('  ✓ ' + label)
  else { console.log('  ✗ ' + label); failures.push(label) }
}

/* 2. apply() against a mock client ctx with a scriptable RPC. */
const rpcLog = []
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
check(itemReg !== undefined, 'apply() 注册设置页贡献（settings.section）')
check(registrations.length === 1, '贡献数量精确为一个（归档包不再注册提醒/通用设置行）')
check(registrations.every((r) => r.spec.name !== 'sidebar.footer.action'), '不再注册侧栏图标（与动态插件面板冲突，已移除）')
check(dom.window.document.getElementById('better-webui-style') !== null, '样式表已注入 <head>')

const injected = itemReg.spec.inject()
check(typeof injected.api.restore === 'function' && typeof injected.api.destroy === 'function'
  && typeof injected.api.purge === 'function' && typeof injected.api.listArchive === 'function',
  'inject 面提供 restore/destroy/purge/listArchive API')
check(itemReg.spec.id === 'better-webui-archive', '设置页注册 id 为 better-webui-archive')

/* Locale seat over the registered dictionary. */
plugin.apply.call(null, { ...mockCtx, locale: { register: (ns, d) => { Object.assign(dicts, d); return () => {} } } })
check(dicts.zh !== undefined && dicts.zh['destroyConfirm'] === '再次点击以彻底删除', 'zh 词典含二次确认文案')

/* 3. Mount the page with a live-archived row, a dead id, and a live-but-data-gone
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

const host = dom.window.document.getElementById('host')
const root_ = ReactDOMClient.createRoot(host)
await new Promise((resolve) => {
  root_.render(h(itemReg.component, {
    api: injected.api,
    t,
    useSessions: (selector) => selector(listState),
    useWorkspaces: (selector) => selector(workspaceState),
  }))
  // The archive page reloads asynchronously (listArchive RPC); give React
  // time to commit the status rows.
  setTimeout(resolve, 80)
})

const $ = (sel) => host.querySelector(sel)
const $$ = (sel) => [...host.querySelectorAll(sel)]
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))

/* 4. The page lists rows immediately — no toggle. */
check($$('.bwt-page').length === 1, '只渲染一个设置页（归档）')
check($('.bwt-title')?.textContent === '归档会话', '页面标题为「归档会话」')
check($$('.bwt-list .bwt-row').length === 3, '页面直接列出 3 行归档（活 / 死 / 销毁的活）')
check($('.bwt-intro') !== null && !$('.bwt-intro').textContent.includes('入口'), '简介为一句平实文案（非「入口」清单式）')
check($('.bwt-footer') !== null && $('.bwt-count') === null, '无数量计数；存在死行时出现清除入口')

/* 5. Row states: live row, dead id, and destroyed-live row. */
const listEl = $('.bwt-list')
check(listEl !== null && listEl.textContent.includes('还活着的归档会话'), '活归档行显示 displayTitle')
const deadRow = listEl !== null ? listEl.querySelector('.bwt-row[data-dead]') : null
check(deadRow !== null && listEl.textContent.includes('会话已删'), '死行置灰并标注「会话已删」')
const destroyedLiveRow = listEl !== null ? [...listEl.querySelectorAll('.bwt-row[data-dead]')]
  .find((row) => row.textContent.includes('重启后清除')) : undefined
check(destroyedLiveRow !== undefined, '销毁的活会话以死行呈现（host listArchive dead+live）')
check(destroyedLiveRow === undefined || destroyedLiveRow.textContent.includes('会话已删'), '销毁的活会话行标注「会话已删」')
check(destroyedLiveRow === undefined || [...destroyedLiveRow.querySelectorAll('button')].length === 0,
  '销毁的活会话行无恢复/删除按钮')

/* 6. Restore a live-archived row → restore RPC + refresh + toast. */
const rowOf = (label) => [...(listEl?.querySelectorAll('.bwt-row') ?? [])].find((row) => row.textContent.includes(label))
const restoreBtn = [...(listEl?.querySelectorAll('button') ?? [])].find((b) => b.getAttribute('aria-label') === '恢复' && rowOf('还活着的归档会话')?.contains(b))
if (restoreBtn !== undefined) {
  rpcLog.length = 0
  await new Promise((r) => { click(restoreBtn); setTimeout(r, 20) })
  check(rpcLog.some(([ch, m, p]) => ch === '/better-webui' && m === 'restore' && p.sessionId === 'session-live'), '活归档行「恢复」发出 restore RPC')
  check(rpcLog.some((entry) => entry[0] === 'refresh'), '恢复后刷新会话列表')
  check(dom.window.document.body.textContent.includes('已恢复'), '恢复 toast 出现')
} else {
  check(false, '活归档行有恢复按钮')
}

/* 7. Two-step delete on the live-archived row. */
const destroyBtn = [...(listEl?.querySelectorAll('button') ?? [])].find((b) => b.getAttribute('aria-label') === '彻底删除' && rowOf('还活着的归档会话')?.contains(b))
if (destroyBtn !== undefined) {
  rpcLog.length = 0
  await new Promise((r) => { click(destroyBtn); setTimeout(r, 10) })
  check(!rpcLog.some(([ch, m]) => ch === '/better-webui' && m === 'destroy'), '第一次点击不发出 destroy（仅确认态）')
  const confirmDestroy = [...dom.window.document.body.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '再次点击以彻底删除')
  check(confirmDestroy !== undefined, '删除两步确认态出现')
  if (confirmDestroy !== undefined) {
    await new Promise((r) => { click(confirmDestroy); setTimeout(r, 20) })
    check(rpcLog.some(([ch, m, p]) => ch === '/better-webui' && m === 'destroy' && p.sessionId === 'session-live'), '确认后发出 destroy RPC')
    check(dom.window.document.body.textContent.includes('已彻底删除'), '删除 toast 出现')
  }
} else {
  check(false, '遗留记录行有彻底删除按钮')
}

/* 8. Dead-record purge: two-step, RPC fires. */
const purgeBtn = [...$$('.bwt-footer button')].find((b) => b.textContent.includes('清除失效记录'))
check(purgeBtn !== undefined, '存在死行时出现「清除失效记录」入口')
if (purgeBtn !== undefined) {
  rpcLog.length = 0
  await new Promise((r) => { click(purgeBtn); setTimeout(r, 10) })
  const purgeConfirm = [...dom.window.document.body.querySelectorAll('button')].find((b) => b.textContent.includes('再次点击清除'))
  check(purgeConfirm !== undefined, '清除记录两步确认态')
  if (purgeConfirm !== undefined) {
    await new Promise((r) => { click(purgeConfirm); setTimeout(r, 20) })
    check(rpcLog.some(([ch, m]) => ch === '/better-webui' && m === 'purge'), '确认后发出 purge RPC')
  }
}

/* 9. Empty archive set + no records → empty state, no purge control.
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

/* 10. Stale host (no ping / old wire): actions disabled with an explicit hint. */
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

root_.unmount()
console.log(failures.length === 0 ? '\n全部通过 ✓' : `\n${failures.length} 项失败`)
process.exit(failures.length === 0 ? 0 : 1)
