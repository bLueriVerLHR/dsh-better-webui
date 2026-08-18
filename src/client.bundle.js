/**
 * better-webui browser half source. build.mjs wraps this file into the
 * `window.__ModuleLoader__.load` factory envelope emitted as lib/client.js.
 *
 * Contributions (all additive — no native surface is replaced, so the native
 * copy/branch icons and tool cards stay exactly as shipped):
 * - `conversation.session.header.actions`: a trash icon on the open session.
 *   First click arms (check/cancel pair, auto-disarm), second click moves the
 *   session into the host trash, navigates to New Session, and offers Undo.
 * - `conversation.chat.user-actions` (harness slot, additive): a retract
 *   button on every user prompt row, next to the native copy icon. Retract =
 *   cancel any run, fork the session before that prompt's turn, open the
 *   child, prefill the composer with the original text, and archive the
 *   source (read-only history stays reachable from the archive viewer).
 * - `sidebar.footer.action`: two quiet icon entries aligned with the Settings
 *   row — a trash bin (count badge, popover with restore / delete-forever)
 *   and an archive viewer (popover listing natively archived sessions; rows
 *   show info, dead ids are greyed, and any row can be moved to the trash;
 *   dead-archive ids can be purged from the registry record). The Undo toast
 *   also lives here.
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

var NS = 'better-webui-trash'

var DICT = {
  zh: {
    'delete.moveToTrash': '移入回收站',
    'delete.confirm': '确认移入回收站',
    'delete.cancel': '取消',
    'trash.title': '回收站',
    'trash.empty': '回收站为空',
    'trash.count': '{n} 个会话',
    'trash.restore': '恢复',
    'trash.destroy': '彻底删除',
    'trash.destroyConfirm': '再次点击以彻底删除',
    'untitled': '无标题',
    'toast.moved': '已移入回收站',
    'toast.undo': '撤销',
    'toast.restoring': '恢复中…',
    'toast.restored': '已恢复',
    'toast.failed': '操作失败',
    'archive.title': '归档会话',
    'archive.empty': '没有归档会话',
    'archive.count': '{n} 个会话',
    'archive.hint': '点击 ↺ 恢复到侧栏；🗑 移入回收站；置灰行的会话已不存在',
    'archive.dead': '会话已删',
    'archive.purge': '清除失效记录',
    'archive.purgeConfirm': '再次点击清除',
    'archive.trashed': '已移入回收站',
    'retract.label': '撤回并重写',
    'retract.confirm': '确认撤回：保留此前的对话，重写这条提示词',
    'retract.first': '首条消息不可撤回',
    'retract.running': '运行中，先停止再撤回',
    'toast.retracted': '已撤回，输入框已带原文',
    'toast.retractFailed': '撤回失败',
    'time.now': '刚刚',
    'time.minutes': '{n} 分钟前',
    'time.hours': '{n} 小时前',
    'time.days': '{n} 天前',
  },
  en: {
    'delete.moveToTrash': 'Move to trash',
    'delete.confirm': 'Confirm move to trash',
    'delete.cancel': 'Cancel',
    'trash.title': 'Trash',
    'trash.empty': 'Trash is empty',
    'trash.count': '{n} session(s)',
    'trash.restore': 'Restore',
    'trash.destroy': 'Delete forever',
    'trash.destroyConfirm': 'Click again to delete forever',
    'untitled': 'Untitled',
    'toast.moved': 'Moved to trash',
    'toast.undo': 'Undo',
    'toast.restoring': 'Restoring…',
    'toast.restored': 'Restored',
    'toast.failed': 'Action failed',
    'archive.title': 'Archived sessions',
    'archive.empty': 'No archived sessions',
    'archive.count': '{n} session(s)',
    'archive.hint': '↺ restore to sidebar; 🗑 move to trash; grey rows no longer exist',
    'archive.dead': 'session deleted',
    'archive.purge': 'Purge dead records',
    'archive.purgeConfirm': 'Click again to purge',
    'archive.trashed': 'Moved to trash',
    'retract.label': 'Retract & rewrite',
    'retract.confirm': 'Confirm retract: keep earlier turns, rewrite this prompt',
    'retract.first': 'Cannot retract the first prompt',
    'retract.running': 'Stop the run before retracting',
    'toast.retracted': 'Retracted; original text is in the composer',
    'toast.retractFailed': 'Retract failed',
    'time.now': 'just now',
    'time.minutes': '{n} min ago',
    'time.hours': '{n} h ago',
    'time.days': '{n} d ago',
  },
}

var CSS = [
  /* header action buttons — same geometry as the native IconActions buttons */
  '.bwt-action{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:6px;border:none;border-radius:28px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;}',
  '.bwt-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',
  '.bwt-action[data-danger]{color:var(--dsw-alias-state-error-primary);}',
  '.bwt-action[data-danger]:hover{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);}',
  '.bwt-action:disabled{opacity:.5;cursor:default;}',
  '.bwt-action:disabled:hover{background:transparent;color:var(--dsw-alias-label-tertiary);}',
  '.bwt-action[data-danger]:disabled:hover{background:transparent;color:var(--dsw-alias-state-error-primary);}',
  '.bwt-arm{display:inline-flex;align-items:center;gap:2px;}',

  /* footer tool row — pixel-aligned with the native Settings trigger row
     (34px compact row, 12px radius, transparent resting background,
     label-primary icon; rail keeps the 36px circle rhythm) */
  '.bwt-tools{display:flex;flex-direction:column;align-items:center;gap:2px;}',
  '.bwt-tools[data-wide]{flex-direction:row;align-items:center;gap:2px;height:34px;margin:4px -4px 4px;padding:0 6px 0 10px;box-sizing:border-box;}',
  '.bwt-tool{position:relative;display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;padding:0;border:none;border-radius:50%;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;}',
  '.bwt-tools[data-wide] .bwt-tool{width:28px;height:28px;border-radius:12px;}',
  '.bwt-tool:hover,.bwt-tool[data-open]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',
  '.bwt-badge{position:absolute;top:1px;right:1px;min-width:14px;height:14px;padding:0 3px;border-radius:7px;background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-inverted,#fff);font-size:10px;line-height:14px;font-weight:600;}',

  /* popovers and rows */
  '.bwt-pop{position:fixed;display:flex;flex-direction:column;width:264px;max-height:320px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-overlay);box-shadow:0 8px 24px rgba(0,0,0,.16);z-index:900;overflow:hidden;}',
  '.bwt-pop-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px 6px;font-size:12px;color:var(--dsw-alias-label-caption);}',
  '.bwt-pop-list{overflow:auto;padding:0 4px 4px;}',
  '.bwt-row{display:flex;align-items:center;gap:4px;padding:4px 8px;border-radius:8px;}',
  '.bwt-row[data-clickable]{cursor:pointer;width:100%;border:none;background:transparent;text-align:left;box-sizing:border-box;font-family:inherit;}',
  '.bwt-row[data-clickable]:hover{background:var(--dsw-alias-interactive-bg-hover);}',
  '.bwt-row[data-dead]{opacity:.45;}',
  '.bwt-row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;}',
  '.bwt-row-title{font-size:13px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '.bwt-row-sub{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '.bwt-row-actions{display:flex;align-items:center;}',
  '.bwt-row-actions .bwt-action{width:26px;height:26px;padding:5px;}',
  '.bwt-empty{padding:16px 12px;font-size:12px;color:var(--dsw-alias-label-tertiary);text-align:center;}',
  '.bwt-hint{padding:6px 12px 8px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption);border-top:1px solid var(--dsw-alias-border-l2);display:flex;align-items:center;justify-content:space-between;gap:8px;}',
  '.bwt-purge{border:none;background:transparent;padding:2px 4px;border-radius:6px;font-size:11px;color:var(--dsw-alias-label-tertiary);cursor:pointer;white-space:nowrap;}',
  '.bwt-purge:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',

  /* undo toast */
  '.bwt-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);display:flex;align-items:center;gap:10px;max-width:70vw;padding:10px 10px 10px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-overlay);box-shadow:0 8px 24px rgba(0,0,0,.18);color:var(--dsw-alias-label-primary);font-size:13px;z-index:1000;}',
  '.bwt-toast-icon{display:inline-flex;color:var(--dsw-alias-label-tertiary);}',
  '.bwt-toast-text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '.bwt-toast-undo{border:none;border-radius:8px;padding:6px 12px;background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-inverted,#fff);font-size:12px;font-weight:600;cursor:pointer;}',
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

/** First non-empty text block of a user message content array. */
function promptText(content) {
  if (!Array.isArray(content)) return ''
  var texts = []
  for (var i = 0; i < content.length; i++) {
    var block = content[i]
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      texts.push(block.text)
    }
  }
  return texts.join('')
}

/** Module-scoped toast bus shared by all contributed components. */
var toastListener = null
function publishToast(toast) { if (toastListener !== null) toastListener(toast) }
function subscribeToast(listener) {
  toastListener = listener
  return function () { if (toastListener === listener) toastListener = null }
}

/** Diagnostics for browser devtools when a host call fails. */
function reportError(scope, error) {
  var message = error instanceof Error ? error.message : String(error)
  console.error('better-webui: ' + scope + ' failed: ' + message)
  return message
}

/**
 * Retract action on one user prompt row (renders next to the native copy
 * icon). Fork-bridge semantics: keep everything before this prompt's turn,
 * rewrite the prompt itself. Derives the fork anchor from the snapshot —
 * `atSeq` cuts at the first turn/end at or after the seq, so the anchor for
 * "everything before this turn" is the END seq of the PREVIOUS turn.
 */
function RetractPromptAction(props) {
  var node = props.node
  var turn = props.turn
  var sessionId = props.sessionId
  var api = props.api
  var t = props.t
  var useSession = props.useSession
  var inputActions = props.inputActions

  var forkPrevSeq = useSession(function (snapshot) {
    if (turn === undefined) return -1
    // turnEnds maps completed-turn number -> its turn/end seq.
    var best = -1
    snapshot.turnEnds.forEach(function (seq, turnNumber) {
      if (turnNumber < turn && seq > best) best = seq
    })
    return best
  })
  var running = useSession(function (snapshot) { return snapshot.running })
  var removed = useSession(function (snapshot) { return snapshot.removed })

  var armedState = useState(false)
  var armed = armedState[0]
  var setArmed = armedState[1]
  var busyState = useState(false)
  var busy = busyState[0]
  var setBusy = busyState[1]
  var timer = useRef(null)

  useEffect(function () {
    return function () { if (timer.current !== null) window.clearTimeout(timer.current) }
  }, [])

  var text = promptText(node.content)
  var first = forkPrevSeq === -1
  var unavailable = first || removed || busy

  var disarm = function () {
    setArmed(false)
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null }
  }
  var arm = function () {
    setArmed(true)
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(disarm, 4000)
  }

  var confirmRetract = function () {
    disarm()
    setBusy(true)
    var finish = function () { setBusy(false) }
    var afterCancel = function () {
      api.forkPrev(sessionId, forkPrevSeq)
        .then(function (childId) {
          if (inputActions !== undefined && text !== '') inputActions.setDraft(text)
          api.openSession(childId)
          // Fork-bridge: the source stays readable only through the archive
          // viewer; best-effort — a failing archive keeps the retract result.
          api.archiveSession(sessionId).catch(function (error) { reportError('archiveSource', error) })
          publishToast({ kind: 'retracted', title: text })
        })
        .catch(function (error) {
          var message = reportError('retract', error)
          publishToast({ kind: 'retractFailed', title: text, message: message })
        })
        .then(finish, finish)
    }
    if (running) api.cancelSession(sessionId).then(afterCancel, afterCancel)
    else afterCancel()
  }

  var tooltip = first ? t('retract.first') : armed ? t('retract.confirm') : t('retract.label')
  if (armed && !unavailable) {
    return h('span', { className: 'bwt-arm' },
      h(P.Tooltip, { label: t('retract.confirm'), side: 'bottom' },
        h('button', {
          type: 'button',
          className: 'bwt-action',
          'data-danger': 'true',
          'aria-label': t('retract.confirm'),
          disabled: busy,
          onClick: confirmRetract,
        }, h(P.IconCheckOutline16))),
      h(P.Tooltip, { label: t('delete.cancel'), side: 'bottom' },
        h('button', {
          type: 'button',
          className: 'bwt-action',
          'aria-label': t('delete.cancel'),
          onClick: disarm,
        }, h(P.IconCloseOutline16))))
  }
  return h(P.Tooltip, { label: tooltip, side: 'bottom' },
    h('button', {
      type: 'button',
      className: 'bwt-action',
      'aria-label': t('retract.label'),
      'aria-disabled': unavailable ? 'true' : undefined,
      disabled: unavailable,
      onClick: unavailable ? undefined : arm,
    }, h(P.IconEditOutline16)))
}

