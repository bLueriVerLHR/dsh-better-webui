# @blueriverlhr/dsh-better-webui-reasoning

自定义模型推理等级自动补齐（host only）：启动时与 `settings.yaml` 每次变更后，
幂等为 `llm-pi-ai` 下未声明推理能力的自定义模型补**全档位**
`reasoningEfforts: { off, minimal, low, medium, high, xhigh, max }`，并自动
把仍持有旧四档默认（`off/low/medium/high`）的模型升级到全档位，让原生
composer「推理等级」菜单对自定义模型生效。零 UI、不改 dsh 本体。

- 服务依赖（可选）：`settings`（`ctx.get` 能力探测，缺失只跳过）
- 事件监听：`ctx.root.on('settings/document-updated')`（仅 llm-pi-ai 命名空间）
- 不覆盖：自定义 dict 或 `reasoningEfforts: false`（退出）的模型从不被改动
- wire 值按声明透传：DeepSeek 官方认 `low/high/max`，OpenAI 系认 `xhigh`
  ——按你的网关后端自选档位
