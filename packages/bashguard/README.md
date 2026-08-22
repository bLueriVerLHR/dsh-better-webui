# @blueriverlhr/dsh-better-webui-bashguard

持久化 bash 卡顿卫士（host only）。

**背景**：dsh 的**持久化** `bash` 工具（minimal 预设及任何挂载它的 preset 使用）在
每次发送命令前通过 PTY 就绪协议等一个 prompt 标记：健康时几十 ms 即返回，但一旦
会话内有人覆盖了 `PROMPT_COMMAND`（`.bashrc`、starship/direnv/conda 或显式赋值都
可能），标记不再发出，**每次** `bash` 调用都静默退化为 ~3s 沉默档——工具只在超时/
退出时重置，所以这个退化对当前会话是**永久**的。

本包宿主在 `tools/execute` waterfall 上量每次 `bash` 调用的墙钟耗时，检测到退化后
自动恢复：

- **检测**：同一 owner（agent）持有活动 PTY 会话、且连续 3 次 `bash` 调用每次
  ≥ 2800ms → 判定沉默档退化（健康调用几十 ms，退化调用必达 ~3s）
- **动作**：调用 `terminals.kill` 重置该 owner 的**所有**会话，下一次 `bash` 调用
  从干净 shell 重新开始，快路径恢复
- **冷却**：每个 owner 两次重置之间至少隔 60s，病态循环不会反复杀 shell；kill 本身
  有 2s 上限，绝不拖住工具调用
- **作用域**：`terminals` 服务按 preset 隔离，只有挂载持久终端的 preset（minimal）
  能读到；一次性 `bash` 工具（cordis/standard 预设）无终端，跳过
- **已知代价**：重置后下一次 `bash` 调用先报一次错（工具缓存了已死会话 id），随后从
  新 shell 恢复。属"止痛"：把"永久每次 +3s"变成"最多影响几次 + 一次报错"。根治
  （工具级解耦，见 [docs/dsh-bash-tool-stall-report.md](../../docs/dsh-bash-tool-stall-report.md)
  §9 方案 A）仍在 dsh 上游或本地 patch 层面

- 服务依赖（可选）：`agentPresets`（经 `serviceFor(agent, 'terminals')` 读 realm
  隔离的 terminals 服务）
- 纯函数核心：`updateStallStrikes`（可脱离运行时单测）
- 生效方式：改动在 host half，需**重启 `dsh web`**

独立安装：把 `@blueriverlhr/dsh-better-webui-bashguard` 加进 `dsh.profile.bundles`
并声明依赖（见根 README「按需安装」）。更常见的做法是装根元包一起带上。
