/**
 * better-webui model sampling parameters browser half source. build-package
 * wraps this file into the `window.__ModuleLoader__.load` factory envelope
 * emitted as lib/client.js.
 *
 * One additive contribution — no native surface is replaced:
 * `conversation.input.right` (the right end of the composer tool row, before
 * the send button): a compact, always-visible **temperature input box** (not a
 * slider) plus a caret that opens a small panel with the full configuration:
 *   - temperature enable toggle + numeric input (0–2)
 *   - logprobs / penalty — visible but marked 暂不支持（等上游）: the harness
 *     request vocabulary and both adapters have no field for them, and the
 *     pi-ai `samplingParams` passthrough awaits dsh-llm-pi-ai adoption (see
 *     docs/design.md §11)
 *   - mode: 持久化 (persist, survives restart) / 热调 (hot, current run only)
 *   - 应用 / 恢复默认
 *
 * Semantics: the input edits the GLOBAL default temperature; each NEW session
 * pins it on its first request, and the value stays fixed within a session
 * (enforced host-side in src/host.js). The control talks to the host through
 * the `/better-webui-modelparams` RPC channel (ping / read / apply / reset).
 */

var React = require('react')
var h = React.createElement
var useState = React.useState
var useEffect = React.useEffect
var useRef = React.useRef

var NS = 'better-webui-modelparams'
/** Wire version this client expects; must match WIRE_VERSION in src/host.js. */
var WIRE = 1
/** RPC channel; must match CHANNEL in src/host.js. */
var CHANNEL = '/better-webui-modelparams'

/** DSH/pi-ai default temperature (mirrors DEFAULT_TEMPERATURE in src/host.js). */
var DEFAULTS = { enabled: false, temperature: 1.0, mode: 'persist' }

var DICT = {
  zh: {
    'ctl.title': '模型采样参数',
    'ctl.desc': '温度默认值：每个新会话生效，会话内固定。',
    'ctl.stale': '宿主插件是旧版本，请重启 dsh web 后再操作',

    'temp.enabled': '覆盖温度',
    'temp.label': '温度',
    'temp.hint': '0–2，数值输入；留空/关闭则跟随模型默认',

    'unsupported.tag': '暂不支持（等上游）',
    'logprob.label': 'logprobs',
    'penalty.label': 'penalty',

    'mode.title': '生效方式',
    'mode.persist': '持久化',
    'mode.hot': '热调',
    'mode.persistHint': '写入配置，长期生效',
    'mode.hotHint': '本次运行生效，重启后清除',

    'apply': '应用',
    'reset': '恢复默认',
    'applied': '已应用',
    'resetOk': '已恢复默认',
    'failed': '操作失败',
    'loading': '读取中…',
  },
  en: {
    'ctl.title': 'Model sampling',
    'ctl.desc': 'Temperature default: applies to each new session, fixed within a session.',
    'ctl.stale': 'Host plugin is an old version — restart dsh web before acting',

    'temp.enabled': 'Override temperature',
    'temp.label': 'Temperature',
    'temp.hint': '0–2, numeric input; off/blank follows the model default',

    'unsupported.tag': 'not supported yet (awaiting upstream)',
    'logprob.label': 'logprobs',
    'penalty.label': 'penalty',

    'mode.title': 'Apply mode',
    'mode.persist': 'Persist',
    'mode.hot': 'Hot',
    'mode.persistHint': 'written to config, survives restarts',
    'mode.hotHint': 'current run only, cleared on restart',

    'apply': 'Apply',
    'reset': 'Reset',
    'applied': 'Applied',
    'resetOk': 'Reset to defaults',
    'failed': 'Operation failed',
    'loading': 'Loading…',
  },
}

