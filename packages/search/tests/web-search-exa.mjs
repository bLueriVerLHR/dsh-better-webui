/**
 * Host-half test for the keyless Exa search provider (src/web-search-exa.js):
 * registration into a mocked `ctx.web`, the anonymous MCP request shape (no
 * credentials, x-exa-source attribution, JSON-RPC tools/call), SSE response
 * parsing into normalized sources, the 429 rate-limit path, the REST path when
 * an EXA_API_KEY is present, and abort/error mapping.
 *
 * Run: node tests/web-search-exa.mjs
 */
import assert from 'node:assert/strict'
import * as exa from '../src/web-search-exa.js'

const results = []
const check = (ok, label) => { results.push([ok, label]); console.log(`  ${ok ? '✓' : '✗'} ${label}`) }
// Duck-type the seam's WebError (the package is a profile peer, not a project
// devDependency): it must be an Error carrying the machine-routable `code`.
const isWebError = (err, code) => err instanceof Error && err.code === code

/* --- mocked ctx.web --- */
const registered = []
const web = {
  registerSearchProvider(provider) {
    registered.push(provider)
    return () => { registered.splice(registered.indexOf(provider), 1) }
  },
}
/* 1. registration wires the provider with id `exa` and always-usable. */
const dispose = exa.registerExaSearchProvider(web)
check(registered.length === 1, 'provider 注册进 ctx.web')
const provider = registered[0]
check(provider.id === 'exa', `provider id 为 "exa"（实际 ${provider.id}）`)
check(provider.available() === true, 'available() 恒 true（无凭证也可用）')
dispose()
check(registered.length === 0, 'disposer 注销 provider')

/* 2. anonymous MCP request shape: JSON-RPC, no credentials, attribution header. */
let captured
const mcpText = 'Title: Example Result\nURL: https://example.com/a\nPublished Date: 2026-01-02\nHighlights:\n- a great highlight sentence here\n\n'
  + 'Title: No Snippet\nURL: https://example.com/b\n\n'
const mcpPayload = { jsonrpc: '2.0', id: '1', result: { content: [{ type: 'text', text: mcpText }] } }
const sseBody = `event: message\ndata: ${JSON.stringify(mcpPayload)}`
globalThis.fetch = async (url, init) => {
  captured = { url, init }
  return {
    ok: true,
    status: 200,
    async text() { return sseBody },
  }
}
delete process.env.EXA_API_KEY
const mcpResult = await provider.search({ query: 'test query', maxResults: 5 })
check(captured.url === 'https://mcp.exa.ai/mcp', '匿名路径打 mcp.exa.ai/mcp')
const body = JSON.parse(captured.init.body)
check(body.jsonrpc === '2.0' && body.method === 'tools/call', 'JSON-RPC 2.0 tools/call')
check(body.params.name === 'web_search_exa', 'MCP 工具名 web_search_exa')
check(body.params.arguments.query === 'test query', 'query 透传')
check(body.params.arguments.numResults === 5, 'maxResults 透传为 numResults')
check(captured.init.headers.authorization === undefined, '匿名路径不带凭据头')
check(captured.init.headers['x-exa-source'] === 'dsh-better-webui', 'x-exa-source 归属头')
check(mcpResult.sources.length === 1, 'SSE 解析出 1 个带 snippet 的结果（无 snippet 的丢弃）')
check(mcpResult.sources[0].url === 'https://example.com/a', '结果 url 正确')
check(mcpResult.sources[0].snippet.includes('great highlight'), '结果 snippet 取自 Highlights')
check(mcpResult.sources[0].publishedAt === '2026-01-02', 'publishedAt 取自 Published Date')
check(mcpResult.truncated === false, 'provider 不自行截断')

/* 3. 429 rate limit surfaces WEB_PROVIDER_ERROR with the upgrade hint. */
globalThis.fetch = async () => ({ ok: false, status: 429, async json() { return { error: 'rate limited' } } })
await assert.rejects(
  () => provider.search({ query: 'x' }),
  (err) => isWebError(err, 'WEB_PROVIDER_ERROR') && /EXA_API_KEY/.test(err.message),
  '429 抛 WEB_PROVIDER_ERROR 并提示配置 EXA_API_KEY',
).then(() => check(true, '429 抛 WEB_PROVIDER_ERROR 并提示配置 EXA_API_KEY'))

/* 4. REST path when a key is present: Bearer auth, no MCP. */
globalThis.fetch = async (url, init) => {
  captured = { url, init }
  return {
    ok: true,
    status: 200,
    async json() {
      return { results: [{ url: 'https://example.com/r', title: 'R', highlights: ['rest snippet'], publishedDate: '2026-03-04' }] }
    },
  }
}
process.env.EXA_API_KEY = 'test-key-123'
const restResult = await provider.search({ query: 'rest query' })
check(captured.url === 'https://api.exa.ai/search', '有 key 时走 REST /search')
check(captured.init.headers.authorization === 'Bearer test-key-123', 'REST 带 Bearer 认证')
check(captured.init.headers['x-exa-source'] === undefined, 'REST 不带 MCP 归属头')
check(restResult.sources[0].url === 'https://example.com/r', 'REST 结果映射正确')
check(restResult.sources[0].snippet === 'rest snippet', 'REST snippet 取自 highlights')
delete process.env.EXA_API_KEY

/* 5. abort mapping: a pre-aborted signal throws WEB_ABORTED. */
const aborted = new AbortController()
aborted.abort(new Error('user stopped'))
await assert.rejects(
  () => provider.search({ query: 'x' }, aborted.signal),
  (err) => isWebError(err, 'WEB_ABORTED'),
  'abort 抛 WEB_ABORTED',
).then(() => check(true, 'abort 抛 WEB_ABORTED'))

/* 6. malformed MCP payload (no parseable data) surfaces WEB_PROVIDER_ERROR. */
globalThis.fetch = async () => ({ ok: true, status: 200, async text() { return 'not json' } })
await assert.rejects(
  () => provider.search({ query: 'x' }),
  (err) => isWebError(err, 'WEB_PROVIDER_ERROR'),
  '不可解析响应抛 WEB_PROVIDER_ERROR',
).then(() => check(true, '不可解析响应抛 WEB_PROVIDER_ERROR'))

/* summary */
const failed = results.filter(([ok]) => !ok)
console.log(`\nweb-search-exa: ${results.length - failed.length}/${results.length} passed`)
if (failed.length > 0) {
  console.error('failed:', failed.map(([, label]) => label))
  process.exit(1)
}