/** One trash-row action button pair (restore + two-step delete-forever). */
function TrashRowActions(props) {
  var item = props.item
  var armedId = props.armedId
  var onArm = props.onArm
  var onRestore = props.onRestore
  var onDestroy = props.onDestroy
  var t = props.t

  if (armedId === item.sessionId) {
    return h('div', { className: 'bwt-row-actions' },
      h(P.Tooltip, { label: t('trash.destroyConfirm'), side: 'top' },
        h('button', {
          type: 'button',
          className: 'bwt-action',
          'data-danger': 'true',
          'aria-label': t('trash.destroyConfirm'),
          onClick: function () { onDestroy(item.sessionId) },
        }, h(P.IconCheckOutline16, { size: 14 }))))
  }
  return h('div', { className: 'bwt-row-actions' },
    h(P.Tooltip, { label: t('trash.restore'), side: 'top' },
      h('button', {
        type: 'button',
        className: 'bwt-action',
        'aria-label': t('trash.restore'),
        onClick: function () { onRestore(item) },
      }, h(P.IconRefreshOutline16, { size: 14 }))),
    h(P.Tooltip, { label: t('trash.destroy'), side: 'top' },
      h('button', {
        type: 'button',
        className: 'bwt-action',
        'data-danger': 'true',
        'aria-label': t('trash.destroy'),
        onClick: function () { onArm(item.sessionId) },
      }, h(P.IconTrashOutline16, { size: 14 }))))
}

