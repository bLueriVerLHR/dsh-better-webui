/**
 * Envelope check across every client package: execute each package's
 * lib/client.js exactly the way the browser's ClientModuleSystem does
 * (packages/client/modules/src/client/system.ts):
 *   1. a `window.__ModuleLoader__` sink captures the handoff,
 *   2. the bundle file runs as a classic script,
 *   3. `factory(require)` is called with a platform-static require stub,
 *   4. the RETURN value must be the module exports carrying inject/apply,
 *   5. apply() registers exactly the slots that package owns.
 *
 * Run: node tests/client-envelope.mjs   (exit 0 = pass, prints a summary)
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))

/**
 * Per-client-package expectations: bundle id and the exact slot names apply()
 * must register.
 */
const CLIENT_PACKAGES = [
  {
    dir: 'packages/archive',
    id: '@blueriverlhr/dsh-better-webui-archive',
    slots: ['settings.section'],
  },
  {
    dir: 'packages/chime',
    id: '@blueriverlhr/dsh-better-webui-chime',
    slots: ['conversation.input.dock'],
  },
  {
    dir: 'packages/settings',
    id: '@blueriverlhr/dsh-better-webui-settings',
    slots: ['settings.section'],
  },
  {
    dir: 'packages/retry',
    id: '@blueriverlhr/dsh-better-webui-retry',
    slots: ['settings.section'],
  },
  {
    dir: 'packages/modelparams',
    id: '@blueriverlhr/dsh-better-webui-modelparams',
    slots: ['conversation.input.left'],
  },
]

// React resolves from the installed dsh's node_modules — the same copies the
// browser platform table seeds. If that install does not bundle react-dom
// (e.g. a dsh that only carries react), fall back to this repo's own
// node_modules, which pins the same react + react-dom 18.3.1.
const platformRoot = '/home/archie/.nvm/versions/node/v24.18.0/lib/node_modules/@deepseek-ai/dsh/node_modules'
let nodeRequire = createRequire(join(platformRoot, 'react', 'index.js'))
try {
  nodeRequire('react-dom')
} catch {
  nodeRequire = createRequire(join(root, 'node_modules/react/index.js'))
}

const failures = []
const check = (ok, what) => { if (!ok) failures.push(what) }

for (const pkg of CLIENT_PACKAGES) {
  const label = pkg.id
  const source = readFileSync(join(root, pkg.dir, 'lib/client.js'), 'utf8')

  // 1+2: capture the handoff by running the file as a classic script.
  let handoff
  const window = {
    __ModuleLoader__: {
      load(h) { if (handoff !== undefined) throw new Error('duplicate registration'); handoff = h },
    },
  }
  new Function('window', source)(window)
  check(handoff !== undefined, `${label}: bundle never called __ModuleLoader__.load`)
  if (handoff === undefined) continue
  check(handoff.id === pkg.id, `${label}: handoff id mismatch (${handoff.id})`)
  check(typeof handoff.factory === 'function', `${label}: handoff.factory is not a function`)

  // 3: platform-static require stub.
  const requireEdges = new Set()
  const require = (spec) => {
    requireEdges.add(spec)
    if (spec === 'react' || spec === 'react-dom') return nodeRequire(spec)
    if (spec === '@deepseek-ai/dsh-client-ui-primitives') {
      return new Proxy({}, { get: () => (_props) => null })
    }
    throw new Error(`require("${spec}") missed the module table`)
  }

  // 4: materialize; the return value IS the module exports.
  const exports = handoff.factory(require)
  check(Array.isArray(exports.inject), `${label}: exports.inject is not an array`)
  check(typeof exports.apply === 'function', `${label}: exports.apply is not a function`)
  check(requireEdges.size > 0, `${label}: factory required no platform modules`)

  // 5: apply registers exactly this package's slots.
  const registrations = []
  const ctx = {
    slots: {
      inject: (name, register) => { registrations.push(name); return register() },
      register: () => () => {},
    },
    locale: { register: () => () => {}, bind: () => (key) => key },
    effect: (dispose) => dispose,
  }
  exports.apply(ctx)
  check(JSON.stringify(registrations) === JSON.stringify(pkg.slots),
    `${label}: apply registers ${pkg.slots.join(', ')} (got: ${registrations.join(', ') || 'none'})`)
  console.log(`client envelope OK: ${label} | slots = ${registrations.join(', ')} | edges = ${[...requireEdges].join(', ')}`)
}

if (failures.length > 0) {
  console.error('FAIL:', failures.join('\n  '))
  process.exit(1)
}
console.log('\nclient-envelope: all packages pass')
