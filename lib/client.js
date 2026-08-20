window.__ModuleLoader__.load({ id: '@better-webui/better-webui', factory: (require) => {
var module = { exports: {} };
var exports = module.exports;
Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/**
 * better-webui browser half source. build.mjs wraps this file into the
 * `window.__ModuleLoader__.load` factory envelope emitted as lib/client.js.
 *
 * Three contributions (all additive — no native surface is replaced):
 * - `settings.section`: one settings page in the sidebar nav, ordered
 *   directly below the agent-preset page. The native UI can archive a session
 *   but offers no viewing, restore, or delete surface for archived sessions;
 *   this page is that surface. It lists every archived session (title,
 *   workspace, time); every live row offers restore-to-sidebar and a
 *   two-step-confirm permanent delete. Rows whose session no longer exists
 *   anywhere are greyed with a marker, and a purge control clears those dead
 *   records. A live session that was permanently deleted also greys out: the
 *   host cannot dispose it until restart, so it stays archived and hidden
 *   (and its record clears on restart) instead of reappearing in Ungrouped.
 *   A full settings page (rather than a sidebar icon or a General row) keeps
 *   the surface out of the sidebar footer, where the dynamic-plugin panel
 *   would displace it.
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
 * Icons, tooltips, and chrome come from the native ui-primitives platform
 * module, so the controls read as product UI rather than plugin UI.
 */

var React = require('react')
var ReactDOM = require('react-dom')
var P = require('@deepseek-ai/dsh-client-ui-primitives')
var h = React.createElement
var useState = React.useState
var useEffect = React.useEffect
var useRef = React.useRef

var NS = 'better-webui-archive'
/** Wire version this client expects; must match WIRE_VERSION in src/host.js. */
var WIRE = 3

var DICT = {
  zh: {
    'archive.title': '归档会话',
    'archive.empty': '没有归档会话',
    'archive.count': '{n} 个会话',
    'archive.hint': '↺ 恢复到侧栏 · 🗑 彻底删除（两步确认）',
    'archive.dead': '会话已删',
    'archive.purge': '清除失效记录',
    'archive.purgeConfirm': '再次点击清除',
    'archive.stale': '宿主插件是旧版本，请重启 dsh web 后再操作',
    'settings.desc': '管理被原生界面归档隐藏的会话，可恢复到侧栏或彻底删除。',
    'restore': '恢复',
    'destroy': '彻底删除',
    'destroyConfirm': '再次点击以彻底删除',
    'untitled': '无标题',
    'toast.restored': '已恢复，会话回到侧栏',
    'toast.destroyed': '已彻底删除',
    'toast.destroyedKept': '已彻底删除（记录将在重启后清除）',
    'toast.failed': '操作失败',
    'archive.restartClears': '重启后清除',
    'notify.enabled.title': '会话提示音',
    'notify.enabled.desc': 'Agent 等待输入或完成回合时播放提示音',
    'notify.volume.title': '提示音音量',
    'notify.volume.desc': '0 为静音，100 为最大音量',
    'time.now': '刚刚',
    'time.minutes': '{n} 分钟前',
    'time.hours': '{n} 小时前',
    'time.days': '{n} 天前',
  },
  en: {
    'archive.title': 'Archived sessions',
    'archive.empty': 'No archived sessions',
    'archive.count': '{n} session(s)',
    'archive.hint': '↺ restore to sidebar · 🗑 delete forever (two-step)',
    'archive.dead': 'session deleted',
    'archive.purge': 'Purge dead records',
    'archive.purgeConfirm': 'Click again to purge',
    'archive.stale': '插件宿主半是旧版本：请重启 dsh web 后再恢复/删除',
    'settings.desc': 'Manage sessions hidden by the native archive — restore them to the sidebar or delete them permanently.',
    'restore': 'Restore',
    'destroy': 'Delete forever',
    'destroyConfirm': 'Click again to delete forever',
    'untitled': 'Untitled',
    'toast.restored': 'Restored; the session is back in the sidebar',
    'toast.destroyed': 'Deleted permanently',
    'toast.destroyedKept': 'Deleted permanently (entry clears after a restart)',
    'toast.failed': 'Action failed',
    'archive.restartClears': 'clears on restart',
    'notify.enabled.title': 'Session chime',
    'notify.enabled.desc': 'Play a chime when the agent waits for input or finishes a turn',
    'notify.volume.title': 'Chime volume',
    'notify.volume.desc': '0 mutes, 100 is loudest',
    'time.now': 'just now',
    'time.minutes': '{n} min ago',
    'time.hours': '{n} h ago',
    'time.days': '{n} d ago',
  },
}

var CSS = [
  /* settings section page — one nav page below the agent-preset page
     (mirrors the shipped section chrome: 18px title, 13px intro, 720px) */
  '.bwt-page{display:flex;flex-direction:column;gap:12px;max-width:720px;color:var(--dsw-alias-label-primary);}',
  '.bwt-title{margin:0;font-size:18px;font-weight:600;}',
  '.bwt-intro{margin:0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-tertiary);}',
  '.bwt-stale{padding:8px 12px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);}',
  '.bwt-footer{display:flex;justify-content:flex-end;}',
  '.bwt-purge{border:none;background:transparent;padding:4px 8px;border-radius:7px;font-size:12px;color:var(--dsw-alias-label-tertiary);cursor:pointer;white-space:nowrap;}',
  '.bwt-purge:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',

  /* full-width list card under the intro */
  '.bwt-list{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);overflow:hidden;}',
  '.bwt-row{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);}',
  '.bwt-row:last-child{border-bottom:none;}',
  '.bwt-row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}',
  '.bwt-row-title{font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '.bwt-row-sub{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '.bwt-row[data-dead]{opacity:.45;}',
  '.bwt-row-actions{display:flex;align-items:center;gap:2px;flex:none;}',
  '.bwt-action{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;}',
  '.bwt-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',
  '.bwt-action:disabled{opacity:.4;cursor:default;}',
  '.bwt-action:disabled:hover{background:transparent;color:var(--dsw-alias-label-tertiary);}',
  '.bwt-action[data-danger]{color:var(--dsw-alias-state-error-primary);}',
  '.bwt-action[data-danger]:hover{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);}',
  '.bwt-empty{padding:24px 16px;font-size:13px;color:var(--dsw-alias-label-tertiary);text-align:center;border:1px dashed var(--dsw-alias-border-l3);border-radius:12px;}',

  /* status toast */
  '.bwt-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);display:flex;align-items:center;gap:10px;max-width:70vw;padding:10px 10px 10px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-overlay);box-shadow:0 8px 24px rgba(0,0,0,.18);color:var(--dsw-alias-label-primary);font-size:13px;z-index:1000;}',
  '.bwt-toast-icon{display:inline-flex;color:var(--dsw-alias-label-tertiary);}',
  '.bwt-toast-text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '.bwt-toast-close{border:none;background:transparent;padding:4px;color:var(--dsw-alias-label-tertiary);cursor:pointer;display:inline-flex;}',
  '.bwt-toast-close:hover{color:var(--dsw-alias-label-primary);}',

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

/** Locale-aware relative time for popover rows. */
function relativeTime(timestamp, t) {
  var diff = Date.now() - timestamp
  if (diff < 60000) return t('time.now')
  if (diff < 3600000) return t('time.minutes', { n: Math.floor(diff / 60000) })
  if (diff < 86400000) return t('time.hours', { n: Math.floor(diff / 3600000) })
  return t('time.days', { n: Math.floor(diff / 86400000) })
}

/** Final path segment of a workspace cwd, for row subtitles. */
function cwdBasename(cwd) {
  if (cwd === undefined || cwd === '') return ''
  var parts = String(cwd).replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || String(cwd)
}

/** Diagnostics for browser devtools when a host call fails. */
function reportError(scope, error) {
  var message = error instanceof Error ? error.message : String(error)
  console.error('better-webui: ' + scope + ' failed: ' + message)
  return message
}

/* ── session activity notifications ──────────────────────────────────────────
   When the open session's agent (a) starts waiting for user input (a question /
   approval / plan-review becomes pending) or (b) finishes a turn (running→idle
   with nothing pending), play a short synthesized chime. Sound only — no
   popup. On/off and volume live in General settings (settings.general.item),
   persisted to localStorage so nothing on the host is touched and no restart
   is needed.
   Detection reads the input-dock owner share's ConversationSnapshot directly —
   a point-in-time snapshot re-rendered on change — and fires only on state
   transitions, never on every render. The sound is synthesized with the Web
   Audio API (no asset file); the context is unlocked on the first user gesture
   so browser autoplay policy is satisfied by the time a real notification
   arrives. */

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

/**
 * Settings section page: one nav entry below the agent-preset page. The page
 * is the native archive set's missing management surface — view, restore,
 * two-step permanent delete, and dead-record purge. Rows are always visible
 * (the page IS the surface, no popover or toggle to be displaced).
 */
function SettingsArchiveSection(props) {
  var api = props.api
  var t = props.t
  var useWorkspaces = props.useWorkspaces
  var useSessions = props.useSessions

  // Framework-hook reads: stable projections only (ids array, items, byId).
  var archivedIds = useWorkspaces(function (state) { return state.archivedSessionIds })
  var workspaceItems = useWorkspaces(function (state) { return state.items })
  var byId = useSessions(function (list) { return list.byId })

  var archiveStatusState = useState(null)
  var archiveStatus = archiveStatusState[0]
  var setArchiveStatus = archiveStatusState[1]
  var staleState = useState(false)
  var stale = staleState[0]
  var setStale = staleState[1]
  var destroyArmState = useState(null)
  var destroyArm = destroyArmState[0]
  var setDestroyArm = destroyArmState[1]
  var purgeArmedState = useState(false)
  var purgeArmed = purgeArmedState[0]
  var setPurgeArmed = purgeArmedState[1]
  var toastState = useState(null)
  var toast = toastState[0]
  var setToast = toastState[1]
  var toastTimer = useRef(null)
  var destroyTimer = useRef(null)
  var purgeTimer = useRef(null)

  var reload = function () {
    api.listArchive().then(function (items) {
      var map = {}
      for (var i = 0; i < items.length; i++) {
        map[items[i].sessionId] = {
          dead: items[i].dead === true,
          live: items[i].live === true,
        }
      }
      setArchiveStatus(map)
    }, function (error) {
      reportError('listArchive', error)
      setArchiveStatus({})
    })
  }

  /**
   * Wire handshake: the client bundle hot-reloads on file change while the
   * host half loads only at `dsh web` start, so a newer client against an
   * older host is a normal transient. Detect it once per open and explain
   * instead of letting actions fail with confusing method errors.
   */
  var checkHost = function () {
    api.ping().then(function (v) { setStale(v !== WIRE) }, function () { setStale(true) })
  }

  // The page mounts whenever the settings section is opened; read the archive
  // set and verify the host wire every time it becomes visible.
  useEffect(function () {
    reload()
    checkHost()
  }, [])
  useEffect(function () {
    return function () {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
      if (destroyTimer.current !== null) window.clearTimeout(destroyTimer.current)
      if (purgeTimer.current !== null) window.clearTimeout(purgeTimer.current)
    }
  }, [])

  var notify = function (kind, message) {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
    setToast({ kind: kind, message: message })
    toastTimer.current = window.setTimeout(function () { setToast(null) }, kind === 'failed' ? 6000 : 3000)
  }

  var afterAction = function (kind) {
    reload()
    api.refreshSessions().catch(function (error) { reportError('refreshSessions', error) })
    notify(kind)
  }

  var restoreRow = function (row) {
    setDestroyArm(null)
    api.restore(row.sessionId)
      .then(function () { afterAction('restored') })
      .catch(function (error) { notify('failed', reportError('restore', error)) })
  }

  var armDestroy = function (sessionId) {
    setDestroyArm(sessionId)
    if (destroyTimer.current !== null) window.clearTimeout(destroyTimer.current)
    destroyTimer.current = window.setTimeout(function () { setDestroyArm(null) }, 3000)
  }

  var destroyRow = function (row) {
    setDestroyArm(null)
    api.destroy(row.sessionId)
      .then(function (value) {
        afterAction(value !== null && typeof value === 'object' && value.keptArchived === true
          ? 'destroyedKept'
          : 'destroyed')
      })
      .catch(function (error) { notify('failed', reportError('destroy', error)) })
  }

  var purgeDead = function () {
    if (!purgeArmed) {
      setPurgeArmed(true)
      if (purgeTimer.current !== null) window.clearTimeout(purgeTimer.current)
      purgeTimer.current = window.setTimeout(function () { setPurgeArmed(false) }, 4000)
      return
    }
    setPurgeArmed(false)
    api.purge()
      .then(function () { afterAction('destroyed') })
      .catch(function (error) { notify('failed', reportError('purge', error)) })
  }

  /* rows: the archive set is the list. */
  var ids = []
  if (Array.isArray(archivedIds)) for (var i = 0; i < archivedIds.length; i++) ids.push(archivedIds[i])

  var hasDead = false
  var rows = ids.map(function (sessionId) {
    var summary = byId === undefined ? undefined : byId[sessionId]
    var status = archiveStatus === null ? undefined : archiveStatus[sessionId]
    // Dead = no summary (the session is gone), or the host reports its
    // durable data is gone — a destroyed live session stays resident in host
    // memory until restart, so the summary alone cannot show it as dead.
    var dead = summary === undefined || (status !== undefined && status.dead)
    if (dead) hasDead = true
    var restartClears = status !== undefined && status.live && dead
    var workspace = workspaceItems === undefined ? undefined : workspaceItems.find(function (w) {
      return w.sessionIds !== undefined && w.sessionIds.indexOf(sessionId) !== -1
    })
    var label = dead ? t('archive.dead')
      : (summary.displayTitle || summary.title || t('untitled'))
    var sub = dead ? sessionId.slice(0, 13) + '…' + (restartClears ? ' · ' + t('archive.restartClears') : '') : [
      workspace !== undefined ? (workspace.title || cwdBasename(workspace.cwd)) : '',
      summary.updatedAt !== undefined ? relativeTime(summary.updatedAt, t) : '',
    ].filter(function (part) { return part !== '' }).join(' · ')
    var cwd = workspace !== undefined ? workspace.cwd : ''
    return { sessionId: sessionId, label: label, sub: sub, dead: dead, cwd: cwd }
  })

  var toastNode = null
  if (toast !== null) {
    var text = toast.kind === 'restored' ? t('toast.restored')
      : toast.kind === 'destroyed' ? t('toast.destroyed')
        : toast.kind === 'destroyedKept' ? t('toast.destroyedKept')
          : t('toast.failed')
    toastNode = ReactDOM.createPortal(
      h('div', { className: 'bwt-toast', role: 'status' },
        h('span', { className: 'bwt-toast-icon' }, h(P.IconArchiveOutline20, { size: 16 })),
        h('span', { className: 'bwt-toast-text' }, text,
          toast.kind === 'failed' && toast.message !== undefined ? ' · ' + toast.message : null),
        h('button', {
          type: 'button',
          className: 'bwt-toast-close',
          'aria-label': t('restore'),
          onClick: function () {
            if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
            setToast(null)
          },
        }, h(P.IconCloseOutline16, { size: 14 }))),
      document.body)
  }

  var list = null
  if (rows.length === 0) {
    list = h('div', { className: 'bwt-empty' }, t('archive.empty'))
  } else {
    list = h('div', { className: 'bwt-list' },
      rows.map(function (row) {
        return h('div', {
          key: row.sessionId,
          className: 'bwt-row',
          'data-dead': row.dead ? 'true' : undefined,
        },
          h('div', { className: 'bwt-row-main' },
            h('span', { className: 'bwt-row-title', title: row.dead ? row.sessionId : (row.cwd || row.label) }, row.label),
            h('span', { className: 'bwt-row-sub' }, row.sub)),
          row.dead ? null : h('div', { className: 'bwt-row-actions' },
            destroyArm === row.sessionId
              ? h(P.Tooltip, { label: t('destroyConfirm'), side: 'top' },
                h('button', {
                  type: 'button',
                  className: 'bwt-action',
                  'data-danger': 'true',
                  'aria-label': t('destroyConfirm'),
                  disabled: stale,
                  onClick: function () { destroyRow(row) },
                }, h(P.IconCheckOutline16, { size: 14 })))
              : h(P.Tooltip, { label: t('restore'), side: 'top' },
                h('button', {
                  type: 'button',
                  className: 'bwt-action',
                  'aria-label': t('restore'),
                  disabled: stale,
                  onClick: function () { restoreRow(row) },
                }, h(P.IconRefreshOutline16, { size: 14 }))),
            h(P.Tooltip, { label: t('destroy'), side: 'top' },
              h('button', {
                type: 'button',
                className: 'bwt-action',
                'data-danger': 'true',
                'aria-label': t('destroy'),
                disabled: stale,
                onClick: function () { armDestroy(row.sessionId) },
              }, h(P.IconTrashOutline16, { size: 14 })))))
      }))
  }

  return h('div', { className: 'bwt-page' },
    h('h2', { className: 'bwt-title' }, t('archive.title')),
    h('p', { className: 'bwt-intro' }, t('settings.desc')),
    stale ? h('div', { className: 'bwt-stale' }, t('archive.stale')) : null,
    list,
    !stale && hasDead ? h('div', { className: 'bwt-footer' },
      h('button', {
        type: 'button',
        className: 'bwt-purge',
        onClick: purgeDead,
      }, purgeArmed ? t('archive.purgeConfirm') : t('archive.purge'))) : null,
    toastNode)
}

exports.inject = ['slots', 'sessions', 'workspaces', 'locale', 'connection']

exports.apply = function apply(ctx) {
  if (typeof document !== 'undefined' && document.getElementById('better-webui-style') === null) {
    var style = document.createElement('style')
    style.id = 'better-webui-style'
    style.textContent = CSS
    document.head.append(style)
  }

  ctx.effect(function () { return ctx.locale.register(NS, DICT) }, 'better-webui: dictionaries')

  var unwrap = function (method, payload) {
    return ctx.connection.rpc.call('/better-webui', method, payload).then(function (result) {
      if (result === null || typeof result !== 'object' || result.ok !== true) {
        var message = result !== null && typeof result === 'object'
          && result.error !== undefined && result.error.message !== undefined
          ? String(result.error.message)
          : '/better-webui/' + method
        throw new Error(message)
      }
      return result.value
    })
  }
  var api = {
    ping: function () { return unwrap('ping', {}).then(function (value) { return value.v }) },
    listArchive: function () { return unwrap('listArchive', {}).then(function (value) { return value.items }) },
    restore: function (sessionId) { return unwrap('restore', { sessionId: sessionId }) },
    destroy: function (sessionId) { return unwrap('destroy', { sessionId: sessionId }) },
    purge: function () { return unwrap('purge', {}) },
    refreshSessions: function () { return ctx.sessions.refresh() },
  }

  ctx.slots.inject('settings.section', function () {
    return ctx.slots.register({
      name: 'settings.section',
      id: 'better-webui-archive',
      // Directly below the agent-preset page (order 20) in the settings nav.
      order: 30,
      label: function () { return ctx.locale.bind(NS)('archive.title') },
      locale: NS,
      inject: function () { return { api: api } },
    }, SettingsArchiveSection)
  })

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
    }, 'better-webui: audio unlock listeners')
  }
}

return module.exports;
} });
