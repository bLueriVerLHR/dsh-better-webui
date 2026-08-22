/**
 * Retry feature patch source — the single source of truth for both this
 * package's standalone `cordis.patch.yml` and the aggregated meta patch.
 *
 * The better-webui retry feature is a host + client pair over one row: the
 * host half registers the `/better-webui-retry` RPC channel and owns the
 * `better-webui` settings namespace (the global retry policy + the marker of
 * what it last applied), and the browser half registers the dedicated
 * "重试策略" settings page that edits the policy. Split out of the settings
 * package (v0.21) so the settings page and the retry policy stay decoupled —
 * each feature an independently installable package.
 */
export default [
  {
    insert: [
      { id: 'better-webui-retry', name: '@blueriverlhr/dsh-better-webui-retry' },
    ],
  },
]
