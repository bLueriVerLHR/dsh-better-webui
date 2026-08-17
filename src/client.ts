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
import { BashBetterRow } from './client/bash-row.tsx'
import { UserBranchNodeView } from './client/user-branch.tsx'
import type { BetterWebMetadata } from './shared/types.ts'
import { en, zh } from './client/locales.ts'
import './client/types.ts'


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

  // M4: add "branch from here" to user messages.
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'user',
    priority: -1,
  }, UserBranchNodeView as never))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'steering',
    priority: -1,
  }, UserBranchNodeView as never))

  // M3: override the bash tool row with a collapsible output view.
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'bash',
    priority: -1,
  }, BashBetterRow as never))

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
