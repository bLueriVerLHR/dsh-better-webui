/**
 * Bash tool row override: renders the tool output in a default-collapsed
 * `<details>` with head/tail truncation. Registered into `tool.call.toolview`
 * for the `bash` key, shadowing the shipped bash sample.
 */
import type { ReactElement } from 'react'
import type { ToolCallBlock, ToolCallViewProps } from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolCallOwnerProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { ToolOutput } from './tool-output.tsx'

function resultText(block: ToolCallBlock): string {
  if (block.kind !== 'tool-result') return ''
  return block.content
    .filter((content): content is { type: 'text'; text: string } => content.type === 'text')
    .map(content => content.text)
    .join('\n')
}

export function BashBetterRow({ toolName, block }: ToolCallOwnerProps): ReactElement {
  const output = resultText(block)
  return (
    <div className="better-webui-bash-row">
      <div className="better-webui-bash-head">{toolName}</div>
      {output.length > 0 ? (
        <ToolOutput text={output} label="Output" />
      ) : (
        <div className="better-webui-bash-empty">No output</div>
      )}
    </div>
  )
}

/** Re-export the props type for the registrant cast. */
export type { ToolCallViewProps }
