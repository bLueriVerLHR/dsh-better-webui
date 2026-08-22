/**
 * Chime feature patch source — the single source of truth for both this
 * package's standalone `cordis.patch.yml` and the aggregated meta patch.
 *
 * Client-only: one row whose package serves the browser half (dock entry +
 * General-settings row). The host half is an empty apply — the package's main
 * exists only because a dsh row loads a package entry.
 */
export default [
  {
    insert: [
      { id: 'better-webui-chime', name: '@blueriverlhr/dsh-better-webui-chime' },
    ],
  },
]
