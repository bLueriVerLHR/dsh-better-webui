/**
 * Browser-stand-in for @deepseek-ai/dsh-client-ui-primitives in the jsdom
 * smoke test: Tooltip renders children inline; icons render as named spans so
 * assertions can see which glyph a button carries.
 */
import React from 'react'

const h = React.createElement

export const Tooltip = (props) => h(React.Fragment, null, props.children)

const makeIcon = (name) => (props) => h('span', {
  'data-icon': name,
  'data-size': String(props.size ?? ''),
  className: props.className ?? undefined,
  'aria-hidden': 'true',
})

export const IconTrashOutline16 = makeIcon('trash-16')
export const IconTrashOutline14 = makeIcon('trash-14')
export const IconCheckOutline16 = makeIcon('check-16')
export const IconCheckOutline14 = makeIcon('check-14')
export const IconCloseOutline16 = makeIcon('close-16')
export const IconCloseFill14 = makeIcon('close-fill-14')
export const IconRefreshOutline16 = makeIcon('refresh-16')
export const IconRefreshOutline14 = makeIcon('refresh-14')
export const IconArchiveOutline20 = makeIcon('archive-20')
export const IconBranchOutline16 = makeIcon('branch-16')
export const IconCopyOutline16 = makeIcon('copy-16')
export const IconEditOutline16 = makeIcon('edit-16')
