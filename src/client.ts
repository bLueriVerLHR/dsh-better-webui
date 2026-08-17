/**
 * better-webui browser half. Loaded by the `better-webui-client` cordis row.
 *
 * Mounts the better-webui Remote namespace and shadows `sidebar.workspaces`
 * so the session list supports:
 *  1. two-step delete (trash → grey/last → restore or destroy)
 *  2. branch-tree display (M4)
 *  3. eventual tool-output <details> (M3, registered in a separate module)
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { betterWebuiRemote } from './host/remote.ts'
import { BetterSidebar } from './client/sidebar.tsx'
import type { BetterWebMetadata } from './shared/types.ts'
import './client/types.ts'

const en = {
  'session.new': 'New session',
  'session.blank': 'New chat',
  'session.untitled': 'Untitled',
  'trash.delete': 'Delete',
  'trash.restore': 'Restore',
  'trash.destroy': 'Delete forever',
  'trash.confirm': 'Move this session to trash? It will stay visible, greyed out.',
  'trash.destroy.confirm': 'Permanently delete this session? This cannot be undone.',
  'trash.titleOnly': 'Session is in trash; content is hidden.',
}

const zh = {
  'session.new': '新会话',
  'session.blank': '新对话',
  'session.untitled': '无标题',
  'trash.delete': '删除',
  'trash.restore': '恢复',
  'trash.destroy': '彻底删除',
  'trash.confirm': '把该会话移入回收站？将置灰显示并排到末尾。',
  'trash.destroy.confirm': '彻底删除该会话？此操作不可撤销。',
  'trash.titleOnly': '该会话已删除，内容不可见。',
}

/**
 * Client plugin apply.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // Make the better remote namespace callable from the browser.
  void ctx.remote.$mount(betterWebuiRemote)

  const loadMetadata = async (): Promise<BetterWebMetadata | null> => {
    const result = await ctx.remote.betterWebui.meta()
    return result.ok ? result.value : null
  }
  const onTrash = async (sessionId: SessionId): Promise<void> => {
    const result = await ctx.remote.betterWebui.trash(sessionId)
    if (!result.ok) throw new Error(result.error.message)
  }
  const onRestore = async (sessionId: SessionId): Promise<void> => {
    const result = await ctx.remote.betterWebui.restore(sessionId)
    if (!result.ok) throw new Error(result.error.message)
  }
  const onDestroy = async (sessionId: SessionId): Promise<void> => {
    const result = await ctx.remote.betterWebui.destroy(sessionId)
    if (!result.ok) throw new Error(result.error.message)
  }

  ctx.effect(() => ctx.locale.register('better-sessions', { zh, en }), 'better-webui: dictionaries')
  ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({
    name: 'sidebar.workspaces',
    priority: -1,
    locale: 'better-sessions',
    inject: () => ({
      loadMetadata,
      onOpen: (sessionId: SessionId) => { ctx.sessions.open(sessionId) },
      onNewSession: () => { ctx.workspaces.startSession() },
      onTrash,
      onRestore,
      onDestroy,
    }),
  }, BetterSidebar))
}
