/**
 * jsdom integration test for the better-webui-modelparams client package
 * (lib/client.js) — a real DOM, the app's exact React version, and dispatched
 * events. It contributes ONE surface: a `conversation.input.right` occupant
 * (composer tool row) hosting a single 「超参配置」button that opens the
 * config panel. All editing happens inside the panel.
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
let cfg = { temperature: undefined, mode: 'persist' }
const rpcResponse = async (method, payload) => {
  if (method === 'ping') return { ok: true, value: { v: 1 } }
  if (method === 'read') return { ok: true, value: { ...cfg } }
  if (method === 'apply') {
    cfg = {
      temperature: payload.temperature === null || payload.temperature === undefined ? undefined : Number(payload.temperature),
      mode: payload.mode === 'hot' ? 'hot' : 'persist',
    }
    return { ok: true, value: { changed: true, config: { ...cfg } } }
  }
  if (method === 'reset') {
    cfg = { temperature: undefined, mode: 'persist' }
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

/* The compact control is a single button — no input box in the tool row. */
const btn = host.querySelector('.bwm-btn')
check(btn !== null && btn.textContent === '超参配置', '工具行是「超参配置」按钮')
check(host.querySelector('.bwm-input') === null, '工具行没有输入框（编辑都在面板里）')
check(btn.getAttribute('aria-expanded') === 'false', '按钮收起状态')
check(rpcLog.some(([ch, m]) => ch === '/better-webui-modelparams' && m === 'read'), '挂载时 read 拉取配置')

/* Click the button → panel opens. */
rpcLog.length = 0
btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
await new Promise((r) => setTimeout(r, 30))
check(btn.getAttribute('aria-expanded') === 'true', '点击按钮展开面板')
check(host.querySelector('.bwm-pop') !== null, '面板渲染')
check(host.querySelector('.bwm-pop-title').textContent === '超参配置', '面板标题')

/* Panel: temperature input is EMPTY (default) with a placeholder; no enable
   checkbox; unsupported rows; mode toggle. */
const tempInput = host.querySelector('.bwm-input')
check(tempInput !== null && tempInput.type === 'number' && tempInput.value === ''
  && tempInput.placeholder.includes('默认'), '温度输入框：默认空 + 虚字提示默认')
check(host.querySelector('.bwm-check') === null, '无「启用」复选框（留空即默认）')
check(host.querySelectorAll('.bwm-unsupported').length === 2, '两行暂不支持（logprobs / penalty）')
const tags = [...host.querySelectorAll('.bwm-tag')].map((n) => n.textContent)
check(tags.every((s) => s.includes('暂不支持')), 'logprobs / penalty 标注「暂不支持」')
const modeButtons = [...host.querySelectorAll('.bwm-mode button')]
check(modeButtons.length === 2 && modeButtons[0].textContent === '持久化' && modeButtons[1].textContent === '热调',
  '生效方式：持久化 / 热调两档')

/* Empty input + 应用 → apply RPC carries temperature:null (clear/back to
   default). This is the reliable DOM-driven path (no number-input event).
   The "fill = override" path is proven by the host test (apply 0.7 writes it)
   and the wiring below. */
rpcLog.length = 0
const applyBtn = [...host.querySelectorAll('.bwm-actions button')].find((b) => b.textContent === t('apply'))
applyBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
await new Promise((r) => setTimeout(r, 60))
check(rpcLog.some(([ch, m, p]) => ch === '/better-webui-modelparams' && m === 'apply' && p.temperature === null),
  '空输入 + 应用 → apply RPC 带 temperature:null（清除/回默认）')

/* Fill→override wiring is present in the bundle (jsdom cannot drive number-input
   events through React 18's value polyfill): onChange updates state via setTemp,
   apply reads cfg.temperature. */
{
  const source = readFileSync(packagePath('modelparams', 'lib', 'client.js'), 'utf8')
  check(source.includes('onChange: setTemp') && source.includes('var raw = cfg.temperature')
    && source.includes("raw.trim() === ''") && source.includes('api.apply({ temperature: temperature'),
    '填写→覆盖接线存在（onChange→setTemp→apply 携带温度，源码级）')
}

/* Reset → reset RPC clears the stored override (input goes back to empty). */
rpcLog.length = 0
const resetBtn = [...host.querySelectorAll('.bwm-actions button')].find((b) => b.textContent === t('reset'))
resetBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
await new Promise((r) => setTimeout(r, 60))
check(rpcLog.some(([ch, m]) => ch === '/better-webui-modelparams' && m === 'reset'), '点「恢复默认」→ reset RPC（清空配置）')
check(tempInput.value === '', '恢复默认后温度输入框回到空（默认）')

root.unmount()
host.remove()

/* Bilingual parity: every zh key has an en counterpart. */
const zhKeys = Object.keys(dicts.zh).sort()
const enKeys = Object.keys(dicts.en).sort()
check(zhKeys.length === enKeys.length && zhKeys.every((k, i) => k === enKeys[i]), `双语键集一致（${zhKeys.length} 键）`)

console.log(failures.length === 0 ? '\n全部通过 ✓' : `\n${failures.length} 项失败`)
process.exit(failures.length === 0 ? 0 : 1)
