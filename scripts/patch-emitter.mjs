/**
 * Patch emitter — renders the plugin's controlled patch data into the YAML
 * shape `@deepseek-ai/cordis-plugin-include` consumes (a top-level array of
 * loader patch entries: id-targeted config overrides and `insert` lists).
 *
 * This is the single writer for every `cordis.patch.yml` in the repo. Keeping
 * one emitter (instead of hand-writing five near-identical YAML files) is the
 * Composition-Root half of the split: feature packages declare their patch as
 * plain JS data (`cordis.patch.js`), and the build emits both the per-feature
 * standalone patch and the aggregated meta patch from that one source, so the
 * two can never drift.
 *
 * The emitter intentionally supports only the shapes our patches use (ids,
 * names, plain config maps of scalars/arrays/objects). It does not attempt
 * general YAML: our patches need no anchors, aliases, tags, or `!!js`
 * expressions, so a small deterministic writer is safer than a parser.
 */

/**
 * Render one scalar/array/object config value at a given indentation into
 * emitter lines. YAML values inside `config:` are emitted inline.
 * @param {unknown} value - the config subtree.
 * @param {number} indent - indentation of the key line (in spaces).
 * @param {string[]} lines - accumulator.
 */
function emitValue(value, indent, lines) {
  const pad = ' '.repeat(indent)
  if (value === null) {
    lines.push(`${pad}null`)
  } else if (typeof value === 'string') {
    // Quote strings that YAML would otherwise parse as scalars of another type
    // (numbers, booleans, null, timestamps, "null"/"true"/"false" literals).
    lines.push(`${pad}${needsQuote(value) ? JSON.stringify(value) : value}`)
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    lines.push(`${pad}${String(value)}`)
  } else if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(`${pad}[]`)
    } else {
      lines.push(`${pad}-`)
      for (const item of value) emitValue(item, indent + 2, lines)
    }
  } else if (typeof value === 'object') {
    const keys = Object.keys(value)
    if (keys.length === 0) {
      lines.push(`${pad}{}`)
    } else {
      for (const key of keys) {
        const child = value[key]
        if (isScalar(child)) {
          const rendered = emitScalarInline(child)
          lines.push(`${pad}${key}: ${rendered}`)
        } else {
          lines.push(`${pad}${key}:`)
          emitValue(child, indent + 2, lines)
        }
      }
    }
  } else {
    throw new Error(`patch-emitter: unsupported config value of type ${typeof value}`)
  }
}

/** Render a scalar as an inline YAML value. */
function emitScalarInline(value) {
  if (value === null) return 'null'
  if (typeof value === 'string') return needsQuote(value) ? JSON.stringify(value) : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  throw new Error(`patch-emitter: expected a scalar, got ${typeof value}`)
}

/** Whether a value is a scalar (emitted inline) vs a collection (emitted as a block). */
function isScalar(value) {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

/** Quote a string that YAML would re-parse as a non-string scalar, or that
 * starts with a reserved indicator (`@` and backtick are reserved in YAML
 * 1.2 — scoped npm names like `@scope/pkg` MUST be quoted). */
function needsQuote(value) {
  return /^(?:null|true|false|~|yes|no|on|off|[-+]?\d+(?:\.\d+)?|0x[0-9a-f]+|0o[0-7]+)$/i.test(value)
    || /^[^\w./-]/.test(value)
    || /[:#\[\]{},&*!|>'"%@`]/.test(value)
    || /^\s|\s$/.test(value)
}

/**
 * Render one patch entry (an id-targeted override or an `insert` list).
 * @param {object} entry - `{ id, config? }` override or `{ insert: Row[] }`.
 * @param {string[]} lines - accumulator.
 */
function emitEntry(entry, lines) {
  if (entry === null || typeof entry !== 'object') {
    throw new Error('patch-emitter: each patch entry must be an object')
  }
  if (Array.isArray(entry.insert)) {
    lines.push('- insert:')
    for (const row of entry.insert) {
      lines.push(`    - id: ${row.id}`)
      lines.push(`      name: ${emitScalarInline(row.name)}`)
      if (row.config !== undefined) {
        lines.push('      config:')
        emitValue(row.config, 8, lines)
      }
      if (row.disabled !== undefined) {
        lines.push(`      disabled: ${row.disabled === true ? 'true' : 'false'}`)
      }
    }
    return
  }
  if (typeof entry.id !== 'string') {
    throw new Error('patch-emitter: an override entry must carry a string id')
  }
  lines.push(`- id: ${entry.id}`)
  if (entry.name !== undefined) lines.push(`  name: ${emitScalarInline(entry.name)}`)
  if (entry.config !== undefined) {
    lines.push('  config:')
    emitValue(entry.config, 4, lines)
  }
}

/**
 * Render a patch list to YAML text (trailing newline).
 * @param {object[]} entries - the patch entries.
 * @returns {string} the YAML document.
 */
export function emitPatch(entries) {
  const lines = []
  for (const entry of entries) emitEntry(entry, lines)
  return lines.length > 0 ? lines.join('\n') + '\n' : '[]\n'
}

/**
 * The aggregated meta patch's leading comment — makes the generated nature of
 * `cordis.patch.yml` self-documenting and states the install rule.
 */
export const META_HEADER = `# @blueriverlhr/dsh-better-webui — aggregated bundle patch (GENERATED).
# Source of truth: each package's cordis.patch.js. Run \`npm run build\` to
# regenerate. Install THIS bundle, or individual feature bundles — never both
# (a duplicate row id would mount the same plugin twice).
`
