/**
 * Host-half test for the thinking-tag splitter (`llm/stream` waterfall):
 * thinking text leaked into the text channel (with literal  response /
 * `</thinking>` closing tags) is split into a reasoning block, and empty
 * upstream reasoning blocks (block-start with no reasoning-delta, empty
 * text) are CLEARED — dropped without emitting block-start/block-end — or
 * MERGED into a following content reasoning block, so the UI never shows an
 * empty Think box. Content reasoning blocks are always preserved.
 *
 * Run: node tests/splitter.mjs
 */
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import * as host from '../src/host.js'

const results = []
const check = (ok, label) => { results.push([ok, label]); console.log(`  ${ok ? '✓' : '✗'} ${label}`) }

/* --- real literal closing tag, built byte-by-byte (writing it literally gets mangled into "response") --- */
const TT_CLOSE = String.fromCharCode(60, 47, 116, 104, 105, 110, 107, 62) //  response

/* --- a minimal ctx that captures the llm/stream waterfall listener --- */
const home = mkdtempSync(join(tmpdir(), 'bwt-split-'))
process.env.DSH_HOME = home
mkdirSync(join(home, 'sessions', 'proj'), { recursive: true })

const listeners = [] // [event, callback]
const ctx = {
  effect(fn) { return fn() ?? (() => {}) },
  connection: { rpc: { handle: () => () => {} } },
  get: () => undefined,
  on: (event, callback) => { listeners.push([event, callback]); return () => {} },
  root: { on: () => () => {} },
}
host.apply(ctx)
await new Promise((resolve) => setTimeout(resolve, 20))
const streamListener = listeners.find(([event]) => event === 'llm/stream')?.[1]
check(typeof streamListener === 'function', 'llm/stream waterfall 监听器已注册')

/* --- helpers --- */
const b = (index, blockType) => ({ type: 'block-start', index, blockType })
const td = (index, text) => ({ type: 'text-delta', index, text })
const rd = (index, text) => ({ type: 'reasoning-delta', index, text })
const be = (index, block) => ({ type: 'block-end', index, block })
const fin = () => ({ type: 'finish', reason: 'stop' })

/** Feed chunks through the scnet splitter and collect the emitted stream. */
async function run(chunks, options = { provider: 'scnet', purpose: null }) {
  const emitted = []
  const transformed = streamListener(options, () => (async function* () {
    for (const chunk of chunks) yield chunk
  })())
  for await (const chunk of transformed) emitted.push(chunk)
  return emitted
}

const json = (arr) => JSON.stringify(arr)

/* 1. empty reasoning + plain text -> empty dropped, text unchanged. */
{
  const input = [
    b(0, 'reasoning'), be(0, { type: 'reasoning', text: '' }),
    b(1, 'text'), td(1, 'Hello world'), be(1, { type: 'text', text: 'Hello world' }),
    fin(),
  ]
  const expected = [
    b(1, 'text'), td(1, 'Hello world'), be(1, { type: 'text', text: 'Hello world' }),
    fin(),
  ]
  const out = await run(input)
  check(!out.some((c) => c.blockType === 'reasoning' || c.block?.type === 'reasoning'),
    '空 reasoning 块不发射任何 reasoning 块')
  check(json(out) === json(expected), '空块清除后其余 text 块原样保留')
}

/* 2. empty reasoning + content reasoning -> merge into one content block. */
{
  const input = [
    b(0, 'reasoning'), be(0, { type: 'reasoning', text: '' }),
    b(1, 'reasoning'), rd(1, 'thinking...'), be(1, { type: 'reasoning', text: 'thinking...' }),
    fin(),
  ]
  const expected = [
    b(1, 'reasoning'), rd(1, 'thinking...'), be(1, { type: 'reasoning', text: 'thinking...' }),
    fin(),
  ]
  const out = await run(input)
  check(json(out) === json(expected), '空块与后续内容块合并成一个 reasoning 块')
}

