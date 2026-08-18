#!/usr/bin/env node
/**
 * Surgical patch for the DEPLOYED dsh-client-ui-conversation browser bundle.
 *
 * Why: the stock 'user' keyed chat renderer passes no `extraActions` to
 * MessageIconActions, so out-of-tree plugins have no sanctioned seat next to
 * the native copy button on user prompt rows. The harness source tree got a
 * real `conversation.chat.user-actions` list slot (see docs/dev-notes.md);
 * until a shipped dsh release carries it, this script applies the same
 * change to the bundle inside the global dsh install, so the running
 * `dsh web` serves it. Idempotent: re-run after every dsh upgrade.
 *
 * Changes (mirroring the source patch):
 * 1. UserMessageNodeView accepts the optional `renderSlot` prop and renders
 *    `renderSlot('conversation.chat.user-actions', { node, turn })` between
 *    copy and the clock. Guarded: the 'steering' registration declares no
 *    children, so its renderSlot prop is absent there.
 * 2. The 'user' keyed registration declares
 *    children: { 'conversation.chat.user-actions': { kind: 'list', scope: 'session' } }
 *    — the slot system injects renderSlot only for declared children.
 */

import { existsSync, readFileSync, realpathSync, writeFileSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'

const PROFILE_LINK = join(
  process.env.HOME ?? '', '.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-conversation',
)

function locateBundle(explicit) {
  if (explicit !== undefined) return explicit
  if (existsSync(PROFILE_LINK)) {
    // existsSync follows symlinks; realpath resolves the global-install target.
    const candidate = join(realpathSync(PROFILE_LINK), 'lib/client.js')
    if (existsSync(candidate)) return candidate
  }
  throw new Error(`cannot locate the deployed bundle (tried ${PROFILE_LINK} → lib/client.js); pass the path as argv[2]`)
}

const bundlePath = locateBundle(process.argv[2])
const MARKER = 'conversation.chat.user-actions'

const COMPONENT_FROM = `function UserMessageNodeView({ node, loadImage, t }) {
			const data = node.data;
			return (0, react_jsx_runtime.jsx)(UserStyleBubble, {
				content: data.content,
				imageLoader: loadImage,
				t,
				actions: (text) => (0, react_jsx_runtime.jsx)(MessageIconActions, {
					text,
					time: data.time,
					clock: "start",
					className: MessageItem_module_css_default.actions,
					t
				})
			});
		});`

const COMPONENT_TO = `function UserMessageNodeView({ node, loadImage, t, renderSlot }) {
			const data = node.data;
			const turn = node.location.kind === "turn" || node.location.kind === "step" ? node.location.turn.turn : void 0;
			return (0, react_jsx_runtime.jsx)(UserStyleBubble, {
				content: data.content,
				imageLoader: loadImage,
				t,
				actions: (text) => (0, react_jsx_runtime.jsx)(MessageIconActions, {
					text,
					time: data.time,
					clock: "start",
					className: MessageItem_module_css_default.actions,
					extraActions: renderSlot ? renderSlot("conversation.chat.user-actions", { node: data, turn }) : null,
					t
				})
			});
		});`

const REGISTER_FROM = `ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: "user",
				locale: NS
			}, UserMessageNodeView));`

const REGISTER_TO = `ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: "user",
				locale: NS,
				children: { "conversation.chat.user-actions": { kind: "list", scope: "session" } }
			}, UserMessageNodeView));`

const source = readFileSync(bundlePath, 'utf8')

if (source.includes(MARKER)) {
  console.log(`already patched: ${bundlePath}`)
  process.exit(0)
}

for (const [label, needle] of [['component', COMPONENT_FROM], ['registration', REGISTER_FROM]]) {
  const hits = source.split(needle).length - 1
  if (hits !== 1) {
    console.error(`patch site (${label}) matched ${hits} times in ${bundlePath} — the deployed bundle layout changed; update this script`)
    process.exit(1)
  }
}

const backup = `${bundlePath}.better-webui-backup`
if (!existsSync(backup)) copyFileSync(bundlePath, backup)

const patched = source
  .replace(COMPONENT_FROM, COMPONENT_TO)
  .replace(REGISTER_FROM, REGISTER_TO)
writeFileSync(bundlePath, patched)
console.log(`patched: ${bundlePath} (backup: ${backup})`)
