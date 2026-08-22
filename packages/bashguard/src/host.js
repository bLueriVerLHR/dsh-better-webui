/**
 * better-webui bashguard host half: persistent-bash stall guard.
 *
 * dsh's persistent `bash` tool (`@deepseek-ai/dsh-tool-bash-persistent`, used
 * by the minimal preset and any agent whose preset mounts it) settles each send
 * through the `@deepseek-ai/dsh-terminal-bash` PTY readiness protocol: a fast
 * path that requires the OSC `133;D;` marker plus a prompt tail EXACTLY equal
 * to `dsh> `, with an `inferred_idle` silence tier (~3s) as the fallback. Any
 * command that overwrites `PROMPT_COMMAND` (a `.bashrc`, starship/direnv/conda,
 * or an explicit assignment) stops the marker from being emitted, so EVERY
 * subsequent bash call silently degrades to the ~3s silence tier until the
 * shell is reset. The tool itself only resets on timeout/exit, so this
 * degradation is otherwise permanent for the session.
 *
 * The plugin cannot see the terminal's internal `waitReason`, so the guard
 * detects the degraded state by wall-clock duration: a healthy persistent bash
 * call settles in tens of ms, a silence-tier call always takes ~idleSilenceMs
 * (3000ms). When an owner with live terminal sessions has had N consecutive
 * bash calls each lasting ≥ a threshold, the guard kills that owner's sessions
 * through `ctx.terminals.kill`, so the NEXT bash call spawns a fresh shell and
 * the fast path is restored. One transient "shell send failed" bash error is
 * the accepted cost of recovery (the tool resets its cache and re-spawns on the
 * following call).
 */

/** A bash call at/over this wall-clock duration is treated as a silence-tier settle. */
export const STALL_THRESHOLD_MS = 2800
/** Consecutive slow bash calls that trigger a shell reset. */
export const STALL_STRIKES = 3
/** Cooldown between resets per owner, so a pathological loop cannot churn shells. */
export const STALL_RESET_COOLDOWN_MS = 60_000
/** Ceiling for how long a reset may hold the `tools/execute` waterfall open while killing sessions. */
export const STALL_KILL_TIMEOUT_MS = 2000

const delay = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

/**
 * Advance the per-owner stall streak for one settled bash call and decide
 * whether to reset that owner's shell. Pure decision logic (no live services),
 * so it is unit-testable without a runtime.
 *
 * A non-slow call (fast path, or an owner with no terminal session) clears the
 * streak; a slow call on an owner WITH a live terminal increments it. The reset
 * fires only when the streak reaches {@link STALL_STRIKES} and the per-owner
 * cooldown has elapsed.
 * @param state - per-owner `{ streak, lastResetAt }` mutable state.
 * @param elapsed - wall-clock duration of the settled bash call in ms.
 * @param hasTerminal - whether the owner has a live PTY session (persistent bash).
 * @param now - current epoch ms (injected for deterministic tests).
 * @returns `{ reset }` — true when the caller should reset the owner's shells.
 */
export function updateStallStrikes(state, elapsed, hasTerminal, now) {
  if (typeof elapsed !== 'number' || elapsed < 0 || !hasTerminal || elapsed < STALL_THRESHOLD_MS) {
    state.streak = 0
    return { reset: false }
  }
  state.streak += 1
  // `lastResetAt === 0` is the pristine state: the FIRST reset must fire as
  // soon as the streak is reached; the cooldown gates only subsequent resets.
  const cooldownElapsed = state.lastResetAt === 0 || now - state.lastResetAt >= STALL_RESET_COOLDOWN_MS
  const reset = state.streak >= STALL_STRIKES && cooldownElapsed
  if (reset) {
    state.streak = 0
    state.lastResetAt = now
  }
  return { reset }
}