/** One archive-row action pair: restore to sidebar + move to trash. */
function ArchiveRowActions(props) {
  var item = props.item
  var onRestore = props.onRestore
  var onTrash = props.onTrash
  var t = props.t

  return h('div', { className: 'bwt-row-actions' },
    h(P.Tooltip, { label: t('trash.restore'), side: 'top' },
      h('button', {
        type: 'button',
        className: 'bwt-action',
        'aria-label': t('trash.restore'),
        onClick: function () { onRestore(item) },
      }, h(P.IconRefreshOutline16, { size: 14 }))),
    h(P.Tooltip, { label: t('delete.moveToTrash'), side: 'top' },
      h('button', {
        type: 'button',
        className: 'bwt-action',
        'data-danger': 'true',
        'aria-label': t('delete.moveToTrash'),
        onClick: function () { onTrash(item) },
      }, h(P.IconTrashOutline16, { size: 14 }))))
}

/** Popover frame shared by the trash and archive tools. */
function ToolPopover(props) {
  var anchor = props.anchor
  var title = props.title
  var countLabel = props.countLabel
  var children = props.children
  var hint = props.hint

  return ReactDOM.createPortal(
    h('div', { className: 'bwt-pop', style: { left: anchor.left + 'px', bottom: anchor.bottom + 'px' } },
      h('div', { className: 'bwt-pop-head' },
        h('span', null, title),
        countLabel === null ? null : h('span', null, countLabel)),
      children,
      hint === null ? null : h('div', { className: 'bwt-hint' }, hint)),
    document.body)
}

