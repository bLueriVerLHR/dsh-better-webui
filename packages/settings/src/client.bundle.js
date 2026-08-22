/**
 * better-webui settings browser half source. build-package wraps this file into
 * the `window.__ModuleLoader__.load` factory envelope emitted as lib/client.js.
 *
 * One additive contribution — no native surface is replaced:
 * - `settings.section` (id `better-webui-settings`): one dedicated settings
 *   page in the sidebar nav, ordered between the agent-preset page and the
 *   archived-sessions page. It hosts the better-webui feature preferences
 *   that used to live scattered across the native settings:
 *     • 重试策略 (retry policy): the global LLM request-retry policy
 *       (maxRetries + exponential backoff) provisioned into every llm-pi-ai
 *       provider through the host half — the "raise the retry count" knob the
 *       native UI never exposed.
 *     • 提示音 (session chime): the on/off switch + volume slider moved out of
 *       the native General settings (the chime package kept only the dock +
 *       audio and reads these same localStorage keys).
 *   Both preferences live under one page so nothing mixes with dsh's own
 *   settings sections.
 *
 * The retry card talks to the host through the `/better-webui-settings` RPC
 * channel (ping / read / apply); the chime card is pure client (localStorage),
 * exactly like the row it replaces.
 */

var React = require('react')
var h = React.createElement
var useState = React.useState
var useEffect = React.useEffect
var useRef = React.useRef

var NS = 'better-webui-settings'
/** Wire version this client expects; must match WIRE_VERSION in src/host.js. */
var WIRE = 1
/** RPC channel; must match CHANNEL in src/host.js. */
var CHANNEL = '/better-webui-settings'

/** DSH built-in retry policy (mirrors DEFAULT_RETRY_POLICY in src/host.js). */
var DEFAULTS = { maxRetries: 2, initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 }

var DICT = {
  zh: {
    'settings.title': 'Better WebUI',
    'settings.desc': '本页面集中管理 Better WebUI 的功能偏好，不混入 dsh 自身设置。',
    'settings.stale': '宿主插件是旧版本，请重启 dsh web 后再操作',

    'retry.title': '重试策略',
    'retry.desc': '模型请求失败后的重试次数与指数退避（写入 llm-pi-ai 各 provider）。默认仅 2 次，可在此调大。',
    'retry.maxRetries': '重试次数',
    'retry.initialDelayMs': '初始延迟 (ms)',
    'retry.maxDelayMs': '最大延迟 (ms)',
    'retry.jitterRatio': '抖动比例',
    'retry.apply': '应用',
    'retry.restore': '恢复默认',
    'retry.applied': '已应用到 {n} 个 provider',
    'retry.skipped': '已跳过 {n} 个手写配置',
    'retry.providers': 'Provider 状态',
    'retry.providerUnset': '未配置（将应用全局默认）',
    'retry.providerSet': '已应用全局策略',
    'retry.providerOurs': '沿用上次应用的策略',
    'retry.providerCustom': '手写配置（不覆盖）',
    'retry.failed': '应用失败',
    'retry.noProviders': '没有可配置的 llm-pi-ai provider',

    'chime.title': '会话提示音',
    'chime.desc': 'Agent 等待输入或完成回合时播放提示音（音量 0 为静音）。',
    'chime.enabled': '启用提示音',
    'chime.volume': '提示音音量',
  },
  en: {
    'settings.title': 'Better WebUI',
    'settings.desc': 'Preference hub for Better WebUI features, kept apart from dsh\'s own settings.',
    'settings.stale': 'Host plugin is an old version — restart dsh web before acting',

    'retry.title': 'Retry policy',
    'retry.desc': 'Retry count and exponential backoff for failed model requests (written into every llm-pi-ai provider). Default is only 2 — raise it here.',
    'retry.maxRetries': 'Max retries',
    'retry.initialDelayMs': 'Initial delay (ms)',
    'retry.maxDelayMs': 'Max delay (ms)',
    'retry.jitterRatio': 'Jitter ratio',
    'retry.apply': 'Apply',
    'retry.restore': 'Restore defaults',
    'retry.applied': 'Applied to {n} provider(s)',
    'retry.skipped': 'Skipped {n} hand-written',
    'retry.providers': 'Provider status',
    'retry.providerUnset': 'unset (will get the global default)',
    'retry.providerSet': 'global policy applied',
    'retry.providerOurs': 'carrying the last-applied policy',
    'retry.providerCustom': 'hand-written (not overwritten)',
    'retry.failed': 'Apply failed',
    'retry.noProviders': 'No llm-pi-ai providers to configure',

    'chime.title': 'Session chime',
    'chime.desc': 'Play a chime when the agent waits for input or finishes a turn (volume 0 mutes).',
    'chime.enabled': 'Enable chime',
    'chime.volume': 'Chime volume',
  },
}