/**
 * Install the persistent-bash stall guard: wrap the `tools/execute` waterfall,
 * measure each `bash` call's wall-clock duration, and reset the owner's
 * terminal sessions after consecutive silence-tier settles. The wrapper is a
 * pass-through (always returns `next()`'s result) and adds only a timing read
 * to the hot path, mirroring the timeout-policy guard's `tools/execute` shape.
 *
 * The `terminals` service is realm-isolated to the preset group that mounts
 * the persistent shell (the minimal preset's `isolate: { terminals: true }`
 * group), so it is invisible to everything outside that group — including
 * this plugin's root context AND the agent's own scope context (`agent.ctx`).
 * The one supported reader is the agent-presets service's `serviceFor`:
 * `ctx.get('agentPresets').serviceFor(exec.agent, 'terminals')` resolves the
 * instance the agent's own preset mounted (the exact pattern the host api-proxy
 * uses for the realm-isolated `goals`/`skills` services). An agent whose preset
 * mounts no persistent shell (the cordis/standard presets use the one-shot
 * `tool-bash`) gets `undefined` here and is skipped, which is correct.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 */
export function installPersistentBashStallGuard(ctx) {
  /** @type {WeakMap<object, { streak: number, lastResetAt: number }>} */
  const states = new WeakMap()
  const dispose = ctx.on('tools/execute', async (exec, next) => {
    const startedAt = Date.now()
    let result
    try {
      result = await next()
    } finally {
      // Only model-visible `bash` calls owned by a live agent count. The
      // persistent `bash` tool runs under a preset whose agent context
      // exposes `terminals`; the one-shot `bash` tool's agent has none, so its
      // legit slow runs are skipped. The guard must never break a tool call:
      // any tracking/kill failure only logs and is swallowed.
      if (exec.name === 'bash' && exec.agent !== undefined) {
        try {
          // The realm-isolated `terminals` service resolves through the
          // agent-presets reader, never through `exec.agent.ctx.get` (the
          // isolate realm hides it from the agent's own scope context too).
          const agentPresets = ctx.get('agentPresets')
          const terminals = agentPresets !== undefined && typeof agentPresets.serviceFor === 'function'
            ? agentPresets.serviceFor(exec.agent, 'terminals')
            : undefined
          if (terminals !== undefined && typeof terminals.list === 'function' && typeof terminals.kill === 'function') {
            const now = Date.now()
            const sessions = terminals.list(exec.agent)
            let state = states.get(exec.agent)
            if (state === undefined) {
              state = { streak: 0, lastResetAt: 0 }
              states.set(exec.agent, state)
            }
            const { reset } = updateStallStrikes(state, now - startedAt, sessions.length > 0, now)
            if (reset) {
              for (const session of sessions) {
                try {
                  // Bound the kill: a kill that never settles must not hang
                  // this waterfall (the guard's whole job is to prevent
                  // stalls). The next bash call re-spawns regardless.
                  await Promise.race([
                    terminals.kill(exec.agent, session.sessionId, 'persistent-bash stall guard: consecutive silence-tier settles'),
                    delay(STALL_KILL_TIMEOUT_MS),
                  ])
                } catch {
                  // The session may already be gone; recovery still proceeds via the next call.
                }
              }
              console.warn(`better-webui-bashguard: reset the shell after ${STALL_STRIKES} consecutive slow bash calls (each ≥ ${STALL_THRESHOLD_MS}ms)`)
            }
          }
        } catch (error) {
          console.warn(`better-webui-bashguard: tracking failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    return result
  })
  ctx.effect(() => dispose, 'better-webui-bashguard: tools/execute guard')
}

export const inject = []

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 */
export function apply(ctx) {
  // The `tools/execute` waterfall is always available when tools dispatch; the
  // `terminals` service is optional, and the installer no-ops without it.
  if (typeof ctx.on === 'function') {
    try {
      installPersistentBashStallGuard(ctx)
    } catch (error) {
      console.warn(`better-webui-bashguard: failed to install: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
