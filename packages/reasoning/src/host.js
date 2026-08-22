/**
 * better-webui reasoning host half: custom-model reasoning-level provisioning.
 *
 * This is configuration, not a channel method or UI: the native composer's
 * reasoning-effort menu only appears when the model carries reasoning
 * metadata, and a hand-declared custom model (id/name/capacities in
 * `llm-pi-ai.providers.*.models`) has none — the pi-ai adapter reports
 * `reasoning: false`, so the menu is absent even though the config schema
 * supports `reasoningEfforts`. This half grants the full pi-ai level set
 * `off/minimal/low/medium/high/xhigh/max` to every custom model that declares
 * none, and upgrades a model whose declaration is exactly the old four-level
 * default (so existing models pick up the new levels on the next boot),
 * writing through the public `settings` service into the same `llm-pi-ai`
 * namespace the user edits by hand (persisted to `settings.yaml`,
 * hot-reloaded by the adapter, so the next menu open offers the levels
 * exactly like a catalog model). The pass is idempotent, runs at boot and
 * again whenever the namespace changes, and never touches a model that
 * declares its own deliberate `reasoningEfforts` (a custom dict, or `false`
 * to opt a model out).
 *
 * The plugin hard-depends on the `settings` service (declared in `inject`),
 * so Cordis activates it only once settings is registered — the boot pass is
 * never racing the provider.
 */

/** Settings namespace carrying the pi-ai provider profiles (`llm-pi-ai:` in settings.yaml). */
const LLM_PI_AI_NS = 'llm-pi-ai'

/**
 * The full reasoning-effort metadata granted to a custom model that declares
 * none, or that still carries the legacy four-level default. The level keys
 * are pi-ai thinking levels (`off → minimal → low → medium → high → xhigh →
 * max`); `off: null` means "supported, send nothing", and the other string
 * values are the wire `reasoning_effort` spellings the openai-completions
 * dispatch sends. A model declaring its own deliberate `reasoningEfforts` (a
 * custom dict, or `false`) is never touched.
 */
const DEFAULT_REASONING_EFFORTS = Object.freeze({
  off: null,
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
})

/**
 * The four-level default this package granted before v0.15. A model whose
 * declaration is byte-equal to this (and was therefore machine-granted, not
 * hand-tuned) is upgraded to {@link DEFAULT_REASONING_EFFORTS} so existing
 * models pick up the new levels without a hand edit.
 */
const LEGACY_DEFAULT_REASONING_EFFORTS = Object.freeze({ off: null, low: 'low', medium: 'medium', high: 'high' })

/** Log prefix. */
function where(label) {
  return label === undefined || label === null || label === '' ? 'better-webui-reasoning' : `better-webui-reasoning ${label}`
}

/** Whether a model profile entry already declares its own reasoning capability. */
export function reasoningDeclared(model) {
  return model !== null && typeof model === 'object' && model.reasoningEfforts !== undefined
}

/**
 * Whether a declared `reasoningEfforts` dict is byte-equal to the legacy
 * four-level default this package used to grant — i.e. machine-granted, not
 * hand-tuned, so it is safe to upgrade to the full set.
 * @param {unknown} efforts - the model's declared `reasoningEfforts` value.
 */
export function isLegacyDefaultEfforts(efforts) {
  if (efforts === null || typeof efforts !== 'object') return false
  const keys = Object.keys(efforts)
  if (keys.length !== Object.keys(LEGACY_DEFAULT_REASONING_EFFORTS).length) return false
  return Object.entries(LEGACY_DEFAULT_REASONING_EFFORTS).every(([level, wire]) => efforts[level] === wire)
}

/**
 * Whether a model's declaration needs (re-)granting the full default set:
 * it declares none, or it still carries the legacy four-level default.
 * @param {unknown} efforts - the model's declared `reasoningEfforts` value.
 */
function needsGrantEfforts(efforts) {
  return efforts === undefined || isLegacyDefaultEfforts(efforts)
}

/**
 * Idempotently grant the full reasoning-level set to every custom model that
 * declares none — or that still carries the legacy four-level default — so
 * the native composer's reasoning-effort menu offers every level exactly like
 * a catalog model. Reads the user layer of the `llm-pi-ai` settings namespace
 * and writes the missing `reasoningEfforts` back through the same public
 * service; the file provider persists the change to `settings.yaml` and the
 * pi-ai adapter reads profiles live, so the next menu open shows the levels
 * without a restart. Capability-checked: a deployment without a usable
 * settings service skips with a warning instead of failing the plugin.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 * @param {string} label - log scope.
 */
