window.__ModuleLoader__.load({ id: "@blueriverlhr/dsh-better-webui-settings", factory: (require) => {
var module = { exports: {} };
var exports = module.exports;
Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/**
 * better-webui settings browser half source. build-package wraps this file into
 * the `window.__ModuleLoader__.load` factory envelope emitted as lib/client.js.
 *
 * One additive contribution — a `settings.section` page inside the sidebar nav
 * (id `better-webui-settings`, order 25): the better-webui preference hub page,
 * ordered between the agent-preset page and the retry page. v0.21 起重试策略
 * 已拆去独立包 better-webui-retry（RPC /better-webui-retry），本页只保留会话
 * 提示音卡（纯客户端 localStorage，无需 RPC、无需宿主数据）。
 */

var React = require('react')
var h = React.createElement
var useState = React.useState
var useEffect = React.useEffect
var useRef = React.useRef

var NS = 'better-webui-settings'

var DICT = {
  zh: {
    'settings.title': 'Better WebUI',
    'settings.desc': '本页面集中管理 Better WebUI 的功能偏好，不混入 dsh 自身设置。',

    'chime.title': '会话提示音',
    'chime.desc': 'Agent 等待输入或完成回合时播放提示音（音量 0 为静音）。',
    'chime.enabled': '启动',
    'chime.volume': '调整音量',
  },
  en: {
    'settings.title': 'Better WebUI',
    'settings.desc': 'Preference hub for Better WebUI features, kept apart from dsh\'s own settings.',

    'chime.title': 'Session chime',
    'chime.desc': 'Play a chime when the agent waits for input or finishes a turn (volume 0 mutes).',
    'chime.enabled': 'Enable chime',
    'chime.volume': 'Adjust volume',
  },
}

var CSS = [
  /* settings section page — one nav page between agent-presets and retry
     (mirrors the shipped section chrome: 18px title, 13px intro, 720px) */
  '.bwts-page{display:flex;flex-direction:column;gap:16px;max-width:720px;color:var(--dsw-alias-label-primary);}',
  '.bwts-title{margin:0;font-size:18px;font-weight:600;}',
  '.bwts-intro{margin:0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-tertiary);}',

  /* feature card */
  '.bwts-card{display:flex;flex-direction:column;gap:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);padding:16px;}',
  '.bwts-cardhead{display:flex;flex-direction:column;gap:2px;}',
  '.bwts-cardtitle{font-size:15px;line-height:22px;font-weight:600;}',
  '.bwts-carddesc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}',

  /* chime card: two rows — enable switch + volume slider (description lives
     once under the card head, not repeated per row) */
  '.bwts-chimerow{display:flex;align-items:center;gap:16px;width:100%;}',
  '.bwts-chimerowtext{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}',
  '.bwts-chimerowtitle{font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary);}',
  '.bwts-switch{display:inline-flex;flex:none;align-items:center;justify-content:center;width:32px;height:20px;padding:0;border:none;background:transparent;cursor:pointer;}',
  '.bwts-switch:disabled{cursor:default;}',
  '.bwts-switch:focus-visible{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:1px;border-radius:999px;}',
  '.bwts-switch-track{background:var(--dsw-alias-border-l2);width:20px;height:10px;transition:background-color .12s var(--ds-ease-in-out);border-radius:5px;flex:none;display:inline-block;position:relative;}',
  '.bwts-switch-track[data-on=true]{background:var(--dsw-alias-state-business-primary);}',
  '.bwts-switch-thumb{background:var(--dsw-alias-bg-layer-1);width:6px;height:6px;transition:transform .12s var(--ds-ease-in-out);border-radius:50%;position:absolute;top:2px;left:2px;}',
  '.bwts-switch-track[data-on=true] .bwts-switch-thumb{transform:translate(10px);}',
  '.bwts-switch:disabled .bwts-switch-track{opacity:.4;}',
  '.bwts-volume{flex:none;display:flex;align-items:center;gap:8px;width:150px;flex-shrink:0;margin-left:auto;}',
  '.bwts-volume input[type=range]{flex:1;min-width:0;appearance:none;-webkit-appearance:none;height:10px;margin:0;cursor:pointer;background:transparent;}',
  '.bwts-volume input[type=range]::-webkit-slider-runnable-track{height:4px;border-radius:2px;background:var(--dsw-alias-border-l2);}',
  '.bwts-volume input[type=range]::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:12px;height:12px;margin-top:-4px;border-radius:50%;background:var(--dsw-alias-state-business-primary);border:none;box-shadow:0 1px 2px rgba(0,0,0,.25);}',
  '.bwts-volume input[type=range]::-moz-range-track{height:4px;border-radius:2px;background:var(--dsw-alias-border-l2);}',
  '.bwts-volume input[type=range]::-moz-range-thumb{width:12px;height:12px;border-radius:50%;background:var(--dsw-alias-state-business-primary);border:none;}',
  '.bwts-volume input[type=range]:disabled{cursor:default;opacity:.4;}',
  '.bwts-volume-value{flex:none;width:24px;font-size:12px;color:var(--dsw-alias-label-secondary);text-align:right;font-variant-numeric:tabular-nums;}',
].join('\n')

/** Chime localStorage keys — stable contract shared with the chime package. */
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

/**
 * Session-chime card: the on/off switch + volume slider, moved out of the
 * native General settings into this page. Pure client — it reads and writes
 * the same localStorage keys the chime dock consumes, so no host data and no
 * restart are needed, and existing users keep their saved prefs.
 */
function ChimeCard(props) {
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
  }

  useEffect(function () {
    var node = volumeInput.current
    if (node === null || node === undefined) return
    var onInput = function () {
      var next = parseInt(node.value, 10)
      if (isNaN(next)) return
      setVolume(next)
      writeNotifyPref(NOTIFY_VOLUME_KEY, String(next))
    }
    node.addEventListener('input', onInput)
    return function () {
      node.removeEventListener('input', onInput)
    }
  }, [])

  return h('div', { className: 'bwts-card' },
    h('div', { className: 'bwts-cardhead' },
      h('div', { className: 'bwts-cardtitle' }, t('chime.title')),
      h('div', { className: 'bwts-carddesc' }, t('chime.desc'))),
    h('div', { className: 'bwts-chimerow' },
      h('div', { className: 'bwts-chimerowtext' },
        h('div', { className: 'bwts-chimerowtitle' }, t('chime.enabled'))),
      h('button', {
        type: 'button',
        className: 'bwts-switch',
        role: 'switch',
        'aria-checked': enabled ? 'true' : 'false',
        'aria-label': t('chime.enabled'),
        onClick: toggle,
      },
        h('span', {
          className: 'bwts-switch-track',
          'data-on': enabled ? 'true' : undefined,
          'aria-hidden': 'true',
        }, h('span', { className: 'bwts-switch-thumb' })))),
    h('div', { className: 'bwts-chimerow' },
      h('div', { className: 'bwts-chimerowtext' },
        h('div', { className: 'bwts-chimerowtitle' }, t('chime.volume'))),
      h('label', { className: 'bwts-volume', title: t('chime.volume') },
        h('input', {
          ref: volumeInput,
          type: 'range',
          min: '0',
          max: '100',
          step: '1',
          value: String(volume),
          disabled: !enabled,
          'aria-label': t('chime.volume'),
          onChange: function () {},
        }),
        h('span', { className: 'bwts-volume-value' }, String(volume)))))
}

/**
 * The better-webui settings page (id `better-webui-settings`, order 25): one
 * dedicated nav entry between agent-presets and retry. v0.21 起只渲染会话提示音
 * 卡（重试策略已拆去独立包 better-webui-retry），纯客户端、无需 RPC。
 */
function BetterWebuiPage(props) {
  var t = props.t

  return h('div', { className: 'bwts-page' },
    h('h2', { className: 'bwts-title' }, t('settings.title')),
    h('p', { className: 'bwts-intro' }, t('settings.desc')),
    h(ChimeCard, { t: t }))
}

exports.inject = ['slots', 'locale']

exports.apply = function apply(ctx) {
  if (typeof document !== 'undefined' && document.getElementById('better-webui-settings-style') === null) {
    var style = document.createElement('style')
    style.id = 'better-webui-settings-style'
    style.textContent = CSS
    document.head.append(style)
  }

  ctx.effect(function () { return ctx.locale.register(NS, DICT) }, 'better-webui-settings: dictionaries')

  ctx.slots.inject('settings.section', function () {
    // better-webui 偏好页：只含会话提示音（order 25，agent-preset 之后）。
    ctx.slots.register({
      name: 'settings.section',
      id: 'better-webui-settings',
      order: 25,
      label: function () { return ctx.locale.bind(NS)('settings.title') },
      locale: NS,
    }, BetterWebuiPage)
  })
}

return module.exports;
} });
