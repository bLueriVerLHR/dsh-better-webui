/**
 * Better-webui sidebar replacement for `sidebar.workspaces`.
 *
 * This is intentionally a focused tree/list renderer for the three requested
 * behaviors. It reads the session list through the standard `useSessions`
 * hook and reuses the host trash/restore/branch metadata.
 */
import { useEffect, useMemo, useState } from 'react'
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

/** Rebuild a flat tree order from parent links. */
function buildTree(
  sessions: readonly SessionListEntry[],
): SessionListEntry[] {
  const byId = new Map<SessionId, SessionListEntry>(sessions.map(s => [s.sessionId, s]))
  const roots: SessionListEntry[] = []
  const children = new Map<SessionId, SessionListEntry[]>()
  for (const session of sessions) {
    const parent = session.parentSessionId
    if (parent !== undefined && byId.has(parent)) {
      const list = children.get(parent) ?? []
      list.push(session)
      children.set(parent, list)
    } else {
      roots.push(session)
    }
  }
  const out: SessionListEntry[] = []
  const walk = (session: SessionListEntry, depth: number): void => {
    out.push({ ...session, depth })
    for (const child of children.get(session.sessionId) ?? []) walk(child, depth + 1)
  }
  for (const root of roots) walk(root, 0)
  return out
}

/**
 * Render the session list with trashed rows last/grey and a collapsible
 * branch tree.
 */
export function BetterSidebar({
  useSessions, loadMetadata, onOpen, onNewSession, onTrash, onRestore, onDestroy, t,
}: BetterSidebarProps): React.JSX.Element {
  const listSessions = useSessions(state => state.items)
  const [metadata, setMetadata] = useState<BetterWebMetadata | null>(null)

  useEffect(() => {
    let active = true
    void loadMetadata().then((value) => { if (active) setMetadata(value) })
    return () => { active = false }
  }, [loadMetadata])

  const trashed = useMemo(
    () => new Set((metadata?.trash ?? []).map(r => r.sessionId)),
    [metadata],
  )
  const sessions = useMemo(
    () => sortSessions(listSessions, trashed),
    [listSessions, trashed],
  )
  const tree = useMemo(() => buildTree(sessions), [sessions])

  return (
    <div className="better-webui-sidebar">
      <div className="better-webui-header">
        <button type="button" onClick={onNewSession}>{t('session.new')}</button>
      </div>
      <div className="better-webui-tree" role="tree">
        {tree.map(session => (
          <div
            key={session.sessionId}
            role="treeitem"
            aria-selected={false}
            data-depth={session.depth}
            data-trashed={trashed.has(session.sessionId) || undefined}
            style={{
              paddingLeft: `${8 + session.depth * 16}px`,
              opacity: trashed.has(session.sessionId) ? 0.55 : undefined,
            }}
            className="better-webui-row"
          >
            <button
              type="button"
              className="better-webui-title"
              title={trashed.has(session.sessionId) ? t('trash.titleOnly') : session.title}
              onClick={() => { onOpen(session.sessionId) }}
            >
              {session.blank ? t('session.blank') : (session.title || t('session.untitled'))}
            </button>
            {trashed.has(session.sessionId) ? (
              <span className="better-webui-actions">
                <button type="button" onClick={() => { void onRestore(session.sessionId) }}>
                  {t('trash.restore')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(t('trash.destroy.confirm'))) void onDestroy(session.sessionId)
                  }}
                >
                  {t('trash.destroy')}
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(t('trash.confirm'))) void onTrash(session.sessionId)
                }}
              >
                {t('trash.delete')}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