var CSS = [
  /* settings section page — one nav page between agent-presets and archive
     (mirrors the shipped section chrome: 18px title, 13px intro, 720px) */
  '.bwts-page{display:flex;flex-direction:column;gap:16px;max-width:720px;color:var(--dsw-alias-label-primary);}',
  '.bwts-title{margin:0;font-size:18px;font-weight:600;}',
  '.bwts-intro{margin:0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-tertiary);}',
  '.bwts-stale{padding:8px 12px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);}',

  /* feature card */
  '.bwts-card{display:flex;flex-direction:column;gap:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);padding:16px;}',
  '.bwts-cardhead{display:flex;flex-direction:column;gap:2px;}',
  '.bwts-cardtitle{font-size:15px;line-height:22px;font-weight:600;}',
  '.bwts-carddesc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}',

  /* number field grid */
  '.bwts-grid{display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:12px;}',
  '.bwts-field{display:flex;flex-direction:column;gap:4px;}',
  '.bwts-label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);}',
  '.bwts-input{width:100%;box-sizing:border-box;padding:6px 10px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;font-variant-numeric:tabular-nums;}',
  '.bwts-input:focus{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:1px;}',
  '.bwts-input:disabled{opacity:.5;cursor:default;}',

  /* apply + restore buttons */
  '.bwts-actions{display:flex;align-items:center;gap:8px;}',
  '.bwts-btn{border:none;border-radius:8px;padding:6px 14px;font-size:13px;line-height:20px;cursor:pointer;color:#fff;background:var(--dsw-alias-state-business-primary);}',
  '.bwts-btn:disabled{opacity:.5;cursor:default;}',
  '.bwts-btn[data-ghost]{color:var(--dsw-alias-label-secondary);background:transparent;border:1px solid var(--dsw-alias-border-l2);}',
  '.bwts-btn[data-ghost]:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',
  '.bwts-result{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}',
  '.bwts-result[data-error]{color:var(--dsw-alias-state-error-primary);}',

  /* provider status list */
  '.bwts-plist{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden;}',
  '.bwts-prow{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);font-size:12px;line-height:18px;}',
  '.bwts-prow:last-child{border-bottom:none;}',
  '.bwts-proute{flex:1;min-width:0;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '.bwts-pstatus{flex:none;color:var(--dsw-alias-label-tertiary);}',
  '.bwts-pstatus[data-custom]{color:var(--dsw-alias-state-warning-primary);}',
  '.bwts-pstatus[data-unset]{color:var(--dsw-alias-label-caption);}',

  /* chime card: switch + volume (reuses the General-row anatomy) */
  '.bwts-chimerow{display:flex;align-items:center;gap:16px;width:100%;}',
  '.bwts-chimerowtext{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}',
  '.bwts-chimerowtitle{font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary);}',
  '.bwts-chimerowdesc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}',
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

/** Diagnostics for browser devtools when a host call fails. */
function reportError(scope, error) {
  var message = error instanceof Error ? error.message : String(error)
  console.error('better-webui-settings: ' + scope + ' failed: ' + message)
  return message
}

/**
 * Retry-policy card: four number fields (maxRetries, initialDelayMs,
 * maxDelayMs, jitterRatio), an Apply button that provisions the global policy
 * into every llm-pi-ai provider via the host RPC, a Restore-defaults button,
 * and a per-provider status list. The fields initialize from the host `read`
 * result; a stale host (wire mismatch) disables the controls.
 */
function RetryCard(props) {
  var t = props.t
  var api = props.api

  var policyState = useState(function () { return { ...DEFAULTS } })
  var policy = policyState[0]
  var setPolicy = policyState[1]
  var providersState = useState([])
  var providers = providersState[0]
  var setProviders = providersState[1]
  var staleState = useState(false)
  var stale = staleState[0]
  var setStale = staleState[1]
  var busyState = useState(false)
  var busy = busyState[0]
  var setBusy = busyState[1]
  var resultState = useState(null)
  var result = resultState[0]
  var setResult = resultState[1]

  var load = function () {
    api.ping().then(function (v) {
      var hostStale = v !== WIRE
      setStale(hostStale)
      if (hostStale) return
      return api.read().then(function (view) {
        setPolicy({ ...DEFAULTS, ...view.policy })
        setProviders(Array.isArray(view.providers) ? view.providers : [])
      })
    }, function (error) {
      reportError('read', error)
      setStale(true)
    })
  }

  useEffect(function () { load() }, [])

  var setField = function (key) {
    return function (event) {
      setPolicy({ ...policy, [key]: event.target.value })
      if (result !== null) setResult(null)
    }
  }

  var applyNow = function () {
    setBusy(true)
    setResult(null)
    api.apply(policy).then(function (value) {
      // Refresh providers + policy from the host (it may clamp values, and
      // provider status changes unset → set after a successful apply).
      return api.read().then(function (view) {
        setBusy(false)
        setPolicy({ ...DEFAULTS, ...view.policy })
        setProviders(Array.isArray(view.providers) ? view.providers : [])
        setResult({ kind: 'ok', applied: value.updated.length, skipped: value.skipped.length })
      })
    }, function (error) {
      setBusy(false)
      setResult({ kind: 'error', message: reportError('apply', error) })
    })
  }

  var restoreNow = function () {
    setPolicy({ ...DEFAULTS })
    setResult(null)
  }

  var statusText = function (status) {
    if (status === 'unset') return t('retry.providerUnset')
    if (status === 'set') return t('retry.providerSet')
    if (status === 'ours') return t('retry.providerOurs')
    return t('retry.providerCustom')
  }

  return h('div', { className: 'bwts-card' },
    h('div', { className: 'bwts-cardhead' },
      h('div', { className: 'bwts-cardtitle' }, t('retry.title')),
      h('div', { className: 'bwts-carddesc' }, t('retry.desc'))),
    stale ? h('div', { className: 'bwts-stale' }, t('settings.stale')) : null,
    h('div', { className: 'bwts-grid' },
      h('div', { className: 'bwts-field' },
        h('label', { className: 'bwts-label' }, t('retry.maxRetries')),
        h('input', {
          className: 'bwts-input', type: 'number', min: '0', step: '1',
          value: policy.maxRetries, disabled: stale, onChange: setField('maxRetries'),
        })),
      h('div', { className: 'bwts-field' },
        h('label', { className: 'bwts-label' }, t('retry.jitterRatio')),
        h('input', {
          className: 'bwts-input', type: 'number', min: '0', max: '1', step: '0.01',
          value: policy.jitterRatio, disabled: stale, onChange: setField('jitterRatio'),
        })),
      h('div', { className: 'bwts-field' },
        h('label', { className: 'bwts-label' }, t('retry.initialDelayMs')),
        h('input', {
          className: 'bwts-input', type: 'number', min: '0', step: '100',
          value: policy.initialDelayMs, disabled: stale, onChange: setField('initialDelayMs'),
        })),
      h('div', { className: 'bwts-field' },
        h('label', { className: 'bwts-label' }, t('retry.maxDelayMs')),
        h('input', {
          className: 'bwts-input', type: 'number', min: '0', step: '1000',
          value: policy.maxDelayMs, disabled: stale, onChange: setField('maxDelayMs'),
        }))),
    h('div', { className: 'bwts-actions' },
      h('button', { type: 'button', className: 'bwts-btn', disabled: stale || busy, onClick: applyNow }, t('retry.apply')),
      h('button', { type: 'button', className: 'bwts-btn', 'data-ghost': 'true', disabled: stale, onClick: restoreNow }, t('retry.restore')),
      result !== null ? h('span', {
        className: 'bwts-result',
        'data-error': result.kind === 'error' ? 'true' : undefined,
      }, result.kind === 'ok'
        ? (result.applied > 0 ? t('retry.applied', { n: result.applied }) : '')
          + (result.skipped > 0 ? ' · ' + t('retry.skipped', { n: result.skipped }) : '')
        : t('retry.failed') + ' · ' + result.message) : null),
    h('div', { className: 'bwts-cardhead' },
      h('div', { className: 'bwts-cardtitle', style: { fontSize: '13px' } }, t('retry.providers'))),
    providers.length === 0
      ? h('div', { className: 'bwts-result' }, t('retry.noProviders'))
      : h('div', { className: 'bwts-plist' },
        providers.map(function (p) {
          return h('div', { key: p.route, className: 'bwts-prow' },
            h('span', { className: 'bwts-proute', title: p.route }, p.route),
            h('span', {
              className: 'bwts-pstatus',
              'data-custom': p.status === 'custom' ? 'true' : undefined,
              'data-unset': p.status === 'unset' ? 'true' : undefined,
            }, statusText(p.status)))
        })))
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
        h('div', { className: 'bwts-chimerowtitle' }, t('chime.enabled')),
        h('div', { className: 'bwts-chimerowdesc' }, t('chime.desc'))),
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
        }, h('span', { className: 'bwts-switch-thumb' }))),
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
 * The better-webui settings page: one dedicated nav entry (order 25, between
 * agent-presets and archive). It renders the retry-policy card and the
 * session-chime card. The retry card owns its own stale/busy state, so the
 * shell renders only the page chrome.
 */
