/**
 * User-message renderer that adds a "branch from here" action. Registered for
 * `conversation.chat.node` key `user` (and `steering`), shadowing the shipped
 * renderer. The actual branch is handled by the conversation owner's existing
 * `forkAt(seq)`.
 */
import type { ReactElement } from 'react'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

function textOf(content: readonly { type: string; text?: string }[]): string {
  return content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text' && block.text !== undefined)
    .map(block => block.text)
    .join('\n')
}

export function UserBranchNodeView({
  node, forkAt, t,
}: ChatNodeViewProps<'user'>): ReactElement {
  const text = textOf(node.data.content)
  return (
    <div className="better-webui-user-message">
      <div className="better-webui-user-text">{text}</div>
      <button
        type="button"
        className="better-webui-branch"
        onClick={() => { forkAt(node.data.seq) }}
      >
        {t('branch.fromHere')}
      </button>
    </div>
  )
}
