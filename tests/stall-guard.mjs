/**
 * Host-side test for the persistent-bash stall guard: the pure
 * `updateStallStrikes` decision logic plus the `installPersistentBashStallGuard`
 * `tools/execute` wiring against a mocked terminals service.
 *
 * The guard detects the dsh persistent-bash silence-tier degradation (a
 * PROMPT_COMMAND overwrite makes every bash call settle at ~3s instead of the
 * fast path) by wall-clock duration: N consecutive bash calls each ≥ threshold
 * on an owner with a live terminal session triggers a shell reset.
 *
 * Run: node tests/stall-guard.mjs
 */
import assert from 'node:assert/strict'
import {
  STALL_THRESHOLD_MS,
  STALL_STRIKES,
  STALL_RESET_COOLDOWN_MS,
  installPersistentBashStallGuard,
  updateStallStrikes,
} from '../src/host.js'

let pass = 0
const check = (ok, label) => {
  if (!ok) throw new Error(`✗ ${label}`)
  pass += 1
  console.log(`  ✓ ${label}`)
}

/* ── 1. pure decision logic ─────────────────────────────────────────────── */

{
  console.log('updateStallStrikes:')
  const state = { streak: 0, lastResetAt: 0 }
  // Fast call: clears streak, never resets.
  check(updateStallStrikes(state, 50, true, 1000).reset === false, 'fast call: no reset')
  check(state.streak === 0, 'fast call clears streak')
  // Slow call but no terminal (one-shot bash): ignored.
  check(updateStallStrikes(state, STALL_THRESHOLD_MS + 100, false, 2000).reset === false, 'slow no-terminal: no reset')
  check(state.streak === 0, 'slow no-terminal does not count')
  // Below-threshold slow-ish call: not counted.
  check(updateStallStrikes(state, STALL_THRESHOLD_MS - 1, true, 3000).reset === false, 'below-threshold: not counted')
  check(state.streak === 0, 'below-threshold keeps streak at 0')
  // Negative/undefined elapsed: treated as not slow.
  check(updateStallStrikes(state, -1, true, 4000).reset === false, 'negative elapsed: no reset')

  // STALL_STRIKES consecutive slow calls → reset, then streak clears.
  const state2 = { streak: 0, lastResetAt: 0 }
  let reset = false
  for (let i = 1; i <= STALL_STRIKES; i++) {
    reset = updateStallStrikes(state2, STALL_THRESHOLD_MS + 200, true, 1000 + i).reset
  }
  check(reset === true, `${STALL_STRIKES} consecutive slow calls trigger reset`)
  check(state2.streak === 0, 'streak cleared after reset')

  // Cooldown: a fresh reset immediately after is suppressed; once the window
  // elapses, the preserved streak resets on the very next slow call.
  const state3 = { streak: 0, lastResetAt: 5000 }
  for (let i = 1; i < STALL_STRIKES; i++) {
    updateStallStrikes(state3, STALL_THRESHOLD_MS + 200, true, 9000 + i)
  }
  const resetInCooldown = updateStallStrikes(state3, STALL_THRESHOLD_MS + 200, true, 9000 + STALL_STRIKES).reset
  check(resetInCooldown === false, 'reset suppressed inside cooldown window')
  check(state3.streak === STALL_STRIKES, 'streak preserved across the suppressed reset')
  // Advance beyond lastResetAt + cooldown: the preserved streak resets at once.
  const later = state3.lastResetAt + STALL_RESET_COOLDOWN_MS + 1
  const resetAfterCooldown = updateStallStrikes(state3, STALL_THRESHOLD_MS + 200, true, later).reset
  check(resetAfterCooldown === true, 'reset fires again after cooldown window')
  check(state3.streak === 0, 'streak cleared after the post-cooldown reset')
  console.log()
}

/* ── 2. tools/execute wiring with a mocked terminals service ─────────────── */

