/**
 * Composition test — the guardrail that keeps the generated patches honest.
 *
 * The repo's patch files are produced by scripts/compose-patch.mjs from each
 * feature's cordis.patch.js source of truth. This test re-renders every patch
 * from those sources and asserts the committed files are byte-identical, so a
 * hand edit that drifts from the source (or a source change that was never
 * rebuilt) fails CI instead of shipping a stale composition.
 *
 * Run: node tests/composition.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { META_HEADER, emitPatch } from '../scripts/patch-emitter.mjs'
import { composePatches } from '../scripts/compose-patch.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const failures = []
const check = (ok, label) => {
  if (ok) console.log(`  ✓ ${label}`)
  else { console.log(`  ✗ ${label}`); failures.push(label) }
}

const { meta, features } = await composePatches()
const featureNames = Object.keys(features).sort()

/* 1. every feature's standalone patch file matches its source. */
for (const name of featureNames) {
  const file = readFileSync(join(root, 'packages', name, 'cordis.patch.yml'), 'utf8')
  check(file === features[name], `${name}/cordis.patch.yml 与 cordis.patch.js 源一致`)
}

/* 2. the aggregated meta patch is the header + the concatenation. */
const metaFile = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
check(metaFile === meta, '根 cordis.patch.yml 是各 feature 源按序聚合（含说明头）')

/* 3. the meta patch mounts every feature exactly once. */
const insertIds = [...meta.matchAll(/id: (better-webui-[a-z]+)/g)].map((m) => m[1])
for (const name of featureNames) {
  const expected = `better-webui-${name}`
  check(insertIds.filter((id) => id === expected).length === 1, `元包 patch 恰好挂载一次 ${expected}`)
}

/* 4. the search feature carries the web-seam override (a global wiring). */
check(meta.includes('searchProvider: exa'), '元包 patch 含 web 行 searchProvider: exa 覆盖')
check(features.search.includes('searchProvider: exa'), 'search 独立 patch 也含 web 行覆盖')

/* 5. the patch files parse as YAML arrays (structural sanity). */
for (const name of featureNames) {
  const text = features[name]
  check(/^-\s+(insert:|id:)/m.test(text), `${name}/cordis.patch.yml 是顶层数组条目`)
}

console.log(failures.length === 0 ? '\ncomposition: 全部通过 ✓' : `\ncomposition: ${failures.length} 项失败`)
process.exit(failures.length === 0 ? 0 : 1)
