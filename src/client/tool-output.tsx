/**
 * Tool output rendering: collapsible `<details>`, head/tail truncation, copy
 * and open-in-new-tab actions. The exact tool-row slot wiring is added in M3;
 * this module exports the pure truncation helper and the presentational card.
 */
import { useMemo, type ReactElement } from 'react'

export interface TruncatedLines {
  head: string
  omitted: number
  tail: string
}

/** Keep the first and last `headLines`/`tailLines`, omit the middle. */
export function truncateHeadTail(text: string, headLines = 50, tailLines = 50): TruncatedLines {
  const lines = text.split('\n')
  if (lines.length <= headLines + tailLines) {
    return { head: text, omitted: 0, tail: '' }
  }
  const head = lines.slice(0, headLines).join('\n')
  const tail = lines.slice(lines.length - tailLines).join('\n')
  return { head, omitted: lines.length - headLines - tailLines, tail }
}

export interface ToolOutputProps {
  /** The full tool result text. */
  text: string
  /** Head lines kept before the omission marker. */
  headLines?: number
  /** Tail lines kept after the omission marker. */
  tailLines?: number
  /** Tool/command title shown in the summary. */
  label?: string
}

/**
 * Default-collapsed output block. When truncated, the expanded view still
 * shows the complete output (the omitted marker is only used for display
 * size control when opening in-page; copy/new-tab uses the full text).
 */
export function ToolOutput({ text, headLines = 50, tailLines = 50, label = 'Output' }: ToolOutputProps): ReactElement {
  const truncation = useMemo(() => truncateHeadTail(text, headLines, tailLines), [text, headLines, tailLines])
  const showFull = truncation.omitted === 0 ? text : text

  return (
    <details className="better-webui-tool-output">
      <summary>{label} {truncation.omitted > 0 ? `(full: ${text.length.toLocaleString()} chars, first ${headLines} / last ${tailLines} lines)` : ''}</summary>
      <div className="better-tool-output-body">
        {truncation.omitted > 0 && (
          <div className="better-tool-output-omitted">
            … {truncation.omitted} line{truncation.omitted === 1 ? '' : 's'} omitted …
          </div>
        )}
        <pre>{showFull}</pre>
        <div className="better-tool-output-actions">
          <button type="button" onClick={() => { void navigator.clipboard.writeText(text) }}>Copy full output</button>
          <button type="button" onClick={() => {
            const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
            window.open(url, '_blank', 'noopener')
          }}>
            Open full output
          </button>
        </div>
      </div>
    </details>
  )
}
