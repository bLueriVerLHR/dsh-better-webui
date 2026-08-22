/**
 * Settings feature patch source — the single source of truth for both this
 * package's standalone `cordis.patch.yml` and the aggregated meta patch.
 *
 * The better-webui settings feature is a host + client pair over one row: the
 * host half registers the `/better-webui-settings` RPC channel and owns the
 * `better-webui` settings namespace (the global retry policy + the marker of
 * what it last applied), and the browser half registers the dedicated
 * "better-webui" settings page (retry policy controls + the session-chime
 * switch/volume moved out of General settings). Both are served from this one
 * row's package.
 */
export default [
  {
    insert: [
      { id: 'better-webui-settings', name: '@blueriverlhr/dsh-better-webui-settings' },
    ],
  },
]
