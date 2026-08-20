// Standalone empirical reproduction of the DSH persistent-bash readiness stall.
//
// Mimics the exact readiness contract of packages/terminal/terminal-bash/src/
// (session.ts pollReadiness + sanitize.ts marker/tail tracking) against a real
// node-pty bash, so the numbers below are observed on a real PTY, not guessed.
//
// Runs three scenarios and prints, for each `startSend`, how long `operation.done`
// took to settle and via which waitReason:
//   1. normal        : command completes, bash renders marker + 'dsh> ' prompt
//   2. after PS1=broken     : in-shell PS1 override (PROMPT_COMMAND re-asserts PS1)
//   3. after PROMPT_COMMAND=... override : marker emission is permanently gone
//
// The shipped terminal-bash defaults are used: idleSilenceMs=3000, handoffGraceMs=500,
// pollIntervalMs=50, maxPendingBytes=maxReadBytes=256KB.

// Resolve node-pty from the installed @deepseek-ai/dsh tree so this script
// runs without a workspace install. Override with NODE_PTY_PATH if needed.
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const NODE_PTY = process.env.NODE_PTY_PATH
  ?? '/home/archie/.nvm/versions/node/v24.18.0/lib/node_modules/@deepseek-ai/dsh/node_modules/node-pty'
const { spawn } = require(NODE_PTY)

const CONTROLLED_PROMPT = 'dsh> '
const MARKER_PREFIX = '133;D;'
const IDLE_SILENCE_MS = 3000
const HANDOFF_GRACE_MS = 500
const POLL_INTERVAL_MS = 50

const PROMPT_COMMAND = `printf "\\033]133;D;%s\\007" "$?"; PS1='${CONTROLLED_PROMPT}'`

const env = {
  TERM: 'dumb',
  PAGER: 'cat',
  GIT_PAGER: 'cat',
  PS1: CONTROLLED_PROMPT,
  PROMPT_COMMAND,
  BASH_SILENCE_DEPRECATION_WARNING: '1',
  DSH_SHELL: '1',
}

// A near-verbatim port of TerminalSanitizer (sanitize.ts) + LocalPtySession.onData
// (session.ts), so the readiness decisions below match the real backend.
function makeReadinessTracker() {
  let pending = ''
  let discardMode = undefined
  let discardOscEscape = false
  let trackingPromptTail = false
  let trailingCarriageReturn = false
  let promptSeen = false
  let promptTail = ''
  let promptTextSeen = false
  let lastOutputAt = Date.now()
  let buffer = ''
  const maxPendingBytes = 256 * 1024

  function normalizeText(text) {
    let complete = trailingCarriageReturn ? `\r${text}` : text
    trailingCarriageReturn = false
    if (complete.endsWith('\r')) {
      complete = complete.slice(0, -1)
      trailingCarriageReturn = true
    }
    return complete.replaceAll('\r\n', '\n').replaceAll('\r', '\n').replaceAll('\x07', '')
  }

  function push(chunk) {
    pending += chunk
    if (Buffer.byteLength(pending) > maxPendingBytes) {
      discardMode = pending[1] === ']' ? 'osc' : 'csi'
      pending = ''
    }
    let text = ''
    let prompt = false
    let promptTailIn = ''
    let includePromptTail = trackingPromptTail
    const appendText = value => {
      text += value
      if (trackingPromptTail) promptTailIn += value
    }
    let index = 0
    while (index < pending.length) {
      const escape = pending.indexOf('\x1b', index)
      if (escape < 0) { appendText(pending.slice(index)); index = pending.length; break }
      appendText(pending.slice(index, escape))
      if (escape + 1 >= pending.length) { index = escape; break }
      const kind = pending[escape + 1]
      if (kind === ']') {
        const bel = pending.indexOf('\x07', escape + 2)
        const stringTerminator = pending.indexOf('\x1b\\', escape + 2)
        let end = -1
        if (bel >= 0 && stringTerminator >= 0) end = Math.min(bel + 1, stringTerminator + 2)
        else if (bel >= 0) end = bel + 1
        else if (stringTerminator >= 0) end = stringTerminator + 2
        if (end < 0) { index = escape; break }
        const terminatorBytes = pending[end - 1] === '\x07' ? 1 : 2
        const content = pending.slice(escape + 2, end - terminatorBytes)
        if (content.startsWith(MARKER_PREFIX)) {
          prompt = true
          trackingPromptTail = true
          includePromptTail = true
          promptTailIn = ''
        }
        index = end
        continue
      }
      if (kind === '[') {
        let end = escape + 2
        while (end < pending.length) {
          const code = pending.charCodeAt(end)
          if (code >= 0x40 && code <= 0x7e) break
          end += 1
        }
        if (end >= pending.length) { index = escape; break }
        index = end + 1
        continue
      }
      index = escape + 2
    }
    pending = pending.slice(index)

    const normalized = normalizeText(text)
    if (normalized.length > 0) {
      lastOutputAt = Date.now()
      buffer = buffer.length < 4096 ? buffer + normalized : buffer.slice(-4096) + normalized
    }
    if (prompt) {
      promptSeen = true
      promptTail = ''
      lastOutputAt = Date.now()
    }
    if (promptSeen && includePromptTail) {
      const remaining = Math.max(0, CONTROLLED_PROMPT.length + 1 - promptTail.length)
      promptTail += promptTailIn.slice(0, remaining)
      if (promptTailIn.length > remaining) promptTail = `${CONTROLLED_PROMPT}\0`
      promptTextSeen = promptTail === CONTROLLED_PROMPT
    }
  }

  return {
    get promptSeen() { return promptSeen },
    get promptTextSeen() { return promptTextSeen },
    get lastOutputAt() { return lastOutputAt },
    get viewport() { return buffer },
    push,
    reset() {
      promptSeen = false
      promptTextSeen = false
      promptTail = ''
      lastOutputAt = Date.now()
    },
  }
}

