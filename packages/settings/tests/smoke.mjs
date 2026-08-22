/**
 * jsdom integration test for the better-webui-settings client package
 * (lib/client.js) — a real DOM, the app's exact React version, and dispatched
 * events. The package contributes ONE settings.section page:
 *
 *   - `better-webui-settings` (order 25): the better-webui preference hub page,
 *     hosting ONLY the session-chime card (switch + volume, persisted to
 *     localStorage — the same keys the chime dock reads). v0.21 起重试策略已
 *     拆去独立包 better-webui-retry（其 RPC/输入框/状态列表都在那边测试）。
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

/* 2. apply() against a mock client ctx (settings is pure client — no RPC). */
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
}
plugin.apply(mockCtx)

const sections = registrations.filter((r) => r.spec.name === 'settings.section')
check(sections.length === 1, '贡献数量为一个（settings 包只注册 better-webui 设置页）')
check(dom.window.document.getElementById('better-webui-settings-style') !== null, '样式表已注入 <head>')

const hubReg = sections.find((r) => r.spec.id === 'better-webui-settings')
check(hubReg !== undefined && hubReg.spec.order === 25 && typeof hubReg.spec.label === 'function',
  'better-webui 页：settings.section id better-webui-settings，order 25，label 函数')
check(hubReg.spec.label() === 'Better WebUI', 'better-webui 页导航标签为 Better WebUI')
check(hubReg.spec.inject === undefined, 'better-webui 页无需 inject（纯客户端）')

/* 3. Render the better-webui page: chime card only — two function rows
      (启动 switch + 调整音量 slider) with the description living once under
      the card head; persisted to the same localStorage keys the chime dock
      reads. No retry card here. */
const host = dom.window.document.createElement('div')
dom.window.document.body.appendChild(host)
const root = ReactDOMClient.createRoot(host)
dom.window.localStorage.clear()

await new Promise((resolve) => {
  root.render(h(hubReg.component, { t }))
  setTimeout(resolve, 20)
})

check(host.querySelector('.bwts-switch') !== null, 'better-webui 页保留提示音开关')
check(host.querySelector('.bwts-input') === null, 'better-webui 页不含重试输入框（已拆走）')
check(host.querySelector('.bwts-plist') === null, 'better-webui 页不含 provider 状态列表（已拆走）')

/* Chime card anatomy: two rows, each a single label (no per-row description
   duplication — the description sits once under the card head). */
const chimeRows = host.querySelectorAll('.bwts-chimerow')
const rowTitles = [...chimeRows].map((row) => row.querySelector('.bwts-chimerowtitle').textContent)
check(chimeRows.length === 2 && rowTitles[0] === '启动' && rowTitles[1] === '调整音量',
  '提示音卡两行：「启动」+「调整音量」')
check(host.querySelector('.bwts-chimerowdesc') === null, '提示音子行无重复描述（描述只在卡片大项下）')

const switchEl = host.querySelector('.bwts-switch')
const sliderEl = host.querySelector('.bwts-volume input[type=range]')
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
check(switchEl.getAttribute('aria-checked') === 'true', '提示音：默认开关开启')
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
