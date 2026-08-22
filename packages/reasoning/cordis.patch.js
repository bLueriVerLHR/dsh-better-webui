/**
 * Reasoning feature patch source — the single source of truth for both this
 * package's standalone `cordis.patch.yml` and the aggregated meta patch.
 *
 * Host-only, no client half: one row whose package registers the provisioning
 * pass at boot and on settings changes.
 */
export default [
  {
    insert: [
      { id: 'better-webui-reasoning', name: '@blueriverlhr/dsh-better-webui-reasoning' },
    ],
  },
]
