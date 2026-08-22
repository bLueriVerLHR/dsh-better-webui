/**
 * Patch composer — the Composition Root of the split.
 *
 * Each feature package owns its patch as plain JS data in `cordis.patch.js`
 * (its row plus any profile-level overrides it genuinely owns, e.g. search's
 * `web` row switch). This module aggregates those sources and writes:
 *
 *   - `packages/<feature>/cordis.patch.yml` — the feature's own standalone
 *     bundle layer (so a feature is installable on its own), and
 *   - the root `cordis.patch.yml` — the meta bundle's aggregated layer that
 *     mounts every feature (so installing the meta installs all features).
 *
 * One source of truth, two artifacts: the aggregated file is generated, never
 * hand-edited, so the standalone and aggregate views cannot drift. The
 * composition test (`tests/composition.mjs`) verifies the committed files
 * match this render.
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { META_HEADER, emitPatch } from './patch-emitter.mjs'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const root = join(scriptsDir, '..')

/** Feature packages in stable aggregation order. */
const FEATURES = [
  'archive',
  'reasoning',
  'chime',
  'search',
  'bashguard',
]

/** Import one feature's patch source (default export: the patch data array). */
async function loadFeature(name) {
  const module = await import(join(root, 'packages', name, 'cordis.patch.js'))
  const data = module.default
  if (!Array.isArray(data)) {
    throw new Error(`compose-patch: packages/${name}/cordis.patch.js must default-export an array`)
  }
  return data
}

/**
 * Emit every feature's standalone patch plus the aggregated meta patch.
 * @returns {{ meta: string, features: Record<string, string> }} the rendered documents.
 */
export async function composePatches() {
  const rendered = {}
  const all = []
  for (const name of FEATURES) {
    const data = await loadFeature(name)
    rendered[name] = emitPatch(data)
    all.push(...data)
  }
  const meta = META_HEADER + emitPatch(all)
  return { meta, features: rendered }
}

/**
 * Write the composed patches to disk (used by the root build).
 */
export async function writeComposedPatches() {
  const { meta, features } = await composePatches()
  for (const [name, text] of Object.entries(features)) {
    writeFileSync(join(root, 'packages', name, 'cordis.patch.yml'), text)
  }
  writeFileSync(join(root, 'cordis.patch.yml'), meta)
}
