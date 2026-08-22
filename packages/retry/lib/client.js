window.__ModuleLoader__.load({ id: "@blueriverlhr/dsh-better-webui-retry", factory: (require) => {
var module = { exports: {} };
var exports = module.exports;
Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/**
 * better-webui retry browser half source. build-package wraps this file into
 * the `window.__ModuleLoader__.load` factory envelope emitted as lib/client.js.
 *
 * One additive contribution — a `settings.section` page inside the sidebar nav
 * (id `better-webui-retry`, order 26): the dedicated「重试策略」设置页. The host
 * half provisions a global default retry policy (max retries + exponential
 * backoff) into every llm-pi-ai provider that does not declare its own; this
 * page edits that policy and lists each provider's ownership status.
 *
 * The retry page talks to the host through the `/better-webui-retry` RPC
 * channel (ping / read / apply). Split out of the settings package (v0.21) so
 * the settings page and the retry policy stay decoupled.
 */

var React = require('react')
var h = React.createElement
var useState = React.useState
var useEffect = React.useEffect

var NS = 'better-webui-retry'
/** Wire version this client expects; must match WIRE_VERSION in src/host.js. */
var WIRE = 1
/** RPC channel; must match CHANNEL in src/host.js. */
var CHANNEL = '/better-webui-retry'

/** DSH built-in retry policy (mirrors DEFAULT_RETRY_POLICY in src/host.js). */
var DEFAULTS = { maxRetries: 2, initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 }

var DICT = {
  zh: {
    'retry.pageTitle': '重试策略',
    'retry.pageDesc': '模型请求失败后的重试次数与指数退避（写入 llm-pi-ai 各 provider）。默认仅 2 次，可在此调大。',
    'retry.stale': '宿主插件是旧版本，请重启 dsh web 后再操作',
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
  },
  en: {
    'retry.pageTitle': 'Retry policy',
    'retry.pageDesc': 'Retry count and exponential backoff for failed model requests (written into every llm-pi-ai provider). Default is only 2 — raise it here.',
    'retry.stale': 'Host plugin is an old version — restart dsh web before acting',
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
  },
}

var CSS = [
  /* dedicated retry settings page — one nav page right after the better-webui
     settings page (mirrors the shipped section chrome: 18px title, 13px intro,
     720px). */
  '.bwts-page{display:flex;flex-direction:column;gap:16px;max-width:720px;color:var(--dsw-alias-label-primary);}',
  '.bwts-title{margin:0;font-size:18px;font-weight:600;}',
  '.bwts-intro{margin:0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-tertiary);}',
  '.bwts-stale{padding:8px 12px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);}',

  /* control card — the page header already carries the title + description,
     so the card is a bare control panel (no repeated cardhead). */
  '.bwts-card{display:flex;flex-direction:column;gap:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);padding:16px;}',
  '.bwts-cardhead{display:flex;flex-direction:column;gap:2px;}',
  '.bwts-cardtitle{font-size:15px;line-height:22px;font-weight:600;}',

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
].join('\n')

/** Diagnostics for browser devtools when a host call fails. */
function reportError(scope, error) {
  var message = error instanceof Error ? error.message : String(error)
  console.error('better-webui-retry: ' + scope + ' failed: ' + message)
  return message
}

/**
 * Retry-policy card: four number fields (maxRetries, initialDelayMs,
 * maxDelayMs, jitterRatio), an Apply button that provisions the global policy
 * into every llm-pi-ai provider via the host RPC, a Restore-defaults button,
 * and a per-provider status list. The fields initialize from the host `read`
 * result; a stale host (wire mismatch) disables the controls. The page header
 * already carries the title + description, so the card renders no head of its
 * own — just the controls and the provider list.
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
    stale ? h('div', { className: 'bwts-stale' }, t('retry.stale')) : null,
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
 * The dedicated retry-policy page (id `better-webui-retry`, order 26, right
 * after the better-webui settings page): the page header carries the single
 * title + description, and the card below is a bare control panel. Talks to
 * the host through the `/better-webui-retry` RPC channel.
 */
function RetryPage(props) {
  var api = props.api
  var t = props.t

  return h('div', { className: 'bwts-page' },
    h('h2', { className: 'bwts-title' }, t('retry.pageTitle')),
    h('p', { className: 'bwts-intro' }, t('retry.pageDesc')),
    h(RetryCard, { t: t, api: api }))
}

exports.inject = ['slots', 'locale', 'connection']

exports.apply = function apply(ctx) {
  if (typeof document !== 'undefined' && document.getElementById('better-webui-retry-style') === null) {
    var style = document.createElement('style')
    style.id = 'better-webui-retry-style'
    style.textContent = CSS
    document.head.append(style)
  }

  ctx.effect(function () { return ctx.locale.register(NS, DICT) }, 'better-webui-retry: dictionaries')

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
    // 重试策略独立页：紧接 better-webui 设置页之后（order 26），独占一页。
    ctx.slots.register({
      name: 'settings.section',
      id: 'better-webui-retry',
      order: 26,
      label: function () { return ctx.locale.bind(NS)('retry.pageTitle') },
      locale: NS,
      inject: function () { return { api: api } },
    }, RetryPage)
  })
}

return module.exports;
} });