var CSS = [
  /* compact tool-row temperature input box (one-row height budget) */
  '.bwm-anchor{position:relative;display:inline-flex;align-items:center;height:32px;}',
  '.bwm-field{display:inline-flex;align-items:center;gap:4px;height:32px;padding:0 6px 0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);}',
  '.bwm-field[data-on=true]{border-color:var(--dsw-alias-brand-primary);}',
  '.bwm-label{flex:none;font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary);white-space:nowrap;}',
  '.bwm-input{flex:none;width:48px;box-sizing:border-box;padding:2px 4px;font-size:12px;line-height:18px;text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;}',
  '.bwm-input:focus{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:1px;}',
  '.bwm-input:disabled{opacity:.4;cursor:default;}',
  '.bwm-caret{flex:none;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;border-radius:6px;}',
  '.bwm-caret:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',
  '.bwm-backdrop{position:fixed;inset:0;z-index:9990;background:transparent;}',

  /* popover panel */
  '.bwm-pop{position:absolute;bottom:calc(100% + 10px);right:0;z-index:9991;width:300px;max-width:calc(100vw - 24px);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:10px;color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.5;box-shadow:0 10px 34px rgba(0,0,0,.3);}',
  '.bwm-pop-title{font-size:13px;font-weight:600;line-height:20px;}',
  '.bwm-pop-desc{font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary);}',
  '.bwm-stale{padding:6px 10px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);}',
  '.bwm-divider{border-top:1px solid var(--dsw-alias-border-l1);}',
  '.bwm-row{display:flex;align-items:center;gap:8px;width:100%;}',
  '.bwm-rowtitle{flex:1;min-width:0;font-weight:500;}',
  '.bwm-hint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);}',
  '.bwm-check{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--dsw-alias-label-secondary);cursor:pointer;}',
  '.bwm-check input{accent-color:var(--dsw-alias-brand-primary);width:13px;height:13px;margin:0;cursor:pointer;}',
  '.bwm-unsupported{display:flex;align-items:center;gap:8px;width:100%;opacity:.55;}',
  '.bwm-unsupported .bwm-rowtitle{color:var(--dsw-alias-label-tertiary);}',
  '.bwm-tag{flex:none;font-size:11px;line-height:16px;color:var(--dsw-alias-state-warning-primary);white-space:nowrap;}',
  '.bwm-mode{display:inline-flex;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;overflow:hidden;flex:none;}',
  '.bwm-mode button{border:0;background:transparent;color:var(--dsw-alias-label-secondary);padding:3px 10px;cursor:pointer;font-size:11px;line-height:18px;}',
  '.bwm-mode button.on{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:500;}',
  '.bwm-actions{display:flex;gap:8px;}',
  '.bwm-actions button{flex:1;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 12px;cursor:pointer;font-size:12px;}',
  '.bwm-actions button:hover{background:var(--dsw-alias-interactive-bg-hover);}',
  '.bwm-actions button.primary{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);}',
  '.bwm-actions button:disabled{opacity:.5;cursor:default;}',
  '.bwm-status{min-height:16px;font-size:11px;opacity:.8;white-space:pre-wrap;word-break:break-all;color:var(--dsw-alias-label-secondary);}',
].join('\n')

/** Diagnostics for browser devtools when a host call fails. */
function reportError(scope, error) {
  var message = error instanceof Error ? error.message : String(error)
  console.error('better-webui-modelparams: ' + scope + ' failed: ' + message)
  return message
}

/**
 * The popover panel: full model-sampling configuration. temperature is an
 * input box (0–2) with an enable toggle; logprobs / penalty are visible but
 * marked unsupported (awaiting upstream); mode persist/hot; apply + reset.
 */
