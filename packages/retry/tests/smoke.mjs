/**
 * jsdom integration test for the better-webui-retry client package
 * (lib/client.js) — a real DOM, the app's exact React version, and dispatched
 * events. The package contributes ONE settings.section page:
 *
 *   - `better-webui-retry` (order 26): the dedicated retry-policy page hosting
 *     the retry card (maxRetries + backoff, applied via the
 *     `/better-webui-retry` RPC channel). The page header carries the single
 *     title + description — the card below must not repeat them.
 *
 * Run: node packages/retry/tests/smoke.mjs   (after `npm run build`)
 */
import { createBrowser, loadClientBundle, makeLocaleT, packagePath } from '../../../tests/support/client-harness.mjs'

const browser = createBrowser()
const { dom, ReactDOMClient, h } = browser
const { dicts, t } = makeLocaleT()

/* 1. Load the built retry bundle through the module-loader envelope. */
const plugin = loadClientBundle(browser, packagePath('retry', 'lib', 'client.js'))

const failures = []
const check = (ok, label) => {
  if (ok) console.log('  ✓ ' + label)
  else { console.log('  ✗ ' + label); failures.push(label) }
}

/* 2. apply() against a mock client ctx (retry needs slots + locale +
      connection.rpc). The rpc stub answers ping/read/apply. */
const rpcLog = []
let rpcResponse = async (method, payload) => {
  if (method === 'ping') return { ok: true, value: { v: 1 } }
  if (method === 'read') return {
    ok: true,
    value: {
      policy: { maxRetries: 5, initialDelayMs: 500, maxDelayMs: 30000, jitterRatio: 0.1 },
      lastApplied: { maxRetries: 5, initialDelayMs: 500, maxDelayMs: 30000, jitterRatio: 0.1 },
      providers: [
        { route: 'alpha', status: 'set' },
        { route: 'beta', status: 'custom' },
        { route: 'gamma', status: 'unset' },
      ],
    },
  }
  if (method === 'apply') return { ok: true, value: { ok: true, updated: ['alpha', 'gamma'], skipped: ['beta'] } }
  return { ok: false, error: { message: 'unknown' } }
}
const registrations = []
const mockCtx = {
  effect(fn) { const dispose = fn() ?? (() => {}); return dispose },
  locale: {
    register: (ns, d) => { Object.assign(dicts, d); return () => {} },
    bind: (ns) => (key) => dicts.zh[key] ?? key,
  },
  slots: {
    inject: (slot, begin) => { begin() },
    register: (spec, component) => { registrations.push({ spec, component }) },
  },
  connection: { rpc: { call: async (channel, method, payload) => {
    rpcLog.push([channel, method, payload])
    return rpcResponse(method, payload)
  } } },
}
plugin.apply(mockCtx)

const sections = registrations.filter((r) => r.spec.name === 'settings.section')
check(sections.length === 1, '贡献数量为一个（retry 包注册一个设置页）')
check(dom.window.document.getElementById('better-webui-retry-style') !== null, '样式表已注入 <head>')

const retryReg = sections.find((r) => r.spec.id === 'better-webui-retry')
check(retryReg !== undefined && retryReg.spec.order === 26 && typeof retryReg.spec.label === 'function',
  '重试页：settings.section id better-webui-retry，order 26，label 函数')
check(retryReg.spec.label() === '重试策略', '重试页导航标签为「重试策略」')
check(typeof retryReg.spec.inject === 'function', '重试页声明 inject 面（提供 api）')

/* 3. Render the retry page with its injected api. */
const api = retryReg.spec.inject().api
check(typeof api.ping === 'function' && typeof api.read === 'function' && typeof api.apply === 'function',
  '重试页 inject 面提供 ping/read/apply API')

const host = dom.window.document.createElement('div')
dom.window.document.body.appendChild(host)
const root = ReactDOMClient.createRoot(host)
dom.window.localStorage.clear()

await new Promise((resolve) => {
  root.render(h(retryReg.component, { api, t }))
  setTimeout(resolve, 60) // wait for the async read() to populate
})

/* 4. Page header carries the single title + description; the card must not
      repeat them (the old bundled card re-rendered the page title/desc). */
check(host.querySelector('.bwts-title').textContent === t('retry.pageTitle'), '页面标题为「重试策略」')
check(host.querySelector('.bwts-intro').textContent === t('retry.pageDesc'), '页面描述只出现在页面大项下')
check(host.querySelectorAll('.bwts-carddesc').length === 0, '重试卡无重复描述（描述只在页面大项下）')
check(host.querySelectorAll('.bwts-cardhead').length === 1, '卡内只剩一个功能性小标题（Provider 状态）')

/* 5. Retry page: four number fields initialized from the host read result. */
const inputs = host.querySelectorAll('.bwts-input')
check(inputs.length === 4, '重试页有 4 个数字输入框')
const byLabel = (label) => [...host.querySelectorAll('.bwts-field')].find((f) => f.querySelector('.bwts-label').textContent === label)
const maxRetriesInput = byLabel(t('retry.maxRetries')).querySelector('input')
const jitterInput = byLabel(t('retry.jitterRatio')).querySelector('input')
check(maxRetriesInput !== null && maxRetriesInput.value === '5', '重试次数初始化为 5')
check(jitterInput !== null && jitterInput.value === '0.1', '抖动比例初始化为 0.1')

const providers = host.querySelectorAll('.bwts-prow')
check(providers.length === 3, 'provider 状态列出 3 行')
check(host.querySelector('.bwts-pstatus[data-custom]') !== null, '手写 provider 标记 data-custom')

/* 6. Apply: click → apply RPC → read refresh. */
rpcLog.length = 0
const applyBtn = [...host.querySelectorAll('button')].find((b) => b.textContent === t('retry.apply'))
await new Promise((resolve) => { applyBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); setTimeout(resolve, 60) })
check(rpcLog.some(([ch, m, p]) => ch === '/better-webui-retry' && m === 'apply' && p.policy.maxRetries === 5),
  '点「应用」发出 apply RPC（携带当前策略）')
check(rpcLog.some(([ch, m]) => ch === '/better-webui-retry' && m === 'read'), '应用后重新 read 刷新')

/* 7. Restore defaults button resets the fields to DSH defaults. */
const restoreBtn = [...host.querySelectorAll('button')].find((b) => b.textContent === t('retry.restore'))
await new Promise((resolve) => { restoreBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); setTimeout(resolve, 20) })
check(maxRetriesInput.value === '2', '「恢复默认」把重试次数重置为 2')

root.unmount()
host.remove()

console.log(failures.length === 0 ? '\n全部通过 ✓' : `\n${failures.length} 项失败`)
process.exit(failures.length === 0 ? 0 : 1)
