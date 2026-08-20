/**
 * Build the better-webui plugin artifacts (no compiler toolchain needed).
 *
 * - Host half: src/host.js is plain ESM — copied verbatim to lib/index.js,
 *   which the profile row loads as the package main.
 * - Client half: src/client.bundle.js is wrapped into the
 *   `window.__ModuleLoader__.load` factory envelope and emitted as
 *   lib/client.js — the file the client-modules registry serves at
 *   /plugins/<row>/client.js.
 *
 * The envelope's `require` resolves only the platform statics the bundle
 * consumes ('react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives');
 * everything else lives inside the factory body.
 *
 * Factory contract (ClientModuleSystem.materialize): the factory's RETURN
 * value is the module's exports, and the body runs as factory-form CJS — it
 * must declare its own `module`/`exports` prologue and end with
 * `return module.exports`, exactly like the official clientBundle output.
 * A body that assigns bare `exports.foo` without the prologue throws
 * "exports is not defined" and fails the whole browser boot.
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

const body = readFileSync(join(root, 'src/client.bundle.js'), 'utf8')
const bundle = `window.__ModuleLoader__.load({ id: '@blueriverlhr/dsh-better-webui', factory: (require) => {\n`
  + `var module = { exports: {} };\nvar exports = module.exports;\n`
  + `Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });\n`
  + `${body}\nreturn module.exports;\n} });\n`
writeFileSync(join(root, 'lib/client.js'), bundle)

copyFileSync(join(root, 'src/host.js'), join(root, 'lib/index.js'))
copyFileSync(join(root, 'src/web-search-exa.js'), join(root, 'lib/web-search-exa.js'))
console.log('better-webui: built lib/index.js, lib/web-search-exa.js, and lib/client.js')
