/**
 * better-webui chime host half — intentionally empty.
 *
 * The chime feature is client-only: its browser half (conversation dock entry
 * + General-settings row) is served through the row's `dsh.client` declaration,
 * and all state lives in localStorage. The host half exists only so the loader
 * has a package entry to mount for this row; it contributes nothing host-side
 * and holds no services.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context (unused).
 */
export const inject = []

export function apply(ctx) {
  // Intentionally empty: the feature's only effect is browser-side.
  void ctx
}
