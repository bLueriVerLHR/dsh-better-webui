/**
 * Model sampling parameters feature patch source — the single source of truth
 * for both this package's standalone `cordis.patch.yml` and the aggregated
 * meta patch.
 *
 * One row, host + client: the host half registers the
 * `/better-webui-modelparams` RPC channel and owns the
 * `better-webui-modelparams` settings namespace (global default temperature +
 * enable flag + persist/hot mode), and intercepts `agent/request` to pin a
 * temperature per session (new sessions inherit the default; fixed within a
 * session). The browser half registers the compact temperature input box in
 * `conversation.input.right` (composer tool row) plus a popover panel with the
 * full configuration.
 */
export default [
  {
    insert: [
      { id: 'better-webui-modelparams', name: '@blueriverlhr/dsh-better-webui-modelparams' },
    ],
  },
]
