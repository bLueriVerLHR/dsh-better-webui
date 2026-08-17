/**
 * better-webui browser half. Loaded by the `better-webui-client` cordis row.
 *
 * Registers overrides into the Web UI:
 *  1. sidebar session list: trash/restore/destroy actions + trashed grey rows
 *  2. tool output: collapsible `<details>` over `tool.result` content
 *  3. branch entry points + persistent tree sidebar
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Mount the browser-side overrides.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // TODO(implementation): register a shadow of `sidebar.workspaces` (lower
  // priority) that renders the updated session list / tree.
  // TODO(implementation): register a keyed tool renderer with <details> for
  // tool.result output (default collapsed; truncation + copy + new tab).
  // TODO(implementation): add "branch from this message" action on user
  // message cards wired to `remote['better-sessions'].branch(...)`.
  void ctx
}
