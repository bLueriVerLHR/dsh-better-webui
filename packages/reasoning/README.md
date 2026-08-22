# @blueriverlhr/dsh-better-webui-reasoning

自定义模型推理等级自动补齐（host only）：启动时与 `settings.yaml` 每次变更后，
幂等为 `llm-pi-ai` 下未声明推理能力的自定义模型补
`reasoningEfforts: { off, low, medium, high }`，让原生 composer「推理等级」菜单
对自定义模型生效。零 UI、不改 dsh 本体。

- 服务依赖（可选）：`settings`（`ctx.get` 能力探测，缺失只跳过）
- 事件监听：`ctx.root.on('settings/document-updated')`（仅 llm-pi-ai 命名空间）
