window.__ModuleLoader__.load({ id: '@better-webui/better-webui', factory: (require) => {
var module = { exports: {} };
var exports = module.exports;
Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/**
 * better-webui browser half source. build.mjs wraps this file into the
 * `window.__ModuleLoader__.load` factory envelope emitted as lib/client.js.
 *
 * One contribution (additive — no native surface is replaced):
 * - `sidebar.footer.action`: one quiet archive icon aligned with the
 *   Settings row. The native UI can archive a session but offers no
 *   viewing, restore, or delete surface for archived sessions; this popover
 *   is that surface. Rows show each archived session (title, workspace,
 *   time); every row offers restore-to-sidebar and a two-step-confirm
 *   permanent delete. Rows whose session no longer exists anywhere are
 *   greyed with a marker, and a purge control clears those dead records.
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

var DICT = {
  zh: {
    'archive.title': '归档会话',
    'archive.empty': '没有归档会话',
    'archive.count': '{n} 个会话',
    'archive.hint': '↺ 恢复到侧栏 · 🗑 彻底删除（两步确认）',
    'archive.dead': '会话已删',
    'archive.purge': '清除失效记录',
    'archive.purgeConfirm': '再次点击清除',
    'restore': '恢复',
    'destroy': '彻底删除',
    'destroyConfirm': '再次点击以彻底删除',
    'untitled': '无标题',
    'toast.restored': '已恢复，会话回到侧栏',
    'toast.destroyed': '已彻底删除',
    'toast.failed': '操作失败',
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
    'restore': 'Restore',
    'destroy': 'Delete forever',
    'destroyConfirm': 'Click again to delete forever',
    'untitled': 'Untitled',
    'toast.restored': 'Restored; the session is back in the sidebar',
    'toast.destroyed': 'Deleted permanently',
    'toast.failed': 'Action failed',
    'time.now': 'just now',
    'time.minutes': '{n} min ago',
    'time.hours': '{n} h ago',
    'time.days': '{n} d ago',
  },
}

var CSS = [
  /* footer tool — pixel-aligned with the native Settings trigger row
     (34px compact row, 12px radius, transparent resting background,
     label-primary icon; rail keeps the 36px circle rhythm) */
  '.bwt-tools{display:flex;flex-direction:column;align-items:center;gap:2px;}',
  '.bwt-tools[data-wide]{flex-direction:row;align-items:center;gap:2px;height:34px;margin:4px -4px 4px;padding:0 6px 0 10px;box-sizing:border-box;}',
  '.bwt-tool{position:relative;display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;padding:0;border:none;border-radius:50%;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;}',
  '.bwt-tools[data-wide] .bwt-tool{width:28px;height:28px;border-radius:12px;}',
  '.bwt-tool:hover,.bwt-tool[data-open]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',
  '.bwt-badge{position:absolute;top:1px;right:1px;min-width:14px;height:14px;padding:0 3px;border-radius:7px;background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-inverted,#fff);font-size:10px;line-height:14px;font-weight:600;}',

  /* popover and rows */
  '.bwt-pop{position:fixed;display:flex;flex-direction:column;width:264px;max-height:320px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-overlay);box-shadow:0 8px 24px rgba(0,0,0,.16);z-index:900;overflow:hidden;}',
  '.bwt-pop-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px 6px;font-size:12px;color:var(--dsw-alias-label-caption);}',
  '.bwt-pop-list{overflow:auto;padding:0 4px 4px;}',
  '.bwt-row{display:flex;align-items:center;gap:4px;padding:4px 8px;border-radius:8px;}',
  '.bwt-row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;}',
  '.bwt-row-title{font-size:13px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '.bwt-row-sub{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '.bwt-row[data-dead]{opacity:.45;}',
  '.bwt-row-actions{display:flex;align-items:center;}',
  '.bwt-action{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:5px;border:none;border-radius:26px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;}',
  '.bwt-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',
  '.bwt-action[data-danger]{color:var(--dsw-alias-state-error-primary);}',
  '.bwt-action[data-danger]:hover{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);}',
  '.bwt-empty{padding:16px 12px;font-size:12px;color:var(--dsw-alias-label-tertiary);text-align:center;}',
  '.bwt-hint{padding:6px 12px 8px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption);border-top:1px solid var(--dsw-alias-border-l2);display:flex;align-items:center;justify-content:space-between;gap:8px;}',
  '.bwt-purge{border:none;background:transparent;padding:2px 4px;border-radius:6px;font-size:11px;color:var(--dsw-alias-label-tertiary);cursor:pointer;white-space:nowrap;}',
  '.bwt-purge:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',

  /* status toast */
  '.bwt-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);display:flex;align-items:center;gap:10px;max-width:70vw;padding:10px 10px 10px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-overlay);box-shadow:0 8px 24px rgba(0,0,0,.18);color:var(--dsw-alias-label-primary);font-size:13px;z-index:1000;}',
  '.bwt-toast-icon{display:inline-flex;color:var(--dsw-alias-label-tertiary);}',
  '.bwt-toast-text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '.bwt-toast-close{border:none;background:transparent;padding:4px;color:var(--dsw-alias-label-tertiary);cursor:pointer;display:inline-flex;}',
  '.bwt-toast-close:hover{color:var(--dsw-alias-label-primary);}',
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

/**
 * Sidebar-foot archive tool: one quiet icon whose popover is the native
 * archive set's missing management surface — view, restore, two-step
 * permanent delete, and dead-record purge.
 */
function SidebarArchiveAction(props) {
  var wide = props.wide
  var api = props.api
  var t = props.t
  var useWorkspaces = props.useWorkspaces
  var useSessions = props.useSessions

  // Framework-hook reads: stable projections only (ids array, items, byId).
  var archivedIds = useWorkspaces(function (state) { return state.archivedSessionIds })
  var workspaceItems = useWorkspaces(function (state) { return state.items })
  var byId = useSessions(function (list) { return list.byId })

  var openState = useState(false)
  var open = openState[0]
  var setOpen = openState[1]
  var recordsState = useState([])
  var records = recordsState[0]
  var setRecords = recordsState[1]
  var destroyArmState = useState(null)
  var destroyArm = destroyArmState[0]
  var setDestroyArm = destroyArmState[1]
  var purgeArmedState = useState(false)
  var purgeArmed = purgeArmedState[0]
  var setPurgeArmed = purgeArmedState[1]
  var toastState = useState(null)
  var toast = toastState[0]
  var setToast = toastState[1]
  var anchorState = useState(null)
  var anchor = anchorState[0]
  var setAnchor = anchorState[1]
  var toolRef = useRef(null)
  var toastTimer = useRef(null)
  var destroyTimer = useRef(null)
  var purgeTimer = useRef(null)

  var reload = function () {
    api.listTrash().then(setRecords, function (error) {
      reportError('listTrash', error)
      setRecords([])
    })
  }

  useEffect(function () { reload() }, [])
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

  var toggle = function () {
    var next = !open
    if (next && toolRef.current !== null) {
      var rect = toolRef.current.getBoundingClientRect()
      setAnchor({ left: rect.left, bottom: window.innerHeight - rect.top + 8 })
      reload()
    }
    setOpen(next)
    setDestroyArm(null)
    setPurgeArmed(false)
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
      .then(function () { afterAction('destroyed') })
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

  /* rows: the archive set is the list; legacy trash records join in so
     sessions moved by the retired delete flow stay reachable. */
  var ids = []
  var seen = {}
  var push = function (id) { if (!seen[id]) { seen[id] = true; ids.push(id) } }
  if (Array.isArray(archivedIds)) for (var i = 0; i < archivedIds.length; i++) push(archivedIds[i])
  for (var j = 0; j < records.length; j++) push(records[j].sessionId)

  var hasDead = false
  var rows = ids.map(function (sessionId) {
    var summary = byId === undefined ? undefined : byId[sessionId]
    var record = records.find(function (candidate) { return candidate.sessionId === sessionId })
    var dead = summary === undefined && record === undefined
    if (dead) hasDead = true
    var workspace = workspaceItems === undefined ? undefined : workspaceItems.find(function (w) {
      return w.sessionIds !== undefined && w.sessionIds.indexOf(sessionId) !== -1
    })
    var label = dead ? t('archive.dead')
      : summary !== undefined ? (summary.displayTitle || summary.title || t('untitled'))
        : (record.title || t('untitled'))
    var sub = dead ? sessionId.slice(0, 13) + '…' : [
      workspace !== undefined ? (workspace.title || cwdBasename(workspace.cwd)) : (record !== undefined ? cwdBasename(record.cwd) : ''),
      summary !== undefined && summary.updatedAt !== undefined ? relativeTime(summary.updatedAt, t)
        : (record !== undefined ? relativeTime(record.trashedAt, t) : ''),
    ].filter(function (part) { return part !== '' }).join(' · ')
    var cwd = workspace !== undefined ? workspace.cwd : (record !== undefined ? record.cwd : '')
    return { sessionId: sessionId, label: label, sub: sub, dead: dead, cwd: cwd }
  })

  var popover = null
  if (open && anchor !== null) {
    var body = null
    if (rows.length === 0) {
      body = h('div', { className: 'bwt-empty' }, t('archive.empty'))
    } else {
      body = h('div', { className: 'bwt-pop-list' },
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
                    onClick: function () { destroyRow(row) },
                  }, h(P.IconCheckOutline16, { size: 14 })))
                : h(P.Tooltip, { label: t('restore'), side: 'top' },
                  h('button', {
                    type: 'button',
                    className: 'bwt-action',
                    'aria-label': t('restore'),
                    onClick: function () { restoreRow(row) },
                  }, h(P.IconRefreshOutline16, { size: 14 }))),
              h(P.Tooltip, { label: t('destroy'), side: 'top' },
                h('button', {
                  type: 'button',
                  className: 'bwt-action',
                  'data-danger': 'true',
                  'aria-label': t('destroy'),
                  onClick: function () { armDestroy(row.sessionId) },
                }, h(P.IconTrashOutline16, { size: 14 })))))
        }))
    }
    popover = ReactDOM.createPortal(
      h('div', { className: 'bwt-pop', style: { left: anchor.left + 'px', bottom: anchor.bottom + 'px' } },
        h('div', { className: 'bwt-pop-head' },
          h('span', null, t('archive.title')),
          rows.length > 0 ? h('span', null, t('archive.count', { n: rows.length })) : null),
        body,
        h('div', { className: 'bwt-hint' },
          h('span', null, t('archive.hint')),
          hasDead ? h('button', {
            type: 'button',
            className: 'bwt-purge',
            onClick: purgeDead,
          }, purgeArmed ? t('archive.purgeConfirm') : t('archive.purge')) : null)),
      document.body)
  }

  var toastNode = null
  if (toast !== null) {
    var text = toast.kind === 'restored' ? t('toast.restored')
      : toast.kind === 'destroyed' ? t('toast.destroyed')
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

  return h('div', { className: 'bwt-tools', 'data-wide': wide ? 'true' : undefined },
    h(P.Tooltip, { label: t('archive.title'), side: 'top', disabled: wide },
      h('button', {
        type: 'button',
        ref: toolRef,
        className: 'bwt-tool',
        'data-open': open ? 'true' : undefined,
        'aria-label': t('archive.title'),
        'aria-expanded': open,
        onClick: toggle,
      },
        h(P.IconArchiveOutline20, { size: wide ? 16 : 18 }),
        rows.length > 0 ? h('span', { className: 'bwt-badge' }, String(rows.length)) : null)),
    popover,
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
    listTrash: function () { return unwrap('listTrash', {}).then(function (value) { return value.items }) },
    restore: function (sessionId) { return unwrap('restore', { sessionId: sessionId }) },
    destroy: function (sessionId) { return unwrap('destroy', { sessionId: sessionId }) },
    purge: function () { return unwrap('purge', {}) },
    refreshSessions: function () { return ctx.sessions.refresh() },
  }

  ctx.slots.inject('sidebar.footer.action', function () {
    return ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'better-webui-archive',
      locale: NS,
      inject: function () { return { api: api } },
    }, SidebarArchiveAction)
  })
}

return module.exports;
} });
