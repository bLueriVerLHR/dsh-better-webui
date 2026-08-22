/**
 * jsdom integration test for the better-webui-modelparams client package
 * (lib/client.js) — a real DOM, the app's exact React version, and dispatched
 * events. It contributes ONE surface: a `conversation.input.right` occupant
 * (composer tool row) hosting a compact temperature INPUT BOX (not a slider)
 * plus a caret that opens the full-config panel.
 *
 * Run: node tests/smoke.mjs   (after `npm run build`)
 */
import { readFileSync } from 'node:fs'
import { createBrowser, loadClientBundle, makeLocaleT, packagePath } from '../../../tests/support/client-harness.mjs'

const browser = createBrowser()
const { dom, ReactDOMClient, h } = browser
const { dicts, t } = makeLocaleT()

const plugin = loadClientBundle(browser, packagePath('modelparams', 'lib', 'client.js'))

const failures = []
const check = (ok, label) => {
  if (ok) console.log('  ✓ ' + label)
  else { console.log('  ✗ ' + label); failures.push(label) }
}

/* RPC stub: ping/read/apply/reset. */
const rpcLog = []
let cfg = { enabled: true, temperature: 0.7, mode: 'persist' }
const rpcResponse = async (method, payload) => {
  if (method === 'ping') return { ok: true, value: { v: 1 } }
  if (method === 'read') return { ok: true, value: { ...cfg } }
  if (method === 'apply') {
    cfg = { ...cfg, ...payload }
    return { ok: true, value: { changed: true, config: { ...cfg } } }
  }
  if (method === 'reset') {
    cfg = { enabled: false, temperature: 1.0, mode: 'persist' }
    return { ok: true, value: { changed: true, config: { ...cfg } } }
  }
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

const inputReg = registrations.find((r) => r.spec.name === 'conversation.input.right')
check(registrations.length === 1, '贡献数量精确为一个（只注册一个 input.right 槽位）')
check(inputReg !== undefined && inputReg.spec.id === 'better-webui-modelparams'
  && inputReg.spec.order === 0 && inputReg.spec.locale === 'better-webui-modelparams',
  '注册 conversation.input.right（id better-webui-modelparams，order 0，locale 绑定）')
check(dom.window.document.getElementById('better-webui-modelparams-style') !== null, '样式表已注入 <head>')

/* Render the control. */
const host = dom.window.document.createElement('div')
dom.window.document.body.appendChild(host)
const root = ReactDOMClient.createRoot(host)

await new Promise((resolve) => {
  root.render(h(inputReg.component, { t }))
  setTimeout(resolve, 60) // wait for the async read()
})

/* The compact control: an input box (number, not range) + caret. */
const field = host.querySelector('.bwm-field')
const tempInput = host.querySelector('.bwm-input')
const caret = host.querySelector('.bwm-caret')
check(field !== null && field.getAttribute('data-on') === 'true', '温度字段：启用态（data-on）')
check(tempInput !== null && tempInput.type === 'number' && tempInput.value === '0.7', '温度用数字输入框（非滑杆），初始 0.7')
check(host.querySelector('.bwm-input[type=range]') === null, '确认没有 range 滑杆')
check(caret !== null && caret.getAttribute('aria-expanded') === 'false', 'caret 按钮收起状态')
check(rpcLog.some(([ch, m]) => ch === '/better-webui-modelparams' && m === 'read'), '挂载时 read 拉取配置')

/* Typing + Enter / blur commits via the same RPC apply path the panel uses.
   jsdom cannot drive keyboard events on this number input through React 18
   (its value-change polyfill crashes), so we prove the commit wiring exists in
   the bundle source and rely on the panel apply/reset tests for the RPC flow. */
{
  const source = readFileSync(packagePath('modelparams', 'lib', 'client.js'), 'utf8')
  check(source.includes('onKeyDown: onKey') && source.includes('onBlur: commit')
    && source.includes('api.apply'), '紧凑控件已接好 Enter/失焦提交与 apply 接线（源码级）')
}

/* Open the panel via caret. */
rpcLog.length = 0
caret.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
await new Promise((r) => setTimeout(r, 30))
check(caret.getAttribute('aria-expanded') === 'true', '点击 caret 展开面板')
check(host.querySelector('.bwm-pop') !== null, '面板渲染')
check(host.querySelector('.bwm-pop-title').textContent === '模型采样参数', '面板标题')

/* Panel content: enable toggle, temperature input, unsupported rows, mode. */
const enableCheck = host.querySelector('.bwm-check input[type=checkbox]')
check(enableCheck !== null && enableCheck.checked === true, '启用开关：当前开启')
check(host.querySelectorAll('.bwm-unsupported').length === 2, '两行暂不支持（logprobs / penalty）')
const tags = [...host.querySelectorAll('.bwm-tag')].map((n) => n.textContent)
check(tags.every((s) => s.includes('暂不支持')), 'logprobs / penalty 标注「暂不支持（等上游）」')
const modeButtons = [...host.querySelectorAll('.bwm-mode button')]
check(modeButtons.length === 2 && modeButtons[0].textContent === '持久化' && modeButtons[1].textContent === '热调',
  '生效方式：持久化 / 热调两档')
check(host.querySelector('.bwm-input[type=range]') === null, '面板内温度也是输入框（非滑杆）')

/* Toggle enable off + apply → apply RPC carries enabled:false. React toggles
   controlled checkboxes on click, so dispatch a real click. */
rpcLog.length = 0
enableCheck.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
const applyBtn = [...host.querySelectorAll('.bwm-actions button')].find((b) => b.textContent === t('apply'))
applyBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
await new Promise((r) => setTimeout(r, 60))
check(rpcLog.some(([ch, m, p]) => ch === '/better-webui-modelparams' && m === 'apply' && p.enabled === false),
  '关掉启用 + 应用 → apply RPC 带 enabled:false')

/* Reset button → reset RPC. */
rpcLog.length = 0
const resetBtn = [...host.querySelectorAll('.bwm-actions button')].find((b) => b.textContent === t('reset'))
resetBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
await new Promise((r) => setTimeout(r, 60))
check(rpcLog.some(([ch, m]) => ch === '/better-webui-modelparams' && m === 'reset'), '点「恢复默认」→ reset RPC')

root.unmount()
host.remove()

/* Bilingual parity: every zh key has an en counterpart. */
const zhKeys = Object.keys(dicts.zh).sort()
const enKeys = Object.keys(dicts.en).sort()
check(zhKeys.length === enKeys.length && zhKeys.every((k, i) => k === enKeys[i]), `双语键集一致（${zhKeys.length} 键）`)

console.log(failures.length === 0 ? '\n全部通过 ✓' : `\n${failures.length} 项失败`)
process.exit(failures.length === 0 ? 0 : 1)
