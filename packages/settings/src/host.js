/**
 * better-webui settings host half — intentionally empty.
 *
 * v0.21: the configurable LLM retry policy moved out into its own package
 * (`@blueriverlhr/dsh-better-webui-retry`, RPC `/better-webui-retry`); what
 * remains here is the better-webui preference page hosting the session-chime
 * card, which is pure client (localStorage). The host half exists only so the
 * loader has a package entry to mount for this row; it contributes nothing
 * host-side and holds no services.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context (unused).
 */
export const inject = []

export function apply(ctx) {
  // Intentionally empty: the feature's only effect is browser-side.
  void ctx
}
