/**
 * Host-half test for the `/better-webui` channel: restore / destroy / purge
 * against a real temp DSH_HOME (fixture dirs + storages/workspace.json) and a
 * mocked service registry. This is the check that "delete forever" really
 * deletes: session dir, archive-set entry, and workspace accounting slot all
 * end up clean — and that a live (host-memory) session stays archived and
 * hidden after destroy until a restart, instead of reappearing in Ungrouped.
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
for (const id of ['session-a1', 'session-live2']) {
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

/* --- mocked services --- */
const registryState = { archivedSessionIds: [...state.global.archivedSessionIds] }
const table = state.tables.workspaces
const entity = {
  async detachSession(id) {
    table.w1.sessionIds = table.w1.sessionIds.filter((candidate) => candidate !== id)
    persistStorage()
  },
}
// Live (host-memory) sessions; mirrors ctx.sessions so destroy can tell whether
// a session is still resident (and therefore must stay archived after delete).
const liveSessions = new Map()
const services = {
  sessions: {
    get: (id) => liveSessions.get(id),
    list: () => [...liveSessions.values()],
    flush: async () => false,
  },
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

/* 2b. destroy a LIVE archived session: disk + accounting clean, but the archive
   id stays (the host cannot dispose a resident session, so dropping it would
   make the session reappear in Ungrouped). listArchive reports it as dead. */
mkdirSync(sessionDir('session-live1'), { recursive: true })
writeFileSync(join(sessionDir('session-live1'), 'session.jsonl'), '{"type":"session/start","seq":1}\n')
registryState.archivedSessionIds.push('session-live1')
state.global.archivedSessionIds.push('session-live1')
liveSessions.set('session-live1', { header: { id: 'session-live1', cwd: '/w' } })

r = await handler('listArchive', {})
check(r.ok === true && r.value.items.some((item) =>
  item.sessionId === 'session-live1' && item.dead === false && item.live === true),
  'listArchive：活归档会话 dead=false, live=true')

r = await handler('destroy', { sessionId: 'session-live1' })
check(r.ok === true && r.value.destroyed === true && r.value.keptArchived === true, 'destroy（活会话）返回 keptArchived')
check(!existsSync(sessionDir('session-live1')), '活会话目录已删除')
check(archiveSet().includes('session-live1'), '活会话归档 id 保留（不回到未分组）')
check(!accounting().includes('session-live1'), '活会话记账槽已清')

r = await handler('listArchive', {})
check(r.ok === true && r.value.items.some((item) =>
  item.sessionId === 'session-live1' && item.dead === true && item.live === true),
  'listArchive：销毁后的活会话 dead=true, live=true（重启前保留）')

/* 3. restore a live-archived session: only the archive set changes. */
writeFileSync(join(sessionDir('session-live2'), 'session.jsonl'), '{"type":"session/start","seq":1}\n')
registryState.archivedSessionIds.push('session-live2')
r = await handler('restore', { sessionId: 'session-live2' })
check(r.ok === true && r.value.restored === true, 'restore 返回成功')
check(!archiveSet().includes('session-live2'), '归档集已清（会话回侧栏）')

/* 4. final audit: nothing of the destroyed sessions remains, except the
   live-destroyed id that stays archived until the process restarts. */
const storageText = readFileSync(storageFile, 'utf8')
check(!storageText.includes('session-a1') && !storageText.includes('session-dead1') && !storageText.includes('session-dead2'),
  'workspace.json 中无任何被删会话残留')
check(archiveSet().join(',') === 'session-live1' && accounting().join(',') === 'session-live2',
  '终态：仅活会话记账保留；销毁的活会话归档 id 待重启清除')

/* 5. restart simulation: the live store empties, then the boot purge clears the
   kept-archived id because the session is no longer resident or persisted. */
liveSessions.clear()
r = await handler('purge', {})
check(r.ok === true && r.value.purged.includes('session-live1'), '重启后 purge 清掉保留的归档 id')
check(!archiveSet().includes('session-live1'), '重启后归档集已无该 id')

const failed = results.filter(([ok]) => !ok)
console.log(failed.length === 0 ? '\n全部通过 ✓' : `\n${failed.length} 项失败`)
process.exit(failed.length === 0 ? 0 : 1)
