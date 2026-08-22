/**
 * Shared browser test harness for the better-webui client packages.
 *
 * Both client smoke tests drive the SAME real environment: a jsdom DOM, the
 * app's exact React version, the module-loader envelope, and a platform-static
 * require stub. This module is that shared setup (the Template Method) so a
 * package smoke test only supplies its bundle path and mock ctx.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import * as P from './primitives-stub.mjs'

/** Anchor module resolution at this file: Node walks up to the repo root node_modules. */
const require_ = createRequire(import.meta.url)

const React = require_('react')
const ReactDOM = require_('react-dom')
const ReactDOMClient = require_('react-dom/client')

/**
 * Set up a jsdom browser and the platform-static require stub the bundles see.
 * @returns the browser handles the smoke tests need.
 */
export function createBrowser() {
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', {
    url: 'http://127.0.0.1:3080/',
    pretendToBeVisual: true,
  })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  try { globalThis.navigator = dom.window.navigator } catch { /* Node 24 exposes navigator read-only */ }
  globalThis.HTMLElement = dom.window.HTMLElement
  globalThis.Element = dom.window.Element
  globalThis.Node = dom.window.Node
  globalThis.getComputedStyle = dom.window.getComputedStyle

  const sandboxRequire = (spec) => {
    if (spec === 'react') return React
    if (spec === 'react-dom') return ReactDOM
    if (spec === '@deepseek-ai/dsh-client-ui-primitives') return P
    throw new Error('unexpected require: ' + spec)
  }
  return { dom, React, ReactDOM, ReactDOMClient, h: React.createElement, sandboxRequire }
}

/**
 * Load a built client bundle exactly the way the browser's ClientModuleSystem
 * does: run the file through the `window.__ModuleLoader__.load` envelope, then
 * materialize the factory; the RETURN value is the module exports.
 * @param {ReturnType<typeof createBrowser>} browser - the browser handles.
 * @param {string} bundlePath - absolute path to the package's lib/client.js.
 * @returns the plugin module exports (with `inject` / `apply`).
 */
export function loadClientBundle(browser, bundlePath) {
  const source = readFileSync(bundlePath, 'utf8')
  if (!source.startsWith('window.__ModuleLoader__.load(')) {
    throw new Error(`client bundle missing envelope: ${bundlePath}`)
  }
  const captured = {}
  browser.dom.window.__ModuleLoader__ = { load: (handoff) => { captured.handoff = handoff } }
  const run = new Function('require', 'window', 'document', source)
  run(browser.sandboxRequire, browser.dom.window, browser.dom.window.document)
  const handoff = captured.handoff
  if (handoff === undefined) throw new Error('bundle did not register its factory')
  const moduleExports = handoff.factory(browser.sandboxRequire)
  if (moduleExports === undefined || typeof moduleExports.apply !== 'function') {
    throw new Error('factory return value is not a plugin (loader uses the RETURN value as exports)')
  }
  return moduleExports
}

/**
 * A locale `t` over a registered dictionary (zh by default), with {param}
 * substitution — mirrors what the slot system's `locale` seat provides.
 */
export function makeLocaleT() {
  const dicts = {}
  const t = (key, params) => {
    let text = dicts.zh[key] ?? key
    if (params !== undefined) {
      for (const [name, value] of Object.entries(params)) {
        text = text.replace(`{${name}}`, String(value))
      }
    }
    return text
  }
  return { dicts, t }
}

/** Convenience: absolute path of a file inside a feature package. */
export function packagePath(pkg, ...rest) {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'packages', pkg, ...rest)
}
