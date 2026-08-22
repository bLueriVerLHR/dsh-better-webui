# @blueriverlhr/dsh-better-webui-bashguard

持久化 bash 卡顿卫士（host only）：在 `tools/execute` waterfall 上量每个 `bash`
调用的墙钟耗时，owner 持有活动 PTY 且连续 3 次调用 ≥ 2800ms 时判定沉默档退化，
调用 `terminals.kill` 重置该 owner 的 shell，让快路径恢复。冷却 60s、kill 上限 2s，
绝不拖住工具调用。

- 服务依赖（可选）：`agentPresets`（经 `serviceFor(agent, 'terminals')` 读 realm
  隔离的 terminals 服务）
- 纯函数核心：`updateStallStrikes`（可脱离运行时单测）
