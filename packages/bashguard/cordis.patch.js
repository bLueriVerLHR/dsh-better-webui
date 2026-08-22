/**
 * Bashguard feature patch source — the single source of truth for both this
 * package's standalone `cordis.patch.yml` and the aggregated meta patch.
 *
 * Host-only, no client half: one row whose package installs the
 * `tools/execute` waterfall guard at boot.
 */
export default [
  {
    insert: [
      { id: 'better-webui-bashguard', name: '@blueriverlhr/dsh-better-webui-bashguard' },
    ],
  },
]
