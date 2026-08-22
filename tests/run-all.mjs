/**
 * Test runner — executes every package test plus the repo-wide guardrails
 * (composition + client envelope) in one command: `npm test`.
 *
 * Each test is a plain node script that exits non-zero on failure, so this
 * runner is just an ordered spawner with a summary; a failing test stops the
 * run (fail fast) so the failure surface stays small.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const testsDir = dirname(fileURLToPath(import.meta.url))
const root = join(testsDir, '..')

const tests = [
  'packages/archive/tests/host.mjs',
  'packages/archive/tests/smoke.mjs',
  'packages/reasoning/tests/reasoning.mjs',
  'packages/chime/tests/smoke.mjs',
  'packages/search/tests/web-search-exa.mjs',
  'packages/bashguard/tests/stall-guard.mjs',
  'packages/settings/tests/host.mjs',
  'packages/settings/tests/smoke.mjs',
  'packages/modelparams/tests/host.mjs',
  'packages/modelparams/tests/smoke.mjs',
  'tests/composition.mjs',
  'tests/client-envelope.mjs',
]

console.log(`running ${tests.length} test scripts\n`)
let failed = 0
for (const test of tests) {
  process.stdout.write(`── ${test} ──\n`)
  const result = spawnSync(process.execPath, [join(root, test)], { stdio: 'inherit' })
  if (result.status !== 0) {
    console.error(`\n✗ ${test} failed (exit ${result.status})`)
    failed += 1
    break
  }
  console.log('')
}

if (failed > 0) {
  console.error(`test suite failed: ${failed} test script(s) failed`)
  process.exit(1)
}
console.log('all test scripts passed')
