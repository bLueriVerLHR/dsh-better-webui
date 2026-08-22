/**
 * jsdom integration test for the better-webui-settings client package
 * (lib/client.js) — a real DOM, the app's exact React version, and dispatched
 * events. The package contributes EXACTLY ONE surface: a settings.section page
 * (id `better-webui-settings`) hosting the retry-policy card (maxRetries +
 * backoff, applied via the `/better-webui-settings` RPC channel) and the
 * session-chime card (switch + volume, persisted to localStorage — the same
 * keys the chime dock reads).
 *
 * Run: node packages/settings/tests/smoke.mjs   (after `npm run build`)
 */
import { createBrowser, loadClientBundle, makeLocaleT, packagePath } from '../../../tests/support/client-harness.mjs'

const browser = createBrowser()
const { dom, ReactDOMClient, h } = browser
const { dicts, t } = makeLocaleT()

/* 1. Load the built settings bundle through the module-loader envelope. */
const plugin = loadClientBundle(browser, packagePath('settings', 'lib', 'client.js'))

const failures = []
const check = (ok, label) => {
  if (ok) console.log('  ✓ ' + label)
  else { console.log('  ✗ ' + label); failures.push(label) }
}

/* 2. apply() against a mock client ctx (settings needs slots + locale +
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

const sectionReg = registrations.find((r) => r.spec.name === 'settings.section')
check(sectionReg !== undefined && sectionReg.spec.id === 'better-webui-settings'
  && sectionReg.spec.order === 25 && typeof sectionReg.spec.label === 'function',
  'apply() 注册 settings.section（id better-webui-settings，order 25，label 函数）')
check(registrations.length === 1, '贡献数量精确为一个（settings 包只注册一个设置页）')
check(dom.window.document.getElementById('better-webui-settings-style') !== null, '样式表已注入 <head>')
check(sectionReg.spec.label() === 'Better WebUI', '导航标签为 Better WebUI')

/* 3. Render the settings page with the injected api. */
const api = sectionReg.spec.inject().api
check(typeof api.ping === 'function' && typeof api.read === 'function' && typeof api.apply === 'function',
  'inject 面提供 ping/read/apply API')

const host = dom.window.document.createElement('div')
dom.window.document.body.appendChild(host)
const root = ReactDOMClient.createRoot(host)
dom.window.localStorage.clear()

await new Promise((resolve) => {
  root.render(h(sectionReg.component, { api, t }))
  setTimeout(resolve, 60) // wait for the async read() to populate
})

/* 4. Retry card: four number fields initialized from the host read result. */
const inputs = host.querySelectorAll('.bwts-input')
check(inputs.length === 4, '重试卡有 4 个数字输入框')
const byLabel = (label) => [...host.querySelectorAll('.bwts-field')].find((f) => f.querySelector('.bwts-label').textContent === label)
const maxRetriesInput = byLabel(t('retry.maxRetries')).querySelector('input')
const jitterInput = byLabel(t('retry.jitterRatio')).querySelector('input')
check(maxRetriesInput !== null && maxRetriesInput.value === '5', '重试次数初始化为 5')
check(jitterInput !== null && jitterInput.value === '0.1', '抖动比例初始化为 0.1')

const providers = host.querySelectorAll('.bwts-prow')
check(providers.length === 3, 'provider 状态列出 3 行')
check(host.querySelector('.bwts-pstatus[data-custom]') !== null, '手写 provider 标记 data-custom')

/* 5. Apply: click → apply RPC → read refresh. */
rpcLog.length = 0
const applyBtn = [...host.querySelectorAll('button')].find((b) => b.textContent === t('retry.apply'))
await new Promise((resolve) => { applyBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); setTimeout(resolve, 60) })
check(rpcLog.some(([ch, m, p]) => ch === '/better-webui-settings' && m === 'apply' && p.policy.maxRetries === 5),
  '点「应用」发出 apply RPC（携带当前策略）')
check(rpcLog.some(([ch, m]) => ch === '/better-webui-settings' && m === 'read'), '应用后重新 read 刷新')

/* 6. Restore defaults button resets the fields to DSH defaults. */
const restoreBtn = [...host.querySelectorAll('button')].find((b) => b.textContent === t('retry.restore'))
await new Promise((resolve) => { restoreBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); setTimeout(resolve, 20) })
check(maxRetriesInput.value === '2', '「恢复默认」把重试次数重置为 2')

/* 7. Chime card: switch + slider persisted to the same localStorage keys the
      chime dock reads. */
const switchEl = host.querySelector('.bwts-switch')
const sliderEl = host.querySelector('.bwts-volume input[type=range]')
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
check(switchEl !== null && switchEl.getAttribute('aria-checked') === 'true', '提示音：默认开关开启')
check(sliderEl !== null && sliderEl.value === '80' && sliderEl.disabled === false, '提示音：默认音量 80 且滑块可用')

await new Promise((r) => { click(switchEl); setTimeout(r, 20) })
check(dom.window.localStorage.getItem('better-webui:notify:enabled') === '0'
  && switchEl.getAttribute('aria-checked') === 'false', '提示音：关闭开关写入 localStorage')
check(sliderEl.disabled === true, '提示音：关闭后滑块禁用')

await new Promise((r) => { click(switchEl); setTimeout(r, 20) })
check(dom.window.localStorage.getItem('better-webui:notify:enabled') === '1', '提示音：重新开启')

sliderEl.value = '45'
sliderEl.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
await new Promise((r) => setTimeout(r, 20))
check(dom.window.localStorage.getItem('better-webui:notify:volume') === '45', '提示音：音量滑块拖动写入 localStorage')

root.unmount()
host.remove()

console.log(failures.length === 0 ? '\n全部通过 ✓' : `\n${failures.length} 项失败`)
process.exit(failures.length === 0 ? 0 : 1)