function SamplingPanel(props) {
  var t = props.t
  var api = props.api
  var onClose = props.onClose

  var cfgState = useState(function () { return { ...DEFAULTS } })
  var cfg = cfgState[0]
  var setCfg = cfgState[1]
  var staleState = useState(false)
  var stale = staleState[0]
  var setStale = staleState[1]
  var busyState = useState(false)
  var busy = busyState[0]
  var setBusy = busyState[1]
  var statusState = useState(null)
  var status = statusState[0]
  var setStatus = statusState[1]

  var load = function () {
    api.ping().then(function (v) {
      var hostStale = v !== WIRE
      setStale(hostStale)
      if (hostStale) return
      return api.read().then(function (config) {
        setCfg({ ...DEFAULTS, ...config })
      })
    }, function (error) {
      reportError('read', error)
      setStale(true)
    })
  }

  useEffect(function () { load() }, [])

  var setField = function (key) {
    return function (event) {
      var next = key === 'enabled'
        ? event.target.checked
        : key === 'mode'
          ? event.target.getAttribute('data-mode')
          : event.target.value
      setCfg({ ...cfg, [key]: next })
      if (status !== null) setStatus(null)
    }
  }

  var setTempInput = function (event) {
    var raw = event.target.value
    var parsed = parseFloat(raw)
    setCfg({ ...cfg, temperature: raw === '' || isNaN(parsed) ? raw : parsed })
    if (status !== null) setStatus(null)
  }

  var apply = function () {
    var payload = {
      enabled: cfg.enabled === true,
      temperature: Number(cfg.temperature),
      mode: cfg.mode === 'hot' ? 'hot' : 'persist',
    }
    if (!Number.isFinite(payload.temperature)) {
      setStatus({ kind: 'error', message: t('failed') + ' · temperature' })
      return
    }
    setBusy(true)
    setStatus(null)
    api.apply(payload).then(function () {
      setBusy(false)
      setStatus({ kind: 'ok', message: t('applied') })
      return api.read().then(function (config) {
        setCfg({ ...DEFAULTS, ...config })
      })
    }, function (error) {
      setBusy(false)
      setStatus({ kind: 'error', message: t('failed') + ' · ' + reportError('apply', error) })
    })
  }

  var reset = function () {
    setBusy(true)
    setStatus(null)
    api.reset().then(function () {
      setBusy(false)
      setStatus({ kind: 'ok', message: t('resetOk') })
      return api.read().then(function (config) {
        setCfg({ ...DEFAULTS, ...config })
      })
    }, function (error) {
      setBusy(false)
      setStatus({ kind: 'error', message: t('failed') + ' · ' + reportError('reset', error) })
    })
  }

  var tempDisabled = stale || busy || cfg.enabled !== true

  return h('div', { className: 'bwm-pop' },
    h('div', { className: 'bwm-pop-title' }, t('ctl.title')),
    h('div', { className: 'bwm-pop-desc' }, t('ctl.desc')),
    stale ? h('div', { className: 'bwm-stale' }, t('ctl.stale')) : null,

    h('div', { className: 'bwm-row' },
      h('label', { className: 'bwm-check' },
        h('input', { type: 'checkbox', checked: cfg.enabled === true, disabled: stale || busy, onChange: setField('enabled') }),
        h('span', null, t('temp.enabled')))),
    h('div', { className: 'bwm-row' },
      h('span', { className: 'bwm-rowtitle' }, t('temp.label')),
      h('input', {
        className: 'bwm-input', type: 'number', min: '0', max: '2', step: '0.05',
        value: String(cfg.temperature), disabled: tempDisabled, onChange: setTempInput,
      })),
    h('div', { className: 'bwm-hint' }, t('temp.hint')),

    h('div', { className: 'bwm-divider' }),
    h('div', { className: 'bwm-unsupported' },
      h('span', { className: 'bwm-rowtitle' }, t('logprob.label')),
      h('span', { className: 'bwm-tag' }, t('unsupported.tag'))),
    h('div', { className: 'bwm-unsupported' },
      h('span', { className: 'bwm-rowtitle' }, t('penalty.label')),
      h('span', { className: 'bwm-tag' }, t('unsupported.tag'))),

    h('div', { className: 'bwm-divider' }),
    h('div', { className: 'bwm-row' },
      h('span', { className: 'bwm-rowtitle' }, t('mode.title')),
      h('div', { className: 'bwm-mode' },
        h('button', {
          type: 'button',
          'data-mode': 'persist',
          className: cfg.mode !== 'hot' ? 'on' : '',
          disabled: stale || busy,
          onClick: setField('mode'),
        }, t('mode.persist')),
        h('button', {
          type: 'button',
          'data-mode': 'hot',
          className: cfg.mode === 'hot' ? 'on' : '',
          disabled: stale || busy,
          onClick: setField('mode'),
        }, t('mode.hot')))),
    h('div', { className: 'bwm-hint' },
      cfg.mode === 'hot' ? t('mode.hotHint') : t('mode.persistHint')),

    h('div', { className: 'bwm-actions' },
      h('button', { type: 'button', className: 'primary', disabled: stale || busy, onClick: apply }, t('apply')),
      h('button', { type: 'button', disabled: stale || busy, onClick: reset }, t('reset'))),
    h('div', {
      className: 'bwm-status',
      style: status !== null && status.kind === 'error' ? { color: 'var(--dsw-alias-state-error-primary)' } : undefined,
    }, status !== null ? status.message : (stale ? '' : t('loading'))))
}

