/**
 * Host-half test for the `/better-webui` channel: restore / destroy / purge
 * against a real temp DSH_HOME (fixture dirs + storages/workspace.json +
 * legacy trash.json) and a mocked service registry. This is the check that
 * "delete forever" really deletes: session dir, trash-area copy, trash
 * record, archive-set entry, and workspace accounting slot all end up clean.
 *
 * Run: node tests/host.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import * as host from '../src/host.js'

/* --- fixture DSH_HOME --- */
const home = mkdtempSync(join(tmpdir(), 'bwt-host-'))
process.env.DSH_HOME = home
const proj = join(home, 'sessions', 'proj')
mkdirSync(proj, { recursive: true })
const sessionDir = (id) => join(proj, id)
for (const id of ['session-a1', 'session-live2', 'session-moved']) {
  mkdirSync(sessionDir(id), { recursive: true })
  writeFileSync(join(sessionDir(id), 'session.jsonl'), `{"type":"session/start","seq":1}\n`)
}

const storageFile = join(home, 'storages', 'workspace.json')
const state = {
  global: { initialized: true, workspaceIds: ['w1'], archivedSessionIds: ['session-a1', 'session-dead1'] },
  tables: { workspaces: { w1: { path: '/w', title: 'W', sessionIds: ['session-a1', 'session-live2', 'session-dead2'], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } } },
}
const persistStorage = () => {
  mkdirSync(join(home, 'storages'), { recursive: true })
  writeFileSync(storageFile, JSON.stringify(state, null, 2))
}
persistStorage()

const trashRoot = join(home, 'better-webui', 'trash')
mkdirSync(join(trashRoot, 'session-moved'), { recursive: true })
writeFileSync(join(trashRoot, 'session-moved', 'session.jsonl'), '{"type":"session/start","seq":1}\n')
const trashFile = join(trashRoot, 'trash.json')
writeFileSync(trashFile, `${JSON.stringify([{
  sessionId: 'session-moved', title: '搬走的', cwd: '/w', trashedAt: 1,
  sessionDir: sessionDir('session-moved'), trashDir: join(trashRoot, 'session-moved'),
}], null, 2)}\n`)

/* --- mocked services --- */
const registryState = { archivedSessionIds: [...state.global.archivedSessionIds] }
const table = state.tables.workspaces
const entity = {
  async detachSession(id) {
    table.w1.sessionIds = table.w1.sessionIds.filter((candidate) => candidate !== id)
    persistStorage()
  },
}
const services = {
  sessions: { get: () => undefined, list: () => [], flush: async () => false },
  agents: { get: () => undefined },
  sessionPersistence: {
    list: async () => [{ id: 'session-a1', cwd: '/w' }, { id: 'session-live2', cwd: '/w' }].map((header) => header),
    locate: (header) => ({ path: join(sessionDir(header.id), 'session.jsonl') }),
  },
  workspaceRegistry: {
    get archivedSessionIds() { return registryState.archivedSessionIds },
    list: () => [entity],
    enqueueOperation: (op) => op(),
    requireState: () => registryState,
    setState(next) {
      // Mirror the real registry: the global (archive set) persists too.
      registryState.archivedSessionIds = next.archivedSessionIds
      state.global.archivedSessionIds = [...next.archivedSessionIds]
      persistStorage()
    },
  },
}

let handler
const ctx = {
  effect(fn) { return fn() ?? (() => {}) },
  connection: { rpc: { handle: (channel, h) => { handler = h; return () => {} } } },
  get: (name) => services[name],
}
host.apply(ctx)
await new Promise((resolve) => setTimeout(resolve, 20)) // boot sweep

const archiveSet = () => registryState.archivedSessionIds
const accounting = () => table.w1.sessionIds
const trashIndex = () => JSON.parse(readFileSync(trashFile, 'utf8'))
const results = []
const check = (ok, label) => { results.push([ok, label]); console.log(`  ${ok ? '✓' : '✗'} ${label}`) }

/* 1. boot sweep: dead archive id purged, dead accounting id detached. */
check(!archiveSet().includes('session-dead1'), '启动清扫：死归档 id 移出归档集')
check(!accounting().includes('session-dead2'), '启动清扫：死记账 id 从工作区记账移除')
check(archiveSet().includes('session-a1'), '启动清扫不动活归档 id')

/* 2. destroy a live-archived session: dir + archive set + accounting all clean. */
let r = await handler('destroy', { sessionId: 'session-a1' })
check(r.ok === true && r.value.destroyed === true, 'destroy 返回成功')
check(!existsSync(sessionDir('session-a1')), '会话目录已删除')
check(!archiveSet().includes('session-a1'), '归档集已清')
check(!accounting().includes('session-a1'), '记账槽已清')
check(accounting().includes('session-live2'), '无关会话不受影响')

/* 3. destroy a legacy trash record: trash copy + record dropped. */
r = await handler('destroy', { sessionId: 'session-moved' })
check(r.ok === true, 'destroy（遗留记录）返回成功')
check(!existsSync(join(trashRoot, 'session-moved')), '回收站目录已删除')
check(!existsSync(sessionDir('session-moved')), '原位残渣已删除')
check(trashIndex().length === 0, 'trash.json 记录已删除')

/* 4. restore a live-archived session: only the archive set changes. */
writeFileSync(join(sessionDir('session-live2'), 'session.jsonl'), '{"type":"session/start","seq":1}\n')
registryState.archivedSessionIds.push('session-live2')
r = await handler('restore', { sessionId: 'session-live2' })
check(r.ok === true && r.value.restored === true, 'restore 返回成功')
check(!archiveSet().includes('session-live2'), '归档集已清（会话回侧栏）')

/* 5. restore a legacy trash record: directory moved back, record dropped. */
mkdirSync(join(trashRoot, 'session-moved'), { recursive: true })
writeFileSync(join(trashRoot, 'session-moved', 'session.jsonl'), '{"type":"session/start","seq":1}\n')
writeFileSync(trashFile, `${JSON.stringify([{
  sessionId: 'session-moved', title: '搬走的', cwd: '/w', trashedAt: 1,
  sessionDir: sessionDir('session-moved'), trashDir: join(trashRoot, 'session-moved'),
}], null, 2)}\n`)
registryState.archivedSessionIds.push('session-moved')
r = await handler('restore', { sessionId: 'session-moved' })
check(r.ok === true, 'restore（遗留记录）返回成功')
check(existsSync(join(sessionDir('session-moved'), 'session.jsonl')), '目录已搬回原位')
check(!existsSync(join(trashRoot, 'session-moved')), '回收站副本已清')
check(trashIndex().length === 0, 'trash.json 记录已删除')
check(!archiveSet().includes('session-moved'), '归档集已清')

/* 6. final audit: nothing of the destroyed sessions remains. */
const storageText = readFileSync(storageFile, 'utf8')
check(!storageText.includes('session-a1') && !storageText.includes('session-dead1') && !storageText.includes('session-dead2'),
  'workspace.json 中无任何被删会话残留')
check(archiveSet().length === 0 && accounting().join(',') === 'session-live2', '终态：仅存活的会话保留')

const failed = results.filter(([ok]) => !ok)
console.log(failed.length === 0 ? '\n全部通过 ✓' : `\n${failed.length} 项失败`)
process.exit(failed.length === 0 ? 0 : 1)