/**
 * Sidebar-foot tool row: trash bin + archive viewer, aligned with the native
 * Settings trigger (34px row / 36px rail circle). Root-scoped and always
 * mounted, so it also owns the toast host.
 */
function SidebarToolsAction(props) {
  var wide = props.wide
  var api = props.api
  var t = props.t
  var useWorkspaces = props.useWorkspaces
  var useSessions = props.useSessions

  // Framework-hook reads: stable projections only (ids array, items, byId).
  var archivedIds = useWorkspaces(function (state) { return state.archivedSessionIds })
  var workspaceItems = useWorkspaces(function (state) { return state.items })
  var byId = useSessions(function (list) { return list.byId })

  var itemsState = useState(null)
  var items = itemsState[0]
  var setItems = itemsState[1]
  var whichState = useState(null)
  var which = whichState[0]
  var setWhich = whichState[1]
  var destroyArmState = useState(null)
  var destroyArm = destroyArmState[0]
  var setDestroyArm = destroyArmState[1]
  var toastState = useState(null)
  var toast = toastState[0]
  var setToast = toastState[1]
  var anchorState = useState(null)
  var anchor = anchorState[0]
  var setAnchor = anchorState[1]
  var purgeArmedState = useState(false)
  var purgeArmed = purgeArmedState[0]
  var setPurgeArmed = purgeArmedState[1]
  var trashRef = useRef(null)
  var archiveRef = useRef(null)
  var toastTimer = useRef(null)
  var destroyTimer = useRef(null)
  var purgeTimer = useRef(null)

  var reload = function () {
    api.listTrash().then(setItems, function (error) {
      reportError('listTrash', error)
      setItems([])
    })
  }

  useEffect(function () { reload() }, [])
  useEffect(function () { return subscribeToast(setToast) }, [])
  useEffect(function () {
    return function () {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
      if (destroyTimer.current !== null) window.clearTimeout(destroyTimer.current)
      if (purgeTimer.current !== null) window.clearTimeout(purgeTimer.current)
    }
  }, [])

  var dismissToast = function () {
    if (toastTimer.current !== null) { window.clearTimeout(toastTimer.current); toastTimer.current = null }
    setToast(null)
  }

  useEffect(function () {
    if (toast === null) return
    if (toast.kind === 'moved') {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
      toastTimer.current = window.setTimeout(dismissToast, 10000)
    } else if (toast.kind !== 'restoring') {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
      toastTimer.current = window.setTimeout(dismissToast, toast.kind === 'failed' || toast.kind === 'retractFailed' ? 6000 : 3000)
    }
  }, [toast])

  var undoTrash = function () {
    if (toast === null || toast.kind !== 'moved') return
    setToast({ kind: 'restoring', title: toast.title })
    api.restore(toast.sessionId)
      .then(function () {
        setToast({ kind: 'restored', title: toast.title })
        reload()
        return api.refreshSessions()
      })
      .catch(function (error) {
        var message = reportError('restore', error)
        setToast({ kind: 'failed', title: toast.title, message: message })
      })
  }

  var toggle = function (name, buttonRef) {
    var next = which === name ? null : name
    if (next !== null && buttonRef.current !== null) {
      var rect = buttonRef.current.getBoundingClientRect()
      setAnchor({ left: rect.left, bottom: window.innerHeight - rect.top + 8 })
    }
    setWhich(next)
    setDestroyArm(null)
    setPurgeArmed(false)
    if (next === 'trash') reload()
  }

  var restoreItem = function (item) {
    setDestroyArm(null)
    api.restore(item.sessionId)
      .then(function (next) { setItems(next); return api.refreshSessions() })
      .catch(function (error) { reportError('restore', error); reload() })
  }

  var armDestroy = function (sessionId) {
    setDestroyArm(sessionId)
    if (destroyTimer.current !== null) window.clearTimeout(destroyTimer.current)
    destroyTimer.current = window.setTimeout(function () { setDestroyArm(null) }, 3000)
  }

  var destroyItem = function (sessionId) {
    setDestroyArm(null)
    api.destroy(sessionId)
      .then(function (next) { setItems(next) })
      .catch(function (error) { reportError('destroy', error); reload() })
  }

  /* archive rows: live sessions can be restored to the sidebar or trashed;
     dead ids (no summary) are greyed with a deleted marker. */
  var archiveCount = archivedIds === undefined ? 0 : archivedIds.length
  var hasDeadArchived = false
  if (archivedIds !== undefined && byId !== undefined) {
    for (var i = 0; i < archivedIds.length; i++) {
      if (byId[archivedIds[i]] === undefined) { hasDeadArchived = true; break }
    }
  }

  var archiveRestore = function (item) {
    api.restoreArchived(item.sessionId)
      .then(function () { return api.refreshSessions() })
      .catch(function (error) { reportError('restoreArchived', error) })
  }

  var archiveTrash = function (item) {
    api.trash(item.sessionId, item.title)
      .then(function (next) {
        setItems(next)
        publishToast({ kind: 'archivedTrashed', title: item.title })
      })
      .catch(function (error) { reportError('trashArchived', error) })
  }

  var purgeDead = function () {
    if (!purgeArmed) {
      setPurgeArmed(true)
      if (purgeTimer.current !== null) window.clearTimeout(purgeTimer.current)
      purgeTimer.current = window.setTimeout(function () { setPurgeArmed(false) }, 4000)
      return
    }
    setPurgeArmed(false)
    api.purgeArchived()
      .then(function (result) {
        if (result.purged.length > 0) return api.refreshSessions()
      })
      .catch(function (error) { reportError('purgeArchived', error) })
  }

  var trashCount = items === null ? 0 : items.length

  /* trash popover rows */
  var trashBody = null
  if (which === 'trash' && anchor !== null) {
    if (items === null) {
      trashBody = h('div', { className: 'bwt-empty' }, '…')
    } else if (items.length === 0) {
      trashBody = h('div', { className: 'bwt-empty' }, t('trash.empty'))
    } else {
      trashBody = h('div', { className: 'bwt-pop-list' },
        items.map(function (item) {
          var sub = [cwdBasename(item.cwd), relativeTime(item.trashedAt, t)]
            .filter(function (part) { return part !== '' })
            .join(' · ')
          return h('div', { key: item.sessionId, className: 'bwt-row' },
            h('div', { className: 'bwt-row-main' },
              h('span', { className: 'bwt-row-title', title: item.cwd || item.title },
                item.title || t('untitled')),
              h('span', { className: 'bwt-row-sub' }, sub)),
            h(TrashRowActions, {
              item: item,
              armedId: destroyArm,
              onArm: armDestroy,
              onRestore: restoreItem,
              onDestroy: destroyItem,
              t: t,
            }))
        }))
    }
  }

  /* archive popover rows */
  var archiveBody = null
  if (which === 'archive' && anchor !== null) {
    if (archiveCount === 0) {
      archiveBody = h('div', { className: 'bwt-empty' }, t('archive.empty'))
    } else {
      archiveBody = h('div', { className: 'bwt-pop-list' },
        archivedIds.map(function (sessionId) {
          var summary = byId === undefined ? undefined : byId[sessionId]
          var dead = summary === undefined
          var workspace = workspaceItems === undefined ? undefined : workspaceItems.find(function (w) {
            return w.sessionIds !== undefined && w.sessionIds.indexOf(sessionId) !== -1
          })
          var label = dead ? t('archive.dead')
            : summary.displayTitle !== undefined && summary.displayTitle !== '' ? summary.displayTitle
              : summary.title || t('untitled')
          var sub = dead ? sessionId.slice(0, 13) + '…' : [
            workspace !== undefined ? (workspace.title || cwdBasename(workspace.cwd)) : '',
            summary.updatedAt !== undefined ? relativeTime(summary.updatedAt, t) : '',
          ].filter(function (part) { return part !== '' }).join(' · ')
          return h('div', {
            key: sessionId,
            className: 'bwt-row',
            'data-dead': dead ? 'true' : undefined,
          },
            h('div', { className: 'bwt-row-main' },
              h('span', { className: 'bwt-row-title', title: dead ? sessionId : (workspace !== undefined ? workspace.cwd : label) }, label),
              h('span', { className: 'bwt-row-sub' }, sub)),
            h(ArchiveRowActions, {
              item: { sessionId: sessionId, title: dead ? '' : label },
              onRestore: archiveRestore,
              onTrash: dead ? function () {} : archiveTrash,
              t: t,
            }))
        }))
    }
  }

  /* undo / status toast */
  var toastNode = null
  if (toast !== null) {
    var text = null
    var action = null
    if (toast.kind === 'moved') {
      text = h('span', { className: 'bwt-toast-text' }, t('toast.moved'), '「', toast.title || t('untitled'), '」')
      action = h('button', {
        type: 'button',
        className: 'bwt-toast-undo',
        onClick: undoTrash,
      }, t('toast.undo'))
    } else if (toast.kind === 'restoring') {
      text = h('span', { className: 'bwt-toast-text' }, t('toast.restoring'))
    } else if (toast.kind === 'restored') {
      text = h('span', { className: 'bwt-toast-text' }, t('toast.restored'))
    } else if (toast.kind === 'retracted') {
      text = h('span', { className: 'bwt-toast-text' }, t('toast.retracted'))
    } else if (toast.kind === 'retractFailed') {
      text = h('span', { className: 'bwt-toast-text' },
        t('toast.retractFailed'),
        toast.message === undefined ? null : h('span', { className: 'bwt-row-sub' }, ' · ' + toast.message))
    } else if (toast.kind === 'archivedTrashed') {
      text = h('span', { className: 'bwt-toast-text' }, t('archive.trashed'), '「', toast.title || t('untitled'), '」')
    } else {
      text = h('span', { className: 'bwt-toast-text' },
        t('toast.failed'),
        toast.message === undefined ? null : h('span', { className: 'bwt-row-sub' }, ' · ' + toast.message))
    }
    toastNode = ReactDOM.createPortal(
      h('div', { className: 'bwt-toast', role: 'status' },
        h('span', { className: 'bwt-toast-icon' }, h(P.IconTrashOutline16, { size: 16 })),
        text,
        action,
        h('button', {
          type: 'button',
          className: 'bwt-toast-close',
          'aria-label': t('delete.cancel'),
          onClick: dismissToast,
        }, h(P.IconCloseOutline16, { size: 14 }))),
      document.body)
  }

  return h('div', { className: 'bwt-tools', 'data-wide': wide ? 'true' : undefined },
    h(P.Tooltip, { label: t('trash.title'), side: 'top', disabled: wide },
      h('button', {
        type: 'button',
        ref: trashRef,
        className: 'bwt-tool',
        'data-open': which === 'trash' ? 'true' : undefined,
        'aria-label': t('trash.title'),
        'aria-expanded': which === 'trash',
        onClick: function () { toggle('trash', trashRef) },
      },
        h(P.IconTrashOutline16, { size: wide ? 16 : 18 }),
        trashCount > 0 ? h('span', { className: 'bwt-badge' }, String(trashCount)) : null)),
    h(P.Tooltip, { label: t('archive.title'), side: 'top', disabled: wide },
      h('button', {
        type: 'button',
        ref: archiveRef,
        className: 'bwt-tool',
        'data-open': which === 'archive' ? 'true' : undefined,
        'aria-label': t('archive.title'),
        'aria-expanded': which === 'archive',
        onClick: function () { toggle('archive', archiveRef) },
      },
        h(P.IconArchiveOutline20, { size: wide ? 16 : 18 }),
        archiveCount > 0 ? h('span', { className: 'bwt-badge' }, String(archiveCount)) : null)),
    which === 'trash' && anchor !== null
      ? h(ToolPopover, {
        anchor: anchor,
        title: t('trash.title'),
        countLabel: items !== null && items.length > 0 ? t('trash.count', { n: items.length }) : null,
        hint: null,
      }, trashBody)
      : null,
    which === 'archive' && anchor !== null
      ? h(ToolPopover, {
        anchor: anchor,
        title: t('archive.title'),
        countLabel: archiveCount > 0 ? t('archive.count', { n: archiveCount }) : null,
        hint: h('span', { className: 'bwt-hint-text' }, t('archive.hint'),
          hasDeadArchived ? h('button', {
            type: 'button',
            className: 'bwt-purge',
            onClick: purgeDead,
          }, purgeArmed ? t('archive.purgeConfirm') : t('archive.purge')) : null),
      }, archiveBody)
      : null,
    toastNode)
}