{
  console.log('installPersistentBashStallGuard:')
  /** @type {Map<object, Array<{ sessionId: string }>>} per-agent live sessions. */
  const sessionsByAgent = new Map()
  const killed = [] // { agent, sessionId, reason }

  // The `terminals` service is realm-isolated to the preset group that mounts
  // the persistent shell, so the guard resolves it through the agent-presets
  // reader (`agentPresets.serviceFor(agent, 'terminals')`) — NOT from the
  // agent's own ctx (which the isolate realm also hides). An agent whose
  // preset mounts no persistent shell has no terminals and is skipped.
  const makeTerminals = () => ({
    list: (agent) => sessionsByAgent.get(agent) ?? [],
    async kill(agent, sessionId, reason) {
      killed.push({ agent, sessionId, reason })
      const list = sessionsByAgent.get(agent) ?? []
      sessionsByAgent.set(agent, list.filter((s) => s.sessionId !== sessionId))
    },
  })
  // agentA: minimal preset → serviceFor returns a live terminals service.
  // agentB: cordis preset → no persistent shell, serviceFor returns undefined
  // (the guard skips its tracking entirely, exactly like a cordis agent).
  const agentA = { id: 'agent-a' }
  const agentB = { id: 'agent-b' }
  sessionsByAgent.set(agentA, [{ sessionId: 'pty-1' }, { sessionId: 'pty-2' }])
  sessionsByAgent.set(agentB, [])

  let listener
  const ctx = {
    get: (name) => name === 'agentPresets'
      ? { serviceFor: (agent, svc) => svc === 'terminals' && agent === agentA ? makeTerminals() : undefined }
      : undefined,
    on: (event, fn) => { if (event === 'tools/execute') listener = fn; return () => {} },
    effect: (fn) => fn(),
  }
  installPersistentBashStallGuard(ctx)

  /** Run one fake dispatch: `elapsed` ms elapse between the wrapper's two Date.now reads. */
  const dispatch = async (name, agent, elapsed) => {
    // The wrapper reads Date.now() at entry and again after next(). Start the
    // fake clock at a fixed base and advance it by `elapsed` inside next(), so
    // the wrapper's measured duration is exactly `elapsed`.
    let clock = 1000
    const original = Date.now
    Date.now = () => clock
    try {
      return await listener({ name, agent }, async () => {
        clock += elapsed
        return { ok: true }
      })
    } finally {
      Date.now = original
    }
  }

  // Pass-through: non-bash tool returns next()'s result and never resets.
  let r = await dispatch('web_search', agentA, 4000)
  check(r.ok === true, 'non-bash tool passes through')
  check(killed.length === 0, 'non-bash tool does not reset')

  // Agent B (cordis preset, no persistent shell): slow bash is entirely
  // skipped — no terminals service resolves, nothing to track, no reset.
  r = await dispatch('bash', agentB, 4000)
  check(r.ok === true, 'no-terminal bash passes through')
  check(killed.length === 0, 'no-terminal bash does not reset')

  // Agent A: two slow calls → streak, no reset yet.
  await dispatch('bash', agentA, 4000)
  await dispatch('bash', agentA, 4000)
  check(killed.length === 0, `under ${STALL_STRIKES} slow calls: no reset yet`)

  // A fast call resets the streak.
  await dispatch('bash', agentA, 50)
  await dispatch('bash', agentA, 4000)
  await dispatch('bash', agentA, 4000)
  check(killed.length === 0, 'fast call clears the streak (no reset after 2 slow)')

  // STALL_STRIKES consecutive slow calls → resets BOTH sessions.
  for (let i = 0; i < STALL_STRIKES; i++) await dispatch('bash', agentA, 4000)
  check(killed.length === 2, 'three consecutive slow calls reset both sessions')
  check(killed.every((k) => k.agent === agentA && k.reason.includes('stall guard')), 'kill reason names the stall guard')
  check(sessionsByAgent.get(agentA).length === 0, 'sessions removed from the registry')

  // After reset + cooldown not elapsed: further slow calls do not churn.
  killed.length = 0
  for (let i = 0; i < STALL_STRIKES; i++) await dispatch('bash', agentA, 4000)
  check(killed.length === 0, 'no re-reset inside the cooldown window')

  // Robustness: a terminals.list failure (thrown from the service the guard
  // resolves through serviceFor) must never break the tool call — the guard
  // swallows tracking errors and the dispatch result still passes through.
  {
    let listener2
    const explodingAgent = { id: 'exploding' }
    const failingCtx = {
      get: (name) => name === 'agentPresets'
        ? { serviceFor: (agent, svc) => svc === 'terminals' && agent === explodingAgent
          ? { list: () => { throw new Error('terminals exploded') }, kill: async () => false }
          : undefined }
        : undefined,
      on: (event, fn) => { if (event === 'tools/execute') listener2 = fn; return () => {} },
      effect: (fn) => fn(),
    }
    installPersistentBashStallGuard(failingCtx)
    let clock = 2000
    const original = Date.now
    Date.now = () => clock
    try {
      const r = await listener2({ name: 'bash', agent: explodingAgent }, async () => {
        clock += 5000
        return { ok: 'survived' }
      })
      check(r.ok === 'survived', 'terminals.list throwing does not break the dispatch result')
    } finally {
      Date.now = original
    }
  }

  // Robustness: a kill that NEVER settles must not hang the dispatch — the
  // reset holds the waterfall open only until STALL_KILL_TIMEOUT_MS, then the
  // result passes through anyway. This is the guard's own philosophy: it must
  // never be the cause of a stall.
  {
    let listener3
    const hangingAgent = { id: 'hanging' }
    const hangSessions = { list: [{ sessionId: 'pty-hang' }] }
    const hangingCtx = {
      get: (name) => name === 'agentPresets'
        ? { serviceFor: (agent, svc) => svc === 'terminals' && agent === hangingAgent
          ? {
              list: () => hangSessions.list,
              // Returns a promise that never settles.
              kill: () => new Promise(() => {}),
            }
          : undefined }
        : undefined,
      on: (event, fn) => { if (event === 'tools/execute') listener3 = fn; return () => {} },
      effect: (fn) => fn(),
    }
    installPersistentBashStallGuard(hangingCtx)
    let clock = 3000
    const originalDateNow = Date.now
    Date.now = () => clock
    try {
      // Three consecutive slow calls trip the reset; the hang is bounded by
      // STALL_KILL_TIMEOUT_MS, so each dispatch still resolves with its own
      // result (a truly unbounded kill would leave this `await` pending).
      for (let i = 0; i < 3; i++) {
        const r = await listener3({ name: 'bash', agent: hangingAgent }, async () => {
          clock += 5000
          return { ok: 'still-here' }
        })
        check(r.ok === 'still-here', `hanging kill does not block dispatch ${i + 1}/3`)
      }
    } finally {
      Date.now = originalDateNow
    }
  }
  console.log()
}

console.log(`\nstall-guard: ${pass} checks passed`)