function SettingsPage(props) {
  var api = props.api
  var t = props.t

  return h('div', { className: 'bwts-page' },
    h('h2', { className: 'bwts-title' }, t('settings.title')),
    h('p', { className: 'bwts-intro' }, t('settings.desc')),
    h(RetryCard, { t: t, api: api }),
    h(ChimeCard, { t: t }))
}

exports.inject = ['slots', 'locale', 'connection']

exports.apply = function apply(ctx) {
  if (typeof document !== 'undefined' && document.getElementById('better-webui-settings-style') === null) {
    var style = document.createElement('style')
    style.id = 'better-webui-settings-style'
    style.textContent = CSS
    document.head.append(style)
  }

  ctx.effect(function () { return ctx.locale.register(NS, DICT) }, 'better-webui-settings: dictionaries')

  var unwrap = function (method, payload) {
    return ctx.connection.rpc.call(CHANNEL, method, payload).then(function (result) {
      if (result === null || typeof result !== 'object' || result.ok !== true) {
        var message = result !== null && typeof result === 'object'
          && result.error !== undefined && result.error.message !== undefined
          ? String(result.error.message)
          : CHANNEL + '/' + method
        throw new Error(message)
      }
      return result.value
    })
  }
  var api = {
    ping: function () { return unwrap('ping', {}).then(function (value) { return value.v }) },
    read: function () { return unwrap('read', {}) },
    apply: function (policy) { return unwrap('apply', { policy: policy }) },
  }

  ctx.slots.inject('settings.section', function () {
    return ctx.slots.register({
      name: 'settings.section',
      id: 'better-webui-settings',
      // Between the agent-preset page (order 20) and the archive page (order 30).
      order: 25,
      label: function () { return ctx.locale.bind(NS)('settings.title') },
      locale: NS,
      inject: function () { return { api: api } },
    }, SettingsPage)
  })
}
