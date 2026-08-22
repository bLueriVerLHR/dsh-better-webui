/**
 * Search feature patch source — the single source of truth for both this
 * package's standalone `cordis.patch.yml` and the aggregated meta patch.
 *
 * Two entries:
 *   1. this package's own row (`better-webui-search`), and
 *   2. a PROFILE-LEVEL override of the dsh-base `web` row, pointing its
 *      `searchProvider` at this package's provider id (`exa`). This is a
 *      global wiring decision (it changes the whole profile's web seam), so it
 *      travels with the feature: a deployment that installs search gets the
 *      switch, one that does not keeps the default provider.
 */
export default [
  {
    insert: [
      { id: 'better-webui-search', name: '@blueriverlhr/dsh-better-webui-search' },
    ],
  },
  {
    id: 'web',
    name: '@deepseek-ai/dsh-web',
    config: {
      searchProvider: 'exa',
    },
  },
]
