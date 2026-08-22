# @blueriverlhr/dsh-better-webui-retry

可配置 LLM 重试策略（host + client）：注册 RPC 通道 `/better-webui-retry`
（ping / read / apply）与独立「设置 → 重试策略」页。v0.21 从 settings 包拆出，
与「设置 → better-webui」偏好页解耦——重试策略单独成包，可独立安装、独立失败。

DSH 原生重试默认 `maxRetries: 2`（太少且不可调）。本包通过 `settings` 服务把
用户选定的**全局默认策略**（重试次数 + 指数退避初始/最大延迟 + 抖动）幂等地写入
`llm-pi-ai.providers.*.retryPolicy`，由 dsh 自带的 `dsh-llm-retry` 原样执行，
改 `settings.yaml` 即热加载（pi-ai 适配器实时读 `retryPolicy`，**无需重启**）。

- **不覆盖手写配置**：某个 provider 若已声明自己的 `retryPolicy`（与插件上次
  写入的 `lastApplied` 标记不同），页面把它列为「手写配置」并跳过；
  想单独设的 provider 手写 settings.yaml 即可。
- 策略 + `lastApplied` 标记持久化在 `better-webui.retry` 设置命名空间
  （settings.yaml 里 `better-webui:` 一节），重启后依然生效。
- **设置页**（`settings.section`，id `better-webui-retry`，order 26，紧跟
  better-webui 设置页之后）：页面大项下放标题 + 描述（不重复），卡内四字段
  （重试次数 / 抖动比例 / 初始延迟 / 最大延迟）+「应用」「恢复默认」按钮 +
  provider 状态列表。

- 服务依赖（硬）：`connection`、`settings`
- wire 版本：`WIRE_VERSION = 1`（host）与 `WIRE = 1`（client）必须一致
- 独立 locale NS（`better-webui-retry`）与独立 style 标签
  （`better-webui-retry-style`）；经 `/better-webui-retry` RPC 通道与宿主通信

独立安装：把 `@blueriverlhr/dsh-better-webui-retry` 加进 `dsh.profile.bundles`
并声明依赖（见根 README「按需安装」）。更常见的做法是装根元包一起带上。
