# @blueriverlhr/dsh-better-webui-search

免密钥 Exa 网络搜索（host only）：注册 `ctx.web` 搜索 provider（id `exa`），
无 API key 走 Exa 匿名托管 MCP，设了 `EXA_API_KEY` 自动切 REST。patch 同时把
`web` 行的 `searchProvider` 覆盖为 `exa`（profile 级布线，随本包生效）。

- 服务依赖（可选）：`web`（`ctx.get` 能力探测）
- 移植自 `@tonydua/dsh-web-search-exa`（MIT），见根 THIRD_PARTY_NOTICES.md
