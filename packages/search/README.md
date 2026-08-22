# @blueriverlhr/dsh-better-webui-search

免密钥 Exa 网络搜索（host only）：注册 `ctx.web` 搜索 provider（id `exa`），让 dsh
原生的 `web_search` 工具**在没有 API key 的情况下也能真搜索**，无需任何配置：

- **匿名 MCP**（默认）：走 Exa 官方匿名托管 MCP（`mcp.exa.ai/mcp`，JSON-RPC
  `tools/call`，无凭据、有限流），结果归一化成 `web_search` 的源列表
- **REST 升级**（可选）：设置了 `EXA_API_KEY`（环境变量）后自动切到 Exa
  `POST /search`（`Bearer` 认证，限额更高），无需重启
- 行为与原生搜索一致：来源 URL / 标题 / snippet / 日期、`web_search` 结果卡片，都由
  dsh 自带工具层处理，本包只补 provider

> 注：匿名路径是 Exa 的公共限流服务，429 时工具会提示配置 `EXA_API_KEY` 升级。

patch 用非 insert 覆盖把 `web` 行的 `searchProvider` 指向 `exa`（`deepseek-official`
缺 key 时不可用，所以切到本 provider）；profile 级布线，随本包生效。

- 服务依赖（可选）：`web`（`ctx.get` 能力探测）
- 移植自 `@tonydua/dsh-web-search-exa`（MIT，版权与许可全文见根
  [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)）
- 生效方式：改动在 host half，需**重启 `dsh web`**

独立安装：把 `@blueriverlhr/dsh-better-webui-search` 加进 `dsh.profile.bundles`
并声明依赖（见根 README「按需安装」）。更常见的做法是装根元包一起带上。
