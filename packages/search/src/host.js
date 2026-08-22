/**
 * better-webui search host half: keyless Exa web search provider.
 *
 * Registers a `ctx.web` search provider (id `exa`) so the model-facing
 * `web_search` tool (mounted by dsh-base's tool-web row) works without any
 * API key — anonymous Exa hosted MCP by default, REST once an `EXA_API_KEY`
 * appears. The seam's `searchProvider` is switched to this provider's id
 * (`exa`) by this package's cordis.patch.yml override of the `web` row.
 *
 * The `web` service is optional (read via `ctx.get`, not `inject`), so this
 * package never hard-depends on the web seam; a deployment without it simply
 * registers nothing.
 */
import { registerExaSearchProvider } from './web-search-exa.js'

export const inject = []

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 */
export function apply(ctx) {
  const web = ctx.get('web')
  if (web !== undefined) {
    const disposeExa = registerExaSearchProvider(web)
    ctx.effect(() => disposeExa, 'better-webui-search: exa search provider')
  }
}
