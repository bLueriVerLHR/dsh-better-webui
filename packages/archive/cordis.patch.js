/**
 * Archive feature patch source — the single source of truth for both this
 * package's standalone `cordis.patch.yml` and the aggregated meta patch.
 *
 * The archive feature is a host + client pair over one row: the host half
 * registers the `/better-webui` RPC channel and the browser half registers
 * the settings page. Both are served from this one row's package.
 */
export default [
  {
    insert: [
      { id: 'better-webui-archive', name: '@blueriverlhr/dsh-better-webui-archive' },
    ],
  },
]