/**
 * Session-header trash action: two-step arm → move to trash → navigate away.
 * Renders nothing for blank sessions (an empty log has nothing to delete).
 */
function DeleteSessionAction(props) {
  var sessionId = props.sessionId
  var useSessions = props.useSessions
  var api = props.api
  var t = props.t

  var entry = useSessions(function (list) { return list.byId[sessionId] })
  var armedState = useState(false)
  var armed = armedState[0]
  var setArmed = armedState[1]
  var busyState = useState(false)
  var busy = busyState[0]
  var setBusy = busyState[1]
  var timer = useRef(null)

  useEffect(function () {
    return function () { if (timer.current !== null) window.clearTimeout(timer.current) }
  }, [])

  if (entry === undefined || entry.blank) return null
  var title = entry.displayTitle || entry.title || t('untitled')

  var disarm = function () {
    setArmed(false)
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null }
  }
  var arm = function () {
    setArmed(true)
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(disarm, 4000)
  }
  var confirmTrash = function () {
    disarm()
    setBusy(true)
    api.trash(sessionId, title)
      .then(function () {
        publishToast({ kind: 'moved', sessionId: sessionId, title: title })
        return api.refreshSessions()
      })
      .then(function () { api.startSession() })
      .catch(function (error) {
        var message = reportError('trash', error)
        publishToast({ kind: 'failed', title: title, message: message })
      })
      .finally(function () { setBusy(false) })
  }

  if (armed) {
    return h('span', { className: 'bwt-arm' },
      h(P.Tooltip, { label: t('delete.confirm'), side: 'bottom' },
        h('button', {
          type: 'button',
          className: 'bwt-action',
          'data-danger': 'true',
          'aria-label': t('delete.confirm'),
          disabled: busy,
          onClick: confirmTrash,
        }, h(P.IconCheckOutline16))),
      h(P.Tooltip, { label: t('delete.cancel'), side: 'bottom' },
        h('button', {
          type: 'button',
          className: 'bwt-action',
          'aria-label': t('delete.cancel'),
          onClick: disarm,
        }, h(P.IconCloseOutline16))))
  }
  return h(P.Tooltip, { label: t('delete.moveToTrash'), side: 'bottom' },
    h('button', {
      type: 'button',
      className: 'bwt-action',
      'aria-label': t('delete.moveToTrash'),
      disabled: busy,
      onClick: arm,
    }, h(P.IconTrashOutline16)))
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

  var call = function (method, payload) {
    return ctx.connection.rpc.call('/better-webui', method, payload)
  }
  var unwrap = function (method, payload) {
    return call(method, payload).then(function (result) {
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
    trash: function (sessionId, title) {
      return unwrap('trash', { sessionId: sessionId, title: title }).then(function (value) { return value.items })
    },
    restore: function (sessionId) {
      return unwrap('restore', { sessionId: sessionId }).then(function (value) { return value.items })
    },
    destroy: function (sessionId) {
      return unwrap('destroy', { sessionId: sessionId }).then(function (value) { return value.items })
    },
    cancelSession: function (sessionId) {
      return unwrap('cancel', { sessionId: sessionId })
    },
    forkPrev: function (sessionId, atSeq) {
      return ctx.sessions.fork({ sessionId: sessionId, atSeq: atSeq })
    },
    restoreArchived: function (sessionId) {
      return unwrap('restoreArchived', { sessionId: sessionId })
    },
    archiveSession: function (sessionId) {
      return unwrap('archive', { sessionId: sessionId })
    },
    purgeArchived: function () {
      return unwrap('purgeArchived', {}).then(function (value) { return value })
    },
    refreshSessions: function () { return ctx.sessions.refresh() },
    startSession: function () { ctx.workspaces.startSession() },
    openSession: function (sessionId) { ctx.sessions.open(sessionId) },
  }
  var injected = function () { return { api: api } }

  ctx.slots.inject('conversation.session.header.actions', function () {
    return ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'better-webui-trash',
      order: 60,
      locale: NS,
      inject: injected,
    }, DeleteSessionAction)
  })

  ctx.slots.inject('sidebar.footer.action', function () {
    return ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'better-webui-tools',
      locale: NS,
      inject: injected,
    }, SidebarToolsAction)
  })

  ctx.slots.inject('conversation.chat.user-actions', function () {
    return ctx.slots.register({
      name: 'conversation.chat.user-actions',
      id: 'better-webui-retract',
      order: 10,
      locale: NS,
      inject: injected,
    }, RetractPromptAction)
  })
}
