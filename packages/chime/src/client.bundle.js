/**
 * better-webui chime browser half source. build-package wraps this file into
 * the `window.__ModuleLoader__.load` factory envelope emitted as lib/client.js.
 *
 * One additive contribution (no native surface is replaced):
 * - `conversation.input.dock` (id `better-webui-notify`): session activity
 *   chimes (sound only, no popup). When the open session's agent starts
 *   waiting for user input (an ask_user_question / approval / plan-review
 *   becomes pending) or finishes a turn (running→idle with nothing pending),
 *   the plugin plays a short synthesized chime (Web Audio API — no asset
 *   file). Detection reads the dock's ConversationSnapshot owner prop and
 *   fires only on state transitions, never on every render.
 *
 * The chime's on/off switch and volume slider used to live in a
 * `settings.general.item` row; since v0.19 they live on the dedicated
 * "better-webui" settings page (the better-webui-settings package), which
 * reads and writes the SAME localStorage keys (`better-webui:notify:enabled` /
 * `:volume`). This package keeps only the dock + audio; the prefs stay pure
 * client (no host data, no restart).
 */

var React = require('react')
var h = React.createElement
var useEffect = React.useEffect
var useRef = React.useRef

var NS = 'better-webui-notify'

var DICT = {
  zh: {},
  en: {},
}

var CSS = [
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
