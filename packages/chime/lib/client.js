window.__ModuleLoader__.load({ id: "@blueriverlhr/dsh-better-webui-chime", factory: (require) => {
var module = { exports: {} };
var exports = module.exports;
Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/**
 * better-webui chime browser half source. build-package wraps this file into
 * the `window.__ModuleLoader__.load` factory envelope emitted as lib/client.js.
 *
 * Two additive contributions (no native surface is replaced):
 * - `conversation.input.dock` (id `better-webui-notify`): session activity
 *   chimes (sound only, no popup). When the open session's agent starts
 *   waiting for user input (an ask_user_question / approval / plan-review
 *   becomes pending) or finishes a turn (running→idle with nothing pending),
 *   the plugin plays a short synthesized chime (Web Audio API — no asset
 *   file). Detection reads the dock's ConversationSnapshot owner prop and
 *   fires only on state transitions, never on every render.
 * - `settings.general.item` (id `better-webui-notify`): the chime's on/off
 *   switch and volume slider in the General settings section, persisted to
 *   localStorage — pure client, so no host data is written and no restart is
 *   needed.
 *
 * The chime is deliberately a separate package from the archive page: it has
 * no host dependency, no RPC, and its failure surface is its own fiber.
 */

var React = require('react')
var h = React.createElement
var useState = React.useState
var useEffect = React.useEffect
var useRef = React.useRef

var NS = 'better-webui-notify'

var DICT = {
  zh: {
    'notify.enabled.title': '会话提示音',
    'notify.enabled.desc': 'Agent 等待输入或完成回合时播放提示音',
    'notify.volume.title': '提示音音量',
    'notify.volume.desc': '0 为静音，100 为最大音量',
  },
  en: {
    'notify.enabled.title': 'Session chime',
    'notify.enabled.desc': 'Play a chime when the agent waits for input or finishes a turn',
    'notify.volume.title': 'Chime volume',
    'notify.volume.desc': '0 mutes, 100 is loudest',
  },
}

var CSS = [
  /* General-settings row: session chime on/off + volume. The switch mirrors
     the native dsh switch (button[role=switch] + track + thumb, theme tokens);
     the volume is a theme-accented range with a live value readout. */
  '.bwt-notify-row{display:flex;align-items:center;gap:16px;width:100%;}',
  '.bwt-notify-rowtext{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}',
  '.bwt-notify-rowtitle{font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary);}',
  '.bwt-notify-rowdesc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}',
  /* native dsh switch anatomy (trajectory toolbar) */
  '.bwt-switch{display:inline-flex;flex:none;align-items:center;justify-content:center;width:32px;height:20px;padding:0;border:none;background:transparent;cursor:pointer;}',
  '.bwt-switch:disabled{cursor:default;}',
  '.bwt-switch:focus-visible{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:1px;border-radius:999px;}',
  '.bwt-switch-track{background:var(--dsw-alias-border-l2);width:20px;height:10px;transition:background-color .12s var(--ds-ease-in-out);border-radius:5px;flex:none;display:inline-block;position:relative;}',
  '.bwt-switch-track[data-on=true]{background:var(--dsw-alias-state-business-primary);}',
  '.bwt-switch-thumb{background:var(--dsw-alias-bg-layer-1);width:6px;height:6px;transition:transform .12s var(--ds-ease-in-out);border-radius:50%;position:absolute;top:2px;left:2px;}',
  '.bwt-switch-track[data-on=true] .bwt-switch-thumb{transform:translate(10px);}',
  '.bwt-switch:disabled .bwt-switch-track{opacity:.4;}',
  /* theme-accented volume slider */
  '.bwt-volume{flex:none;display:flex;align-items:center;gap:8px;width:150px;flex-shrink:0;margin-left:auto;}',
  '.bwt-volume input[type=range]{flex:1;min-width:0;appearance:none;-webkit-appearance:none;height:10px;margin:0;cursor:pointer;background:transparent;}',
  '.bwt-volume input[type=range]::-webkit-slider-runnable-track{height:4px;border-radius:2px;background:var(--dsw-alias-border-l2);}',
  '.bwt-volume input[type=range]::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:12px;height:12px;margin-top:-4px;border-radius:50%;background:var(--dsw-alias-state-business-primary);border:none;box-shadow:0 1px 2px rgba(0,0,0,.25);}',
  '.bwt-volume input[type=range]::-moz-range-track{height:4px;border-radius:2px;background:var(--dsw-alias-border-l2);}',
  '.bwt-volume input[type=range]::-moz-range-thumb{width:12px;height:12px;border-radius:50%;background:var(--dsw-alias-state-business-primary);border:none;}',
  '.bwt-volume input[type=range]:disabled{cursor:default;opacity:.4;}',
  '.bwt-volume-value{flex:none;width:24px;font-size:12px;color:var(--dsw-alias-label-secondary);text-align:right;font-variant-numeric:tabular-nums;}',
].join('\n')

var NOTIFY_ENABLED_KEY = 'better-webui:notify:enabled'
var NOTIFY_VOLUME_KEY = 'better-webui:notify:volume'

/** Read the chime prefs from localStorage (safe defaults: on, volume 80). */
function readNotifyPrefs() {
  var enabled = true
  var volume = 80
  try {
    var rawEnabled = window.localStorage.getItem(NOTIFY_ENABLED_KEY)
    if (rawEnabled !== null) enabled = rawEnabled !== '0'
    var rawVolume = window.localStorage.getItem(NOTIFY_VOLUME_KEY)
    if (rawVolume !== null) {
      var parsed = parseInt(rawVolume, 10)
      if (!isNaN(parsed)) volume = Math.max(0, Math.min(100, parsed))
    }
  } catch (error) {
    // localStorage unavailable → safe defaults.
  }
  return { enabled: enabled, volume: volume }
}

/** Persist one chime pref (best-effort; failures fall back to defaults). */
function writeNotifyPref(key, value) {
  try {
    window.localStorage.setItem(key, String(value))
  } catch (error) {
    // Not persisted; the current session still keeps the live state.
  }
}

var notifyAudioCtx = null

/** Lazily create and resume the Web Audio context (autoplay-policy safe). */
function ensureNotifyAudio() {
  if (typeof window === 'undefined') return null
  var AC = window.AudioContext || window.webkitAudioContext
  if (AC === undefined) return null
  if (notifyAudioCtx === null) {
    try { notifyAudioCtx = new AC() } catch (error) { return null }
  }
  if (notifyAudioCtx.state === 'suspended') {
    var pending = notifyAudioCtx.resume()
    if (pending !== undefined && typeof pending.catch === 'function') {
      pending.catch(function () { /* stays suspended until a user gesture */ })
    }
  }
  return notifyAudioCtx
}

/** Unlock audio on the first user gesture anywhere (autoplay policy). */
function unlockNotifyAudio() {
  ensureNotifyAudio()
}

/**
 * Play a short synthesized chime (respects the enabled/volume prefs).
 * - 'waiting': descending two-tone (attention — the user should look).
 * - 'done': ascending three-tone (completion — the turn is over).
 * - 'error': low two-tone (a turn ended in failure — retries exhausted or a
 *   hard model error; distinct so it is never mistaken for completion).
 */
function playNotifyChime(kind) {
  var prefs = readNotifyPrefs()
  if (!prefs.enabled || prefs.volume <= 0) return
  var actx = ensureNotifyAudio()
  if (actx === null || actx.state !== 'running') return
  var amp = 0.16 * (prefs.volume / 100)
  var notes = kind === 'waiting' ? [880, 587.33]
    : kind === 'error' ? [392, 293.66]
      : [523.25, 659.25, 783.99]
  var start = actx.currentTime + 0.02
  for (var i = 0; i < notes.length; i++) {
    var osc = actx.createOscillator()
    var gain = actx.createGain()
    osc.type = 'sine'
    osc.frequency.value = notes[i]
    var t0 = start + i * 0.16
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(amp, t0 + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22)
    osc.connect(gain)
    gain.connect(actx.destination)
    osc.start(t0)
    osc.stop(t0 + 0.24)
  }
}

/**
 * Classify the last turn-result node in the conversation window.
 * Walks back from the tail to the first result-bearing node:
 * - 'assistant': a finalized assistant message (normal completion).
 * - 'assistant-interrupted': a frozen partial from a user stop (not a completion).
 * - 'error': a terminal turn-error (retries exhausted / hard failure).
 * - 'max-tokens': a turn ended by the output-token cap.
 * - null: nothing result-bearing in the window.
 * `model-retry` nodes are transitional and skipped.
 */
function lastTurnOutcome(nodes) {
  if (!Array.isArray(nodes)) return null
  for (var i = nodes.length - 1; i >= 0; i--) {
    var node = nodes[i]
    if (node === null || typeof node !== 'object') continue
    if (node.kind === 'assistant') return node.interrupted === true ? 'assistant-interrupted' : 'assistant'
    if (node.kind === 'turn-error') return 'error'
    if (node.kind === 'turn-max-tokens') return 'max-tokens'
  }
  return null
}

/**
 * Session-activity notifier (sound only). Registered as a
 * conversation.input.dock entry (order 30, after queue) so it mounts exactly
 * while a session is open and receives the live ConversationSnapshot as an
 * owner prop. It renders nothing (no dock content, no popup).
 *
 * Trigger rules (refs hold the previous observation, so only genuine
 * transitions fire):
 * - waiting: `pending` grows from 0 to non-empty (question / approval /
 *   plan-review).
 * - running→idle with `pending` empty: the tail turn outcome picks the chime —
 *   'assistant' → done, 'error' → error, interrupted → nothing (a user stop is
 *   not a completion, and a retry-exhausted failure must never sound "done").
 */
function NotifyDock(props) {
  var session = props.session

  var pending = session !== null && session !== undefined && Array.isArray(session.pending)
    ? session.pending
    : []
  var pendingCount = pending.length
  var running = session !== null && session !== undefined && session.running === true
  var nodes = session !== null && session !== undefined && Array.isArray(session.nodes)
    ? session.nodes
    : []

  var prev = useRef(null)
  var lastFired = useRef(null)

  // Record the previous observation for transition detection (render body
  // writes; effects read). The first render only seeds the baseline.
  var observed = { running: running, pendingCount: pendingCount }
  var baseline = prev.current
  prev.current = observed

  useEffect(function () {
    var now = Date.now()
    var fired = lastFired.current

    var chime = function (kind) {
      // Cooldown: ignore the same kind within 2.5s (snapshot streams can
      // re-publish the same transition).
      if (fired !== null && fired.kind === kind && now - fired.t < 2500) return
      lastFired.current = { kind: kind, t: now }
      playNotifyChime(kind)
    }

    if (baseline === null) return
    if (pendingCount > 0 && baseline.pendingCount === 0) {
      chime('waiting')
    } else if (baseline.running === true && running === false && pendingCount === 0) {
      var outcome = lastTurnOutcome(nodes)
      if (outcome === 'assistant') chime('done')
      else if (outcome === 'error' || outcome === 'max-tokens') chime('error')
      // interrupted → nothing; the user stopped it themselves.
    }
  }, [running, pendingCount, nodes, baseline])

  return null
}

/**
 * General-settings rows for the session chime: an on/off switch plus a volume
 * slider. Registered as settings.general.item entries (additive, root scope);
 * the owner passes no props, so each row draws its own title/desc/control
 * (mirroring the shipped rows) and persists through localStorage — no host
 * data is written and no restart is needed.
 */
function NotifySettingsRow(props) {
  var t = props.t
  var enabledState = useState(function () { return readNotifyPrefs().enabled })
  var enabled = enabledState[0]
  var setEnabled = enabledState[1]
  var volumeState = useState(function () { return readNotifyPrefs().volume })
  var volume = volumeState[0]
  var setVolume = volumeState[1]
  var volumeInput = useRef(null)

  var toggle = function () {
    var next = !enabled
    setEnabled(next)
    writeNotifyPref(NOTIFY_ENABLED_KEY, next ? '1' : '0')
    if (next) playNotifyChime('done') // preview the chime when re-enabled
  }

  // Listen to the slider's native events (React's synthetic onChange for a
  // controlled range is hard to drive in jsdom; native listeners read the DOM
  // value directly and behave identically in the browser and in tests).
  // `input` (dragging) only persists the value; `change` (release) previews
  // the chime once, so it does not spam a beep on every tick while dragging.
  useEffect(function () {
    var node = volumeInput.current
    if (node === null || node === undefined) return
    var onInput = function () {
      var next = parseInt(node.value, 10)
      if (isNaN(next)) return
      setVolume(next)
      writeNotifyPref(NOTIFY_VOLUME_KEY, String(next))
    }
    var onChange = function () {
      playNotifyChime('done') // preview only when the user releases the slider
    }
    node.addEventListener('input', onInput)
    node.addEventListener('change', onChange)
    return function () {
      node.removeEventListener('input', onInput)
      node.removeEventListener('change', onChange)
    }
  }, [])

  return h('div', { className: 'bwt-notify-row' },
    h('div', { className: 'bwt-notify-rowtext' },
      h('div', { className: 'bwt-notify-rowtitle' }, t('notify.enabled.title')),
      h('div', { className: 'bwt-notify-rowdesc' }, t('notify.enabled.desc'))),
    h('button', {
      type: 'button',
      className: 'bwt-switch',
      role: 'switch',
      'aria-checked': enabled ? 'true' : 'false',
      'aria-label': t('notify.enabled.title'),
      onClick: toggle,
    },
      h('span', {
        className: 'bwt-switch-track',
        'data-on': enabled ? 'true' : undefined,
        'aria-hidden': 'true',
      }, h('span', { className: 'bwt-switch-thumb' }))),
    h('label', { className: 'bwt-volume', title: t('notify.volume.title') },
      h('input', {
        ref: volumeInput,
        type: 'range',
        min: '0',
        max: '100',
        step: '1',
        value: String(volume),
        disabled: !enabled,
        'aria-label': t('notify.volume.title'),
        // The native `input` listener (above) is the real handler; this no-op
        // keeps React from warning about a value without onChange.
        onChange: function () {},
      }),
      h('span', { className: 'bwt-volume-value' }, String(volume))))
}

exports.inject = ['slots', 'locale']

exports.apply = function apply(ctx) {
  if (typeof document !== 'undefined' && document.getElementById('better-webui-notify-style') === null) {
    var style = document.createElement('style')
    style.id = 'better-webui-notify-style'
    style.textContent = CSS
    document.head.append(style)
  }

  ctx.effect(function () { return ctx.locale.register(NS, DICT) }, 'better-webui-chime: dictionaries')

  // Session activity notifications: register in the input dock so the entry
  // mounts exactly while a session is open and receives the live
  // ConversationSnapshot. It renders nothing (sound only — no popup); a fresh
  // additive id keeps the shipped entries.
  ctx.slots.inject('conversation.input.dock', function () {
    return ctx.slots.register({
      name: 'conversation.input.dock',
      id: 'better-webui-notify',
      // After todo (0), goal (10), queue (20).
      order: 30,
      locale: NS,
    }, NotifyDock)
  })

  // Chime preferences in General settings: an on/off switch + volume slider.
  // Persisted to localStorage (pure client — no host data, no restart).
  ctx.slots.inject('settings.general.item', function () {
    return ctx.slots.register({
      name: 'settings.general.item',
      id: 'better-webui-notify',
      // After composer-enter (20) in the General section.
      order: 30,
      locale: NS,
    }, NotifySettingsRow)
  })

  // Unlock the Web Audio context on the first user gesture so synthesized
  // chimes can play once the agent actually finishes or asks (autoplay policy).
  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    var unlock = function () {
      unlockNotifyAudio()
      document.removeEventListener('pointerdown', unlock)
      document.removeEventListener('keydown', unlock)
    }
    document.addEventListener('pointerdown', unlock)
    document.addEventListener('keydown', unlock)
    ctx.effect(function () {
      document.removeEventListener('pointerdown', unlock)
      document.removeEventListener('keydown', unlock)
    }, 'better-webui-chime: audio unlock listeners')
  }
}

return module.exports;
} });