export async function provisionCustomModelReasoning(ctx, label) {
  const settings = ctx.get('settings')
  if (settings === undefined || typeof settings.describe !== 'function' || typeof settings.mutate !== 'function') {
    console.warn(`${where(label)}: settings service unavailable; custom-model reasoning levels stay unconfigured`)
    return
  }
  let descriptor
  try {
    descriptor = settings.describe().find((entry) => entry.ns === LLM_PI_AI_NS)
  } catch (error) {
    console.warn(`${where(label)}: could not read settings: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  const providers = descriptor?.user?.providers
  if (providers === null || typeof providers !== 'object') return
  const ops = []
  for (const [route, profile] of Object.entries(providers)) {
    if (profile === null || typeof profile !== 'object') continue
    // `models` is an array, and settings path ops only traverse plain objects,
    // so one op replaces the whole array with every entry preserved and the
    // missing/legacy `reasoningEfforts` granted in place.
    if (Array.isArray(profile.models)) {
      const needsGrant = profile.models.some((model) => needsGrantEfforts(model?.reasoningEfforts))
      if (needsGrant) {
        ops.push({
          op: 'set',
          path: ['providers', route, 'models'],
          value: profile.models.map((model) => (
            needsGrantEfforts(model?.reasoningEfforts)
              ? { ...model, reasoningEfforts: { ...DEFAULT_REASONING_EFFORTS } }
              : model
          )),
        })
      }
    }
    // `modelOverrides` is a dict, so a per-entry op reaches each model directly.
    if (profile.modelOverrides !== null && typeof profile.modelOverrides === 'object') {
      for (const [modelId, model] of Object.entries(profile.modelOverrides)) {
        if (!needsGrantEfforts(model?.reasoningEfforts)) continue
        ops.push({
          op: 'set',
          path: ['providers', route, 'modelOverrides', modelId, 'reasoningEfforts'],
          value: { ...DEFAULT_REASONING_EFFORTS },
        })
      }
    }
  }
  if (ops.length === 0) return
  try {
    await settings.mutate(LLM_PI_AI_NS, ops, descriptor.revision)
    console.warn(`${where(label)}: granted/upgraded reasoning levels for ${ops.length} custom model(s)`)
  } catch (error) {
    console.warn(`${where(label)}: reasoning-level write failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Hard dependency on the `settings` service: Cordis waits for it before
 * activating this plugin, so the boot provision always sees the service
 * registered (settings is a fixed dsh-base row on every profile). The
 * provisioning pass still capability-checks `describe`/`mutate` as defense
 * against a provider that registers late or partially.
 */
export const inject = ['settings']

/**
 * Provision the reasoning menu once at boot, then again whenever the
 * llm-pi-ai section changes (settings.yaml hot-reloads, so a model added by
 * hand is provisioned too). The pass is idempotent — a pass with nothing
 * missing writes nothing — so our own writes cannot ping-pong.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 */
export function apply(ctx) {
  const provision = () => {
    void provisionCustomModelReasoning(ctx, 'provision').catch(() => {
      // Best-effort configuration aid; failures already warn inside the pass.
    })
  }
  provision()
  // A second pass after boot settles covers late namespace registration: the
  // pi-ai adapter registers its settings section during its own apply, and if
  // that lands after this plugin's boot pass no document event fires to retry.
  const lateTimer = setTimeout(() => provision(), 2000)
  // ctx.effect runs its callback immediately and stores the RETURNED value as
  // the disposer — so the callback must return the clear, never call it. Calling
  // clearTimeout here (as a statement) would kill the late timer at apply time
  // and the fallback pass would never fire.
  ctx.effect(() => () => clearTimeout(lateTimer), 'better-webui-reasoning: late provision')
  if (typeof ctx.root?.on === 'function') {
    const disposeSettingsWatcher = ctx.root.on('settings/document-updated', (ns) => {
      if (ns !== LLM_PI_AI_NS) return
      provision()
    })
    ctx.effect(() => disposeSettingsWatcher, 'better-webui-reasoning: provisioning watcher')
  }
}
