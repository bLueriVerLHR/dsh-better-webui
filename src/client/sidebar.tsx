/**
 * Better-webui sidebar replacement for `sidebar.workspaces`.
 *
 * This is intentionally a focused tree/list renderer for the three requested
 * behaviors. It reads the session list through the standard `useSessions`
 * hook and reuses the host trash/restore/branch metadata.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type { SessionId, SessionListEntry, SessionListSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { BetterWebMetadata } from '../shared/types.ts'

export interface BetterSidebarProps {
  useSessions: SnapshotSelectorHook<SessionListSnapshot>
  loadMetadata: () => Promise<BetterWebMetadata | null>
  onOpen: (sessionId: SessionId) => void
  onNewSession: () => void
  onTrash: (sessionId: SessionId) => Promise<void>
  onRestore: (sessionId: SessionId) => Promise<void>
  onDestroy: (sessionId: SessionId) => Promise<void>
  t: (key: string) => string
}

interface TreeNode {
  entry: SessionListEntry
  children: TreeNode[]
}

/** Build a nested tree from parent links. */
function buildTreeNodes(sessions: readonly SessionListEntry[]): TreeNode[] {
  const byId = new Map<SessionId, SessionListEntry>(sessions.map(s => [s.sessionId, s]))
  const nodes = new Map<SessionId, TreeNode>(sessions.map(s => [s.sessionId, { entry: s, children: [] }]))
  const roots: TreeNode[] = []
  for (const session of sessions) {
    const node = nodes.get(session.sessionId)
    if (node === undefined) continue
    const parent = session.parentSessionId
    const parentNode = parent !== undefined ? nodes.get(parent) : undefined
    if (parentNode !== undefined) parentNode.children.push(node)
    else roots.push(node)
  }
  return roots
}

/** Sort active sessions first, trashed last while keeping source order. */
function sortSessions(
  sessions: readonly SessionListEntry[],
  trashed: ReadonlySet<SessionId>,
): SessionListEntry[] {
  const active: SessionListEntry[] = []
  const removed: SessionListEntry[] = []
  for (const session of sessions) {
    const list = trashed.has(session.sessionId) ? removed : active
    list.push(session)
  }
  return [...active, ...removed]
}

/**
 * Render the session list with trashed rows last/grey and a collapsible
 * branch tree. Branch nodes are folded by default; expanding state is
 * browser-local only.
 */
export function BetterSidebar({
  useSessions, loadMetadata, onOpen, onNewSession, onTrash, onRestore, onDestroy, t,
}: BetterSidebarProps): ReactElement {
  const listSessions = useSessions(state => state.items)
  const [metadata, setMetadata] = useState<BetterWebMetadata | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<SessionId>>(new Set())

  useEffect(() => {
    let active = true
    void loadMetadata().then((value) => { if (active) setMetadata(value) })
    return () => { active = false }
  }, [loadMetadata])

  const reload = (): void => {
    void loadMetadata().then((value) => { if (value !== null) setMetadata(value) })
  }

  const trashed = useMemo(
    () => new Set((metadata?.trash ?? []).map(r => r.sessionId)),
    [metadata],
  )
  const sessions = useMemo(
    () => sortSessions(listSessions, trashed),
    [listSessions, trashed],
  )
  const roots = useMemo(() => buildTreeNodes(sessions), [sessions])
  const hasBranchChildren = useMemo(() => {
    const ids = new Set<SessionId>()
    for (const session of sessions) {
      if (session.parentSessionId !== undefined) ids.add(session.parentSessionId)
    }
    return ids
  }, [sessions])

  const toggle = (sessionId: SessionId): void => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      return next
    })
  }

  const renderNode = (node: TreeNode): ReactElement => {
    const session = node.entry
    const isTrashed = trashed.has(session.sessionId)
    const foldable = node.children.length > 0
    const isExpanded = expanded.has(session.sessionId)
    const canExpand = foldable
    return (
      <div key={session.sessionId}>
        <div
          role="treeitem"
          aria-selected={false}
          aria-expanded={canExpand ? isExpanded : undefined}
          data-trashed={isTrashed || undefined}
          style={{ paddingLeft: `${8 + session.depth * 16}px`, opacity: isTrashed ? 0.55 : undefined }}
          className="better-webui-row"
        >
          {canExpand ? (
            <button type="button" onClick={() => { toggle(session.sessionId) }}>
              {isExpanded ? '▾' : '▸'}
            </button>
          ) : (
            <span className="better-webui-row-spacer" />
          )}
          <button
            type="button"
            className="better-webui-title"
            title={isTrashed ? t('trash.titleOnly') : session.title}
            onClick={() => { onOpen(session.sessionId) }}
          >
            {session.blank ? t('session.blank') : (session.title || t('session.untitled'))}
          </button>
          {isTrashed ? (
            <span className="better-webui-actions">
              <button type="button" onClick={() => { void onRestore(session.sessionId).then(reload) }}>
                {t('trash.restore')}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(t('trash.destroy.confirm'))) void onDestroy(session.sessionId).then(reload)
                }}
              >
                {t('trash.destroy')}
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (window.confirm(t('trash.confirm'))) void onTrash(session.sessionId).then(reload)
              }}
            >
              {t('trash.delete')}
            </button>
          )}
        </div>
        {canExpand && isExpanded && (
          <div className="better-webui-children">
            {node.children.map(child => renderNode(child))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="better-webui-sidebar">
      <div className="better-webui-header">
        <button type="button" onClick={onNewSession}>{t('session.new')}</button>
      </div>
      <div className="better-webui-tree" role="tree">
        {roots.map(node => renderNode(node))}
      </div>
    </div>
  )
}
