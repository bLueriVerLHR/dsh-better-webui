# @blueriverlhr/dsh-better-webui-reasoning

自定义模型推理等级自动补齐（host only）：启动时与 `llm-pi-ai` 配置生效时，幂等为
`llm-pi-ai` 下未声明推理能力的自定义模型补**全档位**
`reasoningEfforts: { off, minimal, low, medium, high, xhigh, max }`，并自动把仍持有
旧四档默认（`off/low/medium/high`）的模型升级到全档位，让原生 composer「推理等级」
菜单对自定义模型生效。零 UI、不改 dsh 本体。

- **全档位**：off / minimal / low / medium / high / xhigh / max，覆盖 pi-ai 原生
  支持的全部思考等级；wire 值按声明透传给后端（DeepSeek 官方认 `low/high/max`，
  OpenAI 系认 `xhigh`——按你的网关后端自选档位）
- **旧档位自动升级**：模型声明若恰好等于旧的四档默认（`off/low/medium/high`，即本包
  此前补上的），重启后自动升级为全档位，无需手改文件；手写/自定义的 dict 从不被改动
- **不覆盖已有声明**：已写 `reasoningEfforts`（自定义 dict 或 `false`）的模型从不被改动
- **退出自由**：某个不支持推理的模型，在 `settings.yaml` 里给它 `reasoningEfforts: false`
  即可恢复无菜单状态
- **事件驱动、无需等待**：补齐由 `llm/adapters-updated`（pi-ai 适配器注册/更新的
  瞬间）与 `settings/document-updated`（settings.yaml 热重载）两个事件触发，无定时器、
  无轮询——重启后 `llm-pi-ai` 一生效就补齐
- **幂等持久化**：补齐写回 `settings.yaml`，下次开机已全档则不再写入、不干扰
- **生效方式**：改动在 host half，需**重启 `dsh web`**

- 服务依赖（可选）：`settings`（`ctx.get` 能力探测，缺失只跳过）
- 不覆盖任何原生 UI；不修改 dsh 本体（升级 dsh 不受影响）

独立安装：把 `@blueriverlhr/dsh-better-webui-reasoning` 加进 `dsh.profile.bundles`
并声明依赖（见根 README「按需安装」）。更常见的做法是装根元包一起带上。
