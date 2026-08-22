/**
 * jsdom integration test for the chime client package (lib/client.js) — a
 * real DOM, the app's exact React version, and dispatched events. The chime
 * package contributes EXACTLY TWO surfaces: a conversation.input.dock entry
 * (session activity chimes, sound only) and a settings.general.item row
 * (on/off switch + volume slider). jsdom has no AudioContext, so a recording
 * fake stands in: each oscillator created counts as one chime note
 * (waiting = 2, done = 3). No popup is ever rendered.
 *
 * Run: node packages/chime/tests/smoke.mjs   (after `npm run build`)
 */
import { createBrowser, loadClientBundle, makeLocaleT, packagePath } from '../../../tests/support/client-harness.mjs'

const browser = createBrowser()
const { dom, ReactDOMClient, h } = browser
const { dicts, t } = makeLocaleT()

/* 1. Load the built chime bundle through the module-loader envelope. */
const plugin = loadClientBundle(browser, packagePath('chime', 'lib', 'client.js'))

const failures = []
const check = (ok, label) => {
  if (ok) console.log('  ✓ ' + label)
  else { console.log('  ✗ ' + label); failures.push(label) }
}

/* 2. apply() against a mock client ctx (chime needs only slots + locale);
      the locale.register captures the dictionary so `t` can resolve keys. */
const registrations = []
const mockCtx = {
  effect(fn) { const dispose = fn() ?? (() => {}); return dispose },
  locale: { register: (ns, d) => { Object.assign(dicts, d); return () => {} } },
  slots: {
    inject: (slot, begin) => { begin() },
    register: (spec, component) => { registrations.push({ spec, component }) },
  },
}
plugin.apply(mockCtx)

const notifyReg = registrations.find((r) => r.spec.name === 'conversation.input.dock')
const notifySettingsReg = registrations.find((r) => r.spec.name === 'settings.general.item')
check(notifyReg !== undefined && notifySettingsReg !== undefined,
  'apply() 注册两个贡献（会话提醒 + 通用设置行）')
check(registrations.length === 2, '贡献数量精确为两个（chime 包不再注册归档设置页）')
check(dom.window.document.getElementById('better-webui-notify-style') !== null, '样式表已注入 <head>')
check(notifyReg.spec.id === 'better-webui-notify' && typeof notifyReg.component === 'function',
  '会话活动提醒注册到 conversation.input.dock（id better-webui-notify）')
check(notifySettingsReg.spec.id === 'better-webui-notify' && typeof notifySettingsReg.component === 'function',
  '提示音设置注册到 settings.general.item（id better-webui-notify）')

/* 3. NotifyDock transitions (sound only). */
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
dom.window.localStorage.clear()

const notifyHost = dom.window.document.createElement('div')
dom.window.document.body.appendChild(notifyHost)
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
const bodyNotify = () => dom.window.document.body.querySelector('.bwt-notify')

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
dom.window.localStorage.setItem('better-webui:notify:enabled', '0')
await renderNotify(sessionSnap({}), 'n5')
oscCalls = 0
await renderNotify(sessionSnap({ pending: [{ kind: 'question' }] }), 'n5')
check(oscCalls === 0, '提醒：开关关闭时不发提示音')

notifyRoot.unmount()
notifyHost.remove()

/* 4. General-settings row: on/off switch + volume slider, persisted to
      localStorage (pure client — no host data). */
dom.window.localStorage.clear()
const settingsHost = dom.window.document.createElement('div')
dom.window.document.body.appendChild(settingsHost)
const settingsRoot = ReactDOMClient.createRoot(settingsHost)
await new Promise((resolve) => {
  settingsRoot.render(h(notifySettingsReg.component, { t }))
  setTimeout(resolve, 20)
})

const switchEl = settingsHost.querySelector('.bwt-switch')
const sliderEl = settingsHost.querySelector('.bwt-volume input[type=range]')
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))

check(switchEl !== null && switchEl.getAttribute('role') === 'switch'
  && switchEl.getAttribute('aria-checked') === 'true', '通用设置：默认开关开启')
check(sliderEl !== null && sliderEl.value === '80' && sliderEl.disabled === false,
  '通用设置：默认音量 80 且滑块可用')

await new Promise((r) => { click(switchEl); setTimeout(r, 20) })
check(dom.window.localStorage.getItem('better-webui:notify:enabled') === '0'
  && switchEl.getAttribute('aria-checked') === 'false', '通用设置：关闭开关写入 localStorage')
check(sliderEl.disabled === true, '通用设置：关闭后滑块禁用')

await new Promise((r) => { click(switchEl); setTimeout(r, 20) })
check(dom.window.localStorage.getItem('better-webui:notify:enabled') === '1', '通用设置：重新开启')

// The slider listens to native events: `input` (dragging) only persists the
// value; `change` (release) previews the chime once.
oscCalls = 0
sliderEl.value = '35'
sliderEl.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
await new Promise((r) => setTimeout(r, 20))
check(dom.window.localStorage.getItem('better-webui:notify:volume') === '35', '通用设置：音量滑块拖动写入 localStorage')
check(oscCalls === 0, '通用设置：拖动中不试听')
sliderEl.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
await new Promise((r) => setTimeout(r, 20))
check(oscCalls === 3, '通用设置：松手时试听一次（完成三音）')

settingsRoot.unmount()
settingsHost.remove()

console.log(failures.length === 0 ? '\n全部通过 ✓' : `\n${failures.length} 项失败`)
process.exit(failures.length === 0 ? 0 : 1)
