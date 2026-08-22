window.__ModuleLoader__.load({ id: "@blueriverlhr/dsh-better-webui-modelparams", factory: (require) => {
var module = { exports: {} };
var exports = module.exports;
Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/**
 * better-webui model sampling parameters browser half source. build-package
 * wraps this file into the `window.__ModuleLoader__.load` factory envelope
 * emitted as lib/client.js.
 *
 * One additive contribution — no native surface is replaced:
 * `conversation.input.right` (the right end of the composer tool row, before
 * the send button): a single **「超参配置」button**. All editing happens in the
 * popover panel it opens.
 *
 * Panel UX (user ruling):
 *   - temperature: **empty = the system-determined default (shown as the
 *     concrete number in the input placeholder), filled = override**.
 *   - the number input has no up/down spinner arrows — typing only.
 *   - logprobs / penalty — visible but marked 暂不支持: the harness request
 *     vocabulary and both adapters have no field for them, and the pi-ai
 *     `samplingParams` passthrough awaits dsh-llm-pi-ai adoption (see
 *     docs/design.md §11). No per-parameter explanations (advanced settings).
 *   - 恢复默认 clears the stored override back to empty (system default).
 *   - 持久化 / 热调 mode (no explanation text).
 *
 * The control talks to the host through the `/better-webui-modelparams` RPC
 * channel (ping / read / apply / reset). Session pinning (default for new
 * sessions, fixed within a session) is enforced host-side in src/host.js.
 */

var React = require('react')
var h = React.createElement
var useState = React.useState
var useEffect = React.useEffect

var NS = 'better-webui-modelparams'
/** Wire version this client expects; must match WIRE_VERSION in src/host.js. */
var WIRE = 1
/** RPC channel; must match CHANNEL in src/host.js. */
var CHANNEL = '/better-webui-modelparams'

/** The default config: no override (empty temperature → system default), persist mode. */
var DEFAULTS = { temperature: undefined, mode: 'persist', defaultTemperature: 1.0 }

var DICT = {
  zh: {
    'ctl.button': '超参配置',
    'ctl.title': '超参配置',
    'ctl.stale': '宿主插件是旧版本，请重启 dsh web 后再操作',

    'temp.label': 'temperature',

    'unsupported.tag': '暂不支持',
    'unsupported.detail': '当前 dsh 无该参数字段，等上游采用 samplingParams 后可用',
    'logprob.label': 'logprobs',
    'penalty.label': 'penalty',

    'mode.title': '生效方式',
    'mode.persist': '持久化',
    'mode.hot': '热调',

    'apply': '应用',
    'reset': '恢复默认',
    'applied': '已应用',
    'resetOk': '已恢复默认',
    'failed': '操作失败',
    'loading': '读取中…',
  },
  en: {
    'ctl.button': 'Sampling',
    'ctl.title': 'Model sampling',
    'ctl.stale': 'Host plugin is an old version — restart dsh web before acting',

    'temp.label': 'temperature',

    'unsupported.tag': 'unsupported',
    'unsupported.detail': 'No field for this param in current dsh; available once upstream adopts samplingParams',
    'logprob.label': 'logprobs',
    'penalty.label': 'penalty',

    'mode.title': 'Mode',
    'mode.persist': 'Persist',
    'mode.hot': 'Hot',

    'apply': 'Apply',
    'reset': 'Reset',
    'applied': 'Applied',
    'resetOk': 'Reset to defaults',
    'failed': 'Operation failed',
    'loading': 'Loading…',
  },
}

var CSS = [
  /* tool-row button */
  '.bwm-btn{display:inline-flex;align-items:center;height:32px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:12px;line-height:20px;cursor:pointer;white-space:nowrap;}',
  '.bwm-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);}',
  '.bwm-btn[data-active=true]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);}',
  '.bwm-backdrop{position:fixed;inset:0;z-index:9990;background:transparent;}',

  /* popover panel */
  '.bwm-pop{position:absolute;bottom:calc(100% + 10px);right:0;z-index:9991;width:280px;max-width:calc(100vw - 24px);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:10px;color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.5;box-shadow:0 10px 34px rgba(0,0,0,.3);}',
  '.bwm-pop-title{font-size:13px;font-weight:600;line-height:20px;}',
  '.bwm-stale{padding:6px 10px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);}',
  '.bwm-divider{border-top:1px solid var(--dsw-alias-border-l1);}',
  '.bwm-row{display:flex;align-items:center;gap:8px;width:100%;}',
  '.bwm-rowtitle{flex:1;min-width:0;font-weight:500;white-space:nowrap;}',
  '.bwm-input{flex:none;width:72px;box-sizing:border-box;padding:4px 8px;font-size:12px;line-height:18px;text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;-moz-appearance:textfield;}',
  '.bwm-input::-webkit-outer-spin-button,.bwm-input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0;}',
  '.bwm-input::placeholder{color:var(--dsw-alias-label-caption);font-style:normal;}',
  '.bwm-input:focus{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:1px;}',
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
 * Format a temperature for display: keep at most two decimals and always show
 * one (JS String(1.0) would drop the ".0"). "1.0", "0.7", "1.25", "0.0".
 * @param {number|string} x - the temperature value.
 * @returns {string} the display form.
 */
function fmtTemp(x) {
  var n = Number(x)
  if (!Number.isFinite(n)) return String(x)
  var s = n.toFixed(2).replace(/\.?0+$/, '')
  return s.indexOf('.') === -1 ? s + '.0' : s
}

/**
 * The popover panel: temperature input (empty = default, filled = override,
 * placeholder shows the default), unsupported logprobs/penalty rows, mode
 * persist/hot, apply + reset (reset clears the stored override).
 */
function SamplingPanel(props) {
  var t = props.t
  var api = props.api

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

  var setMode = function (event) {
    setCfg({ ...cfg, mode: event.target.getAttribute('data-mode') })
    if (status !== null) setStatus(null)
  }

  var setTemp = function (event) {
    var raw = event.target.value
    var parsed = parseFloat(raw)
    setCfg({ ...cfg, temperature: raw === '' || isNaN(parsed) ? raw : parsed })
    if (status !== null) setStatus(null)
  }

  var apply = function () {
    var raw = cfg.temperature
    var temperature = (typeof raw === 'string' && raw.trim() === '') || raw === null || raw === undefined
      ? null
      : Number(raw)
    if (temperature !== null && !Number.isFinite(temperature)) {
      setStatus({ kind: 'error', message: t('failed') + ' · temperature' })
      return
    }
    setBusy(true)
    setStatus(null)
    api.apply({ temperature: temperature, mode: cfg.mode === 'hot' ? 'hot' : 'persist' }).then(function () {
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

  return h('div', { className: 'bwm-pop' },
    h('div', { className: 'bwm-pop-title' }, t('ctl.title')),
    stale ? h('div', { className: 'bwm-stale' }, t('ctl.stale')) : null,

    h('div', { className: 'bwm-row' },
      h('span', { className: 'bwm-rowtitle' }, t('temp.label')),
      h('input', {
        className: 'bwm-input',
        type: 'number',
        min: '0',
        max: '2',
        step: '0.05',
        placeholder: fmtTemp(cfg.defaultTemperature ?? 1.0),
        value: cfg.temperature === undefined ? '' : fmtTemp(cfg.temperature),
        disabled: stale || busy,
        onChange: setTemp,
      })),

    h('div', { className: 'bwm-divider' }),
    h('div', { className: 'bwm-unsupported', title: t('unsupported.detail') },
      h('span', { className: 'bwm-rowtitle' }, t('logprob.label')),
      h('span', { className: 'bwm-tag' }, t('unsupported.tag'))),
    h('div', { className: 'bwm-unsupported', title: t('unsupported.detail') },
      h('span', { className: 'bwm-rowtitle' }, t('penalty.label')),
      h('span', { className: 'bwm-tag' }, t('unsupported.tag'))),

    h('div', { className: 'bwm-divider' }),
    h('div', { className: 'bwm-row' },
      h('span', { className: 'bwm-rowtitle' }, t('mode.title')),
      h('div', { className: 'bwm-mode' },
        h('button', {
          type: 'button', 'data-mode': 'persist', className: cfg.mode !== 'hot' ? 'on' : '',
          disabled: stale || busy, onClick: setMode,
        }, t('mode.persist')),
        h('button', {
          type: 'button', 'data-mode': 'hot', className: cfg.mode === 'hot' ? 'on' : '',
          disabled: stale || busy, onClick: setMode,
        }, t('mode.hot')))),

    h('div', { className: 'bwm-actions' },
      h('button', { type: 'button', className: 'primary', disabled: stale || busy, onClick: apply }, t('apply')),
      h('button', { type: 'button', disabled: stale || busy, onClick: reset }, t('reset'))),
    h('div', {
      className: 'bwm-status',
      style: status !== null && status.kind === 'error' ? { color: 'var(--dsw-alias-state-error-primary)' } : undefined,
    }, status !== null ? status.message : (stale ? '' : t('loading'))))
}

/**
 * The compact always-visible control in `conversation.input.right`: a single
 * 「超参配置」button that toggles the panel. Highlighted when a temperature
 * override is active. All editing happens inside the panel.
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

  var active = cfg.temperature !== undefined && cfg.temperature !== null

  return h('div', { className: 'bwm-anchor', style: { position: 'relative' } },
    h('button', {
      type: 'button',
      className: 'bwm-btn',
      'data-active': active ? 'true' : undefined,
      disabled: stale,
      title: t('ctl.title'),
      'aria-expanded': open ? 'true' : 'false',
      onClick: function () { setOpen(function (v) { return !v }) },
    }, t('ctl.button')),
    open ? h('div', { className: 'bwm-backdrop', onClick: function () { setOpen(false) } }) : null,
    open ? h(SamplingPanel, { t: t, api: api }) : null)
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

return module.exports;
} });
