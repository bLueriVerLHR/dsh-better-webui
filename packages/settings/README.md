# @blueriverlhr/dsh-better-webui-settings

可配置 LLM 重试策略 + 专属 better-webui 设置页（host + client）：注册 RPC 通道
`/better-webui-settings`（ping / read / apply）与「设置 → better-webui」独立页，
页面集中管理 better-webui 的功能偏好，不混入 dsh 自身设置分区。

页面内容：

- **重试策略**：DSH 原生重试默认 `maxRetries: 2`（太少且不可调）。本包通过
  `settings` 服务把用户选定的**全局默认策略**（重试次数 + 指数退避初始/最大延迟 +
  抖动）幂等地写入 `llm-pi-ai.providers.*.retryPolicy`，由 dsh 自带的
  `dsh-llm-retry` 原样执行，改 `settings.yaml` 即热加载（pi-ai 适配器实时读
  `retryPolicy`，**无需重启**）。
  - **不覆盖手写配置**：某个 provider 若已声明自己的 `retryPolicy`（与插件上次
    写入的 `lastApplied` 标记不同），页面把它列为「手写配置」并跳过；
    想单独设的 provider 手写 settings.yaml 即可。
  - 策略 + `lastApplied` 标记持久化在 `better-webui.retry` 设置命名空间
    （settings.yaml 里 `better-webui:` 一节），重启后依然生效。
- **会话提示音**：开关 + 音量滑块从 dsh 通用设置**移入**本页（v0.19 起）。
  纯客户端 localStorage（键 `better-webui:notify:enabled` / `:volume` 不变，
  老用户设置不丢），chime 包的播放逻辑继续读这两个键。

- 服务依赖（硬）：`connection`、`settings`
- wire 版本：`WIRE_VERSION = 1`（host）与 `WIRE = 1`（client）必须一致

独立安装：把 `@blueriverlhr/dsh-better-webui-settings` 加进 `dsh.profile.bundles`
并声明依赖（见根 README「按需安装」）。更常见的做法是装根元包一起带上。