/**
 * The compact always-visible control in `conversation.input.right`: a
 * temperature input box + a caret that toggles the panel. Reads the current
 * config from the host on mount; typing + Enter (or blur) applies directly.
 */
function SamplingControl(props) {
  var t = props.t
  var api = props.api

  var openState = useState(false)
  var open = openState[0]
  var setOpen = openState[1]
  var cfgState = useState(function () { return { ...DEFAULTS } })
  var cfg = cfgState[0]
  var setCfg = cfgState[1]
  var staleState = useState(false)
  var stale = staleState[0]
  var setStale = staleState[1]
  var input = useRef(null)

  var load = function () {
    api.ping().then(function (v) {
      if (v !== WIRE) { setStale(true); return }
      return api.read().then(function (config) {
        setCfg({ ...DEFAULTS, ...config })
      })
    }, function (error) {
      reportError('read', error)
      setStale(true)
    })
  }
  useEffect(function () { load() }, [])

  var commit = function () {
    var parsed = parseFloat(input.current ? input.current.value : '')
    if (isNaN(parsed)) return
    api.apply({ enabled: cfg.enabled === true, temperature: parsed, mode: cfg.mode === 'hot' ? 'hot' : 'persist' })
      .then(function () {
        return api.read().then(function (config) {
          setCfg({ ...DEFAULTS, ...config })
        })
      }, function (error) {
        reportError('apply', error)
      })
  }

  var onKey = function (event) {
    if (event.key === 'Enter') commit()
    if (event.key === 'Escape') setOpen(false)
  }

  return h('div', { className: 'bwm-anchor' },
    h('div', { className: 'bwm-field', 'data-on': cfg.enabled === true ? 'true' : undefined, title: t('ctl.desc') },
      h('span', { className: 'bwm-label' }, t('temp.label')),
      h('input', {
        ref: input,
        className: 'bwm-input',
        type: 'number',
        min: '0',
        max: '2',
        step: '0.05',
        value: String(cfg.temperature),
        disabled: stale,
        'aria-label': t('temp.label'),
        onChange: function (event) {
          var raw = event.target.value
          var parsed = parseFloat(raw)
          setCfg({ ...cfg, temperature: raw === '' || isNaN(parsed) ? raw : parsed })
        },
        onBlur: commit,
        onKeyDown: onKey,
      }),
      h('button', {
        type: 'button',
        className: 'bwm-caret',
        'aria-label': t('ctl.title'),
        'aria-expanded': open ? 'true' : 'false',
        onClick: function () { setOpen(function (v) { return !v }) },
      }, '▾')),
    open ? h('div', { className: 'bwm-backdrop', onClick: function () { setOpen(false) } }) : null,
    open ? h(SamplingPanel, { t: t, api: api, onClose: function () { setOpen(false) } }) : null)
}

exports.inject = ['slots', 'locale', 'connection']

exports.apply = function apply(ctx) {
  if (typeof document !== 'undefined' && document.getElementById('better-webui-modelparams-style') === null) {
    var style = document.createElement('style')
    style.id = 'better-webui-modelparams-style'
    style.textContent = CSS
    document.head.append(style)
  }

  ctx.effect(function () { return ctx.locale.register(NS, DICT) }, 'better-webui-modelparams: dictionaries')
  var t = ctx.locale.bind(NS)

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
    apply: function (cfg) { return unwrap('apply', cfg) },
    reset: function () { return unwrap('reset', {}) },
  }

  ctx.slots.inject('conversation.input.right', function () {
    return ctx.slots.register({
      name: 'conversation.input.right',
      id: 'better-webui-modelparams',
      order: 0,
      locale: NS,
    }, function (props) {
      return h(SamplingControl, { t: props && props.t ? props.t : t, api: api })
    })
  })
}
