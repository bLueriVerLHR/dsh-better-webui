/**
 * Envelope check: execute lib/client.js exactly the way the browser's
 * ClientModuleSystem does (packages/client/modules/src/client/system.ts):
 *   1. a `window.__ModuleLoader__` sink captures the handoff,
 *   2. the bundle file runs as a classic script,
 *   3. `factory(require)` is called with a platform-static require stub,
 *   4. the RETURN value must be the module exports carrying inject/apply.
 *
 * Run: node tests/client-envelope.mjs   (exit 0 = pass, prints a summary)
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const source = readFileSync(join(root, 'lib/client.js'), 'utf8')

// --- 1+2: capture the handoff by running the file as a classic script ---
let handoff = undefined
const window = {
  __ModuleLoader__: {
    load(h) { if (handoff !== undefined) throw new Error('duplicate registration'); handoff = h },
  },
}
new Function('window', source)(window)

if (handoff === undefined) throw new Error('bundle never called __ModuleLoader__.load')
if (handoff.id !== '@better-webui/better-webui') throw new Error(`handoff id mismatch: ${handoff.id}`)
if (typeof handoff.factory !== 'function') throw new Error('handoff.factory is not a function')

// --- 3: platform-static require stub (the real table resolves these seeds) ---
// react/react-dom resolve from the installed dsh's node_modules — the same
// copies the browser platform table seeds.
const platformRoot = '/home/archie/.nvm/versions/node/v24.18.0/lib/node_modules/@deepseek-ai/dsh/node_modules'
const nodeRequire = createRequire(join(platformRoot, 'react', 'index.js'))
const requireEdges = new Set()
const require = (spec) => {
  requireEdges.add(spec)
  if (spec === 'react' || spec === 'react-dom') {
    // React itself must be the real one: the bundle reads React.createElement
    // and calls ReactDOM.createPortal at render time (not at factory time).
    return nodeRequire(spec)
  }
  if (spec === '@deepseek-ai/dsh-client-ui-primitives') {
    return new Proxy({}, { get: (_t, key) => (_props) => null })
  }
  throw new Error(`require("${spec}") missed the module table`)
}

// --- 4: materialize; the return value IS the module exports ---
const exports = handoff.factory(require)

const failures = []
const check = (ok, what) => { if (!ok) failures.push(what) }

check(Array.isArray(exports.inject), `exports.inject is an array (got ${typeof exports.inject})`)
check(typeof exports.apply === 'function', `exports.apply is a function (got ${typeof exports.apply})`)
check(requireEdges.size > 0, `factory required its platform modules (edges: ${[...requireEdges].join(', ') || 'none'})`)

// apply must run against a ctx stub without touching anything but slots/locale/effect.
const registrations = []
const ctx = {
  slots: {
    inject: (name, register) => { registrations.push(name); return register() },
    register: () => () => {},
  },
  locale: { register: () => () => {} },
  effect: (dispose) => dispose,
}
exports.apply(ctx)
check(registrations.length === 1 && registrations.includes('settings.section'),
  `apply registers exactly the settings section slot (got: ${registrations.join(', ') || 'none'})`)

if (failures.length > 0) {
  console.error('FAIL:', failures.join('; '))
  process.exit(1)
}
console.log('client envelope OK: inject =', JSON.stringify(exports.inject),
  '| slots =', registrations.join(', '), '| edges =', [...requireEdges].join(', '))
