/**
 * better-webui host entry. Loaded by the `better-webui-host` cordis row.
 *
 * Provides the durable `betterWebui` service and exposes it to the browser
 * through the generated Typert remote artifact (or the hand-written
 * `src/host/remote.ts` contribution in non-generated builds).
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { BetterWebService, type BetterWebServiceOptions } from './host/service.ts'
import { betterWebuiRemote } from './host/remote.ts'

export interface Config {
  metadataRoot?: string
}

export const Config = z.object({
  metadataRoot: z.string().optional(),
})

export { BetterWebService } from './host/service.ts'
export { betterWebuiRemote } from './host/remote.ts'
export type {
  BetterWebMetadata, BranchRecord, TrashRecord,
} from './shared/types.ts'

/**
 * Host plugin apply.
 * @param ctx - Cordis context.
 * @param config - validated plugin config.
 */
export function apply(ctx: Context, config: Config = {}): void {
  ctx.provide('betterWebui', new BetterWebService(ctx, config))

  // In generated harness builds the api-remotes assembly mounts the package's
  // `/remote` artifact automatically. For source/manual use we still register
  // the contribution if a remote gateway is already present.
  const remote = ctx.get('remote')
  if (remote !== undefined) {
    void remote.$mount(betterWebuiRemote).then(() => {
      /* mounted */
    })
  }
}