/* 3. empty reasoning + text-with-marker -> empty dropped, text split. */
{
  const leaked = `Let me check.${TT_CLOSE}The answer is 42.`
  const input = [
    b(0, 'reasoning'), be(0, { type: 'reasoning', text: '' }),
    b(1, 'text'), td(1, leaked), be(1, { type: 'text', text: leaked }),
    fin(),
  ]
  const expected = [
    b(1000, 'reasoning'), rd(1000, 'Let me check.'), be(1000, { type: 'reasoning', text: 'Let me check.' }),
    b(1001, 'text'), td(1001, 'The answer is 42.'), be(1001, { type: 'text', text: 'The answer is 42.' }),
    fin(),
  ]
  const out = await run(input)
  check(json(out) === json(expected), '空块清除后，泄漏思考被切分为 reasoning + text')
}

/* 4. multiple empty blocks + content -> all merged into one. */
{
  const input = [
    b(0, 'reasoning'), be(0, { type: 'reasoning', text: '' }),
    b(1, 'reasoning'), be(1, { type: 'reasoning', text: '' }),
    b(2, 'reasoning'), rd(2, 'real thinking'), be(2, { type: 'reasoning', text: 'real thinking' }),
    fin(),
  ]
  const expected = [
    b(2, 'reasoning'), rd(2, 'real thinking'), be(2, { type: 'reasoning', text: 'real thinking' }),
    fin(),
  ]
  const out = await run(input)
  check(json(out) === json(expected), '连续多个空块全部并入一个有内容的 reasoning 块')
}

/* 5. two content reasoning blocks -> both preserved, not merged. */
{
  const input = [
    b(0, 'reasoning'), rd(0, 'A'), be(0, { type: 'reasoning', text: 'A' }),
    b(1, 'reasoning'), rd(1, 'B'), be(1, { type: 'reasoning', text: 'B' }),
    fin(),
  ]
  const expected = input
  const out = await run(input)
  check(json(out) === json(expected), '有内容的 reasoning 块不被清除、互不合并')
}

/* 6. non-scnet provider -> passthrough (empty reasoning block preserved). */
{
  const input = [
    b(0, 'reasoning'), be(0, { type: 'reasoning', text: '' }),
    b(1, 'text'), td(1, 'Hi'), be(1, { type: 'text', text: 'Hi' }),
    fin(),
  ]
  const out = await run(input, { provider: 'openai', purpose: null })
  check(json(out) === json(input), '非 scnet provider 原样透传（含空 reasoning 块）')
}

/* 7. auxiliary purpose -> passthrough. */
{
  const input = [
    b(0, 'reasoning'), be(0, { type: 'reasoning', text: '' }),
    b(1, 'text'), td(1, 'Hi'), be(1, { type: 'text', text: 'Hi' }),
    fin(),
  ]
  const out = await run(input, { provider: 'scnet', purpose: 'compaction' })
  check(json(out) === json(input), '辅助调用（compaction）原样透传')
}

/* 8. unclosed empty reasoning at finish -> dropped. */
{
  const input = [b(0, 'reasoning'), fin()]
  const expected = [fin()]
  const out = await run(input)
  check(json(out) === json(expected), '流结束时未闭合的空 reasoning 块被丢弃')
}

/* 9. unclosed content reasoning at finish -> closed cleanly. */
{
  const input = [b(0, 'reasoning'), rd(0, 'partial'), fin()]
  const expected = [
    b(0, 'reasoning'), rd(0, 'partial'),
    be(0, { type: 'reasoning', text: 'partial' }),
    fin(),
  ]
  const out = await run(input)
  check(json(out) === json(expected), '流结束时未闭合的有内容块被干净闭合')
}

/* 10. reasoning content that arrives only on block-end (no deltas) is kept. */
{
  const input = [
    b(0, 'reasoning'), be(0, { type: 'reasoning', text: 'direct' }),
    fin(),
  ]
  const expected = [
    b(0, 'reasoning'), rd(0, 'direct'), be(0, { type: 'reasoning', text: 'direct' }),
    fin(),
  ]
  const out = await run(input)
  check(json(out) === json(expected), '仅 block-end 携带内容的 reasoning 块不被误判为空')
}

const failed = results.filter(([ok]) => !ok)
console.log(failed.length === 0 ? '\n全部通过 ✓' : `\n${failed.length} 项失败`)
process.exit(failed.length === 0 ? 0 : 1)
