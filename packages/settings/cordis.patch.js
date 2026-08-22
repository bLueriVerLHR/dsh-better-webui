/**
 * Settings feature patch source — the single source of truth for both this
 * package's standalone `cordis.patch.yml` and the aggregated meta patch.
 *
 * The better-webui settings feature is client-only over one row: the browser
 * half registers the dedicated "better-webui" settings page hosting the
 * session-chime switch/volume moved out of General settings. The host half is
 * an empty apply (the package main exists only because a dsh row loads a
 * package entry). v0.21 起重试策略已拆去独立包 better-webui-retry。
 */
export default [
  {
    insert: [
      { id: 'better-webui-settings', name: '@blueriverlhr/dsh-better-webui-settings' },
    ],
  },
]