async function startSend(pty, tracker, text, submit) {
  const startedAt = Date.now()
  tracker.reset()
  if (text.length > 0) pty.write(`${text}${submit ? '\r' : ''}`)
  // pollReadiness mirror
  return new Promise(resolve => {
    const tick = () => {
      const idleFor = Date.now() - tracker.lastOutputAt
      if (tracker.promptSeen && tracker.promptTextSeen && idleFor >= POLL_INTERVAL_MS) {
        return resolve({ waitReason: 'stdin_read', elapsed: Date.now() - startedAt })
      }
      const handoffGrace = tracker.promptSeen ? HANDOFF_GRACE_MS : 0
      if (idleFor >= IDLE_SILENCE_MS + handoffGrace) {
        return resolve({ waitReason: 'inferred_idle', elapsed: Date.now() - startedAt })
      }
      setTimeout(tick, POLL_INTERVAL_MS)
    }
    setTimeout(tick, POLL_INTERVAL_MS)
  })
}

const pty = spawn('/bin/bash', ['--noprofile', '--norc', '-i'], {
  name: 'xterm-256color',
  cols: 160,
  rows: 40,
  cwd: process.cwd(),
  env: { ...process.env, ...env },
})

const tracker = makeReadinessTracker()
pty.onData(d => tracker.push(d))

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function scenario(label, setupLine, command) {
  if (setupLine) {
    const s = await startSend(pty, tracker, setupLine, true)
    await sleep(60)
  }
  const r = await startSend(pty, tracker, command, true)
  console.log(`${label.padEnd(34)} → settle in ${String(r.elapsed).padStart(6)} ms  (${r.waitReason})`)
}

// Wait for the first prompt.
await startSend(pty, tracker, '', false)
await sleep(200)
// The real tool initializes with `stty -echo` alone; without it, command echo
// follows the prompt in the same chunk and poisons prompt-tail detection.
await startSend(pty, tracker, 'stty -echo', true)
await sleep(150)

console.log('=== DSH terminal-bash readiness on a real PTY (idleSilenceMs=3000, handoffGraceMs=500) ===\n')

await scenario('1) normal command (echo ok)', null, "printf 'ok\\n'")
await scenario('2) normal command after PS1=broken', 'PS1=broken-prompt', "printf 'self-healed=%s\\n' \"$PS1\"")
await scenario('3) normal command after PROMPT_COMMAND override', "PROMPT_COMMAND='printf no-marker\\n'", "printf 'marker-gone\\n'")
await scenario('4) normal command still degraded', null, "printf 'still-degraded\\n'")

pty.kill()
process.exit(0)
