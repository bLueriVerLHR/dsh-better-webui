# better-webui 设计讨论与决策记录（v0.4 已实施）

> 记录三个未完成功能的**机制调查 → 逐条讨论 → 决策结果**。
> O1–O4 已全部裁决并实施（§5.1）；本文件保留讨论过程作为依据。
> 配套背景：[docs/dev-notes.md](dev-notes.md)（部署/热加载/插件契约/坑与教训）。

---

## 1. 范围与现状

已完成（回归稳定，v0.3 基线）：

- 会话标题栏垃圾桶：两步确认删除 → 移入回收站（宿主搬目录）→ 切新会话 → 带撤销 toast。
- 侧栏底部两枚图标（Settings 上方）：**回收站**（数量徽标 + 恢复/彻底删除弹层）与
  **归档查看器**（原生归档会话 · 点击回看）。

v0.4 已实施（原三个未完成功能，全部落地）：

1. **撤回对话**：用户消息行（复制按钮旁）编辑图标 → fork 桥接重写。
2. **删除会话后仍可见**：trash 联动原生归档，删除即从侧栏消失。
3. **归档会话打不开**：放弃 `sessions.open` 回看路线（根因见 §2），改为
   信息行 + 恢复回侧栏 / 移入回收站 / 死行清除。

---

## 2. 已核实的 harness 机制事实

以下**是后续设计的硬边界**（源码 + 运行中 3080 服务实测）：

| 事实 | 说明 |
|---|---|
| `session.list` 基线 = 内存 attached + 持久层冷 | `listVisibleSessionSummaries`：`ctx.sessions.list()`（内存）⊕ `persistence.list()`（冷,需 `cwd`）。**归档不会让它消失**。 |
| `session.history` 对归档会话可读（实测 ✓） | 我 curl 验证：归档会话在 list 中、history 正常返回事件。**宿主侧打开完全正常**。 |
| 归档 = 原生隐藏机制 | `workspace.archiveSession` 把 id 加入归档集 → 会话**从一切分组面消失**，保留 workspace 记账 + 持久层。**无 unarchive**（源码明示 future）。v0.4 补充：注册表的 `enqueueOperation`+`setState` 是普通运行时方法，插件可安全地增删归档集，持久化与 `host/archived-sessions-changed` 全端推送由 apiproxy 存储监视器自动完成 |
| 归档会话的 `sessions.open` 会被清掉 | `WorkspaceRuntime.project()`（client/runtime workspaces/service.ts:342）：当前 selection 落入归档集即 `sessions.clear()` 清回 New Session——"隐藏行不得留在列表背后打开"是原生规则。**这就是 O3"点开变空白会话"的根因**，`sessions.open` 路线架构上不通 |
| 插件无法让宿主丢弃活会话 | `AgentHandle.dispose()` 是 capability（归 apiproxy 工厂）；`SessionStore` 无 detach-by-id。→ **删除后附着的会话会一直留到服务重启** |
| 日志 append-only，无截断 RPC | `session.*` 方法集 = list/create/history/models/selectModel/rename/**fork**/prompt/attachment/updateQueue/cancel。无“删消息/截断到 seq” |
| 重写历史官方通道 = **`fork(atSeq)`** | 原生 branch 用 `sessions.fork({atSeq}) → open`。“atSeq 之后第一个 `turn/end`”为界裁出子会话。 |
| 会话内替换上下文 = compaction 替换面 | `compaction/summary` + 紧随的 replacement `user/message` 可把一段 surface 节点 **shadow** 成摘要；**日志保留可回看**，模型上下文被替代。 |
| 侧栏/工作区浏览器是**单入口无行级插槽** | `sidebar.workspaces` = single（整个浏览区），无 per-row 装饰槽；给侧栏行“置灰”须整组覆盖（v1 教训，禁用）。 |
| 用户消息**无** extraActions 插槽 | 用户行只有 copy+clock；**仅 assistant 回合尾部**有 `conversation.chat.assistant-actions`（原生插件扩展位，夹在 copy/branch 之间）。 |
| session-scope 插槽自动拿标准 kit | `useSession`/`sessionId`/`useSessions`/`useWorkspaces`，及 ui-conversation 注入的 `useInput`+`inputActions`（含 `setDraft`）。 |

---

## 3. 五问五答（用户决策记录）

### Q1 删除语义 → **归档联动（推荐项）**

采纳：**删除 = 移入回收站 + 原生归档（即时隐藏）**。

- trash RPC 内：quiesce（cancel+flush）→ `workspaceRegistry.archiveSession(id)`（原生隐藏）
  → 搬目录到 trash → 写 `trash.json`（补 `archived` 标记）。
- 会话**立即从侧栏消失**（原生机制，零覆盖），不再“删除后仍可见”。
- **代价（须接受）**：无 unarchive → 恢复的会话保持归档，只从归档菜单可回看/继续**
  对话，**不回侧栏**。恢复流程 = 搬回 + 客户端 refresh + 自动 open + toast 明示
  “已恢复到归档，可从归档菜单查看”。
- 未选：B 改 harness（加 delete/unarchive，需从源码跑 dsh）；C 维持现状。

### Q2 撤回入口位置 → **用户自定义：跟“复制当前提示词”的按钮同排**

- **与现状冲突，即 [O1]**（§5）。复制按钮在“用户消息”行；但 harness 目前**只有**
  assistant 回合尾的 extraActions 位。要在用户消息行加按钮且不覆盖原生件，可选的合规做法受限。
- 候选：(a) 把撤回放到**每条 assistant 回合尾部**（同一操作行，且能天然满足 Q4 的
  “任意位置”）；(b) 严格在用户消息行 → 需给 harness 打小补丁（新增用户 actions 槽）
  或做被否决的整组覆盖。

### Q3 撤回后源会话 → **用户自定义：否了 fork**

“撤回不删除，不 fork，保留在会话里，不发送给模型。可以重新查看，但不能沿着已经被重写的提示词继续。”

- 这是**最难落地的约束 [O2]**。字面 = 同一会话、日志可回看、但模型上下文不能沿重写前的
  提示继续。而 harness append-only，要“把已发后缀从上下文剔除”只有两条路：
  `fork(atSeq)`（新建子会话）或 compaction 替换面（把尾部 shadow 成摘要，需 LLM 后端且
  语义是“摘要”而非“空白”）。
- 综合判断：用户否的可能是 **fork 带来的“可见会话散落”副作用**，未必反对 fork 机制本身 ——
  需 §5 摆方案让用户二选一。

### Q4 撤回范围 → **支持任意位置**

宜：不只“最后一条”，且支持从任意一条撤回 → 正好耦合 Q2 的“回合尾部操作位”
（每个已完成回合给一个“撤回到此之前”）。

### Q5 归档点不开的症状 → **用户实测，推翻我原假设**

- 用户实测：点归档行**开出新的空白会话，无内容**；console 无插件报错，只有
  `connection lost, retry` 网络重连噪音（`ERR_NETWORK_IO_SUSPENDED`）。
- 这**不是**我最初猜的“悬空 id → `sessions.open` 静默抛 `unknown session`”（那是直接失败，
  不会开新空白会话），更像是落到“空白新会话/workspace 落空”分支或历史窗口拉取落空。
- **列为 [O3]**（§5）：需在真实 client runtime 复现，或请用户给一次 devtools 调用详情后再修。

顺带发现的两个 bug：

- 归档/回收站行标题全显示“无标题”—— 插件读 `summary.title`（durable title 全空），
  应改用 `summary.displayTitle`。
- 归档集里已有 **多个 id 的会话目录被删**（疑似旧回收站“彻底删除”遗留），这些行会产生
  “点不开/无内容”的错感，新设计要显式标灰/标记。

---

## 4. 目标架构（SOLID + 模式）

按“不越 harness 原则”的可落地结构给出；**具体实现受 §5 未决项 <[ ]> 约束**。

### 宿主半（src/host.js）

| 模块 | 模式 | 职责 |
|---|---|---|
| `TrashStore` | Repository | trash.json 原子读写（tmp+rename），补 `archived` 标记；内存缓存当前索引 |
| `SessionRemover` | Command 编排 | 一次 trash：quiesce → 原生归档 → 搬目录 → 写索引（顺序保证 cold 会话仍 `sessionKnown`） |
| 方法表 | Command 派发 | 现有 `listTrash/trash/restore/destroy` 扩展；`restore` 返回值交客户端接管导航 |
| inject | — | host 例新增 `'workspaceRegistry'`（精确名），trash 内调 `archiveSession` |

### 客户端（src/client.bundle.js）

| 模块 | 模式 | 职责 |
|---|---|---|
| `api` 闭包 | Facade + ISP | 窄动词面：`trash/restore/destroy/listTrash/retract…`；统一 unwrap RpcResult |
| `ArchiveViewer` 行模型 | Adapter(防腐读模型) | 合并 **archivedSessionIds × sessions.byId × trashItems** → 行状态 `alive / dead`（trashed 归回收站菜单） |
| 行组件 | Strategy | 每状态自行动作集；dead 置灰不可点；alive → 回看 + 移入回收站 |
| 回看出口 | try/catch | open 失败 → 显式 error 通知，不再静默 |
| `RetractAction` | — | 挂头栏或回合尾（**取决于 O1**）；`useSession` 纯派生（目标 turn 边界 seq/运行态）→ 两步确认 → `api.retract` |
| toast 总线 | Observer | 扩展 `撤回失败/已撤回/已恢复（仍归档）` 通知 |

### 撤回（功能 1）候选实现（O1/O2 裁决后换算）

- **路线 F（fork 桥接）**：cancel（运行中）→ `sessions.fork({atSeq, no 标题自增})`
  → `open(子)` → `input.for(actx).setDraft(原文本)`。**桥接回原会话视图**（视觉像就地改、
  实际子会话），源自动归档。最接近“内容剔除 + 可继续”，副作用小而受控。
- **路线 N（同会近似）**：cancel + 同会后续 turn —— 不剔除旧上下文（不满足“不能沿重写继续”，仅近似）。
- **路线 C（compaction shadow 尾部）**：把被撤回尾部 shadow 成标记摘要，日志可看、上下文被替代；
  依赖 LLM 摘要后端，语义是“摘要”非“空白”，更重。最终由用户裁决（O2）。

---

## 5. 开放问题（已全部裁决）

### 5.1 裁决结果与落地（2026-08-18）

| ID | 裁决 | 落地 |
|---|---|---|
| **O1** 撤回入口 | 用户坚持"复制按钮旁"；用户消息行无官方槽 → **给 harness 打补丁新增 `conversation.chat.user-actions` 槽**（源码 + 部署镜像双落地，见 dev-notes §11），撤回按钮经该槽插在 copy 与时间之间 | `src/client.bundle.js` RetractPromptAction |
| **O2** 撤回语义 | **fork 桥接**：cancel（运行中）→ `fork(atSeq=上一回合 turn/end seq)` → open 子会话 → `inputActions.setDraft(原文)` → **源会话自动归档**（可回看/可反归档） | 同上 + host `archive` |
| **O3** 归档回看 | **放弃回看**：根因是原生投影规则（`WorkspaceRuntime.project()` 在当前会话落入归档集时清回 New Session），`sessions.open` 架构上不通。归档行改为信息行 + 恢复回侧栏 / 移入回收站 | SidebarToolsAction 归档弹层 |
| **O4** 死归档行 | 用户要求**能直接清除记录**：死行置灰标注"会话已删" + 弹层底部「清除失效记录」（两步确认）→ host `purgeArchived` 经注册表操作队列从归档集移除死 id | host `purgeArchived` |

### 5.2 原始选项存档

| ID | 问题 | 选项 | 影响 |
|---|---|---|---|
| **O1** | 撤回入口“在复制用户提示词的按钮旁，”但 harness 该位无用户消息插件槽（只有 assistant 回合尾的 extra-actions） | (a) 放回合尾部（官方位、满足任意位置）；(b) 严格在用户消息行（需补 harness 小补丁或做禁用覆盖） | 撤回 UI |
| **O2** | “同会话 + 不留新会话 + 上下文不沿重写继续”难以照原样实现（append-only 无截断） | (1) fork 桥接回原视图（实际子会话 + 源归档）；(2) 同会近似（上下文不剔除）；(3) compaction shadow 尾部 | 撤回语义/实现 |
| **O3** | 归档点开会弹“新空白会话”，真实原因需复现 | 用户给 devtools 一次详情；或用 harness runtime fixture 写 jsdom 集成测试驱动真实 renderer + `sessions.open` | 归档打开 / 测试 |
| **O4** | 死（悬空）归档 id 的呈现 | 置灰 + 提示“会话已删” vs 仍支持“在回收站→彻底删”（但无法从归档集移除该 id，一行永远置灰） | 归档查看器 |

---

## 6. 热加载安全约束（不违背 harness 原则）

- 只做 **additive 注册**：`conversation.session.header.actions`、`sidebar.footer.action`、
  （待定）`conversation.chat.assistant-actions`。**不覆盖** `conversation.chat.node/user`、
  `sidebar.workspaces`、`tool.call.toolview/bash`。
- 新增注入服务名精确核对：client 例 `'conversation'`/`'sessions'`/`'workspaces'`；
  host 例 `'workspaceRegistry'`。名错则插件静默不 apply。
- 客户端半改动 → 刷新热加载（webserver stat-poll）。宿主半（host.js / inject 变动）→
  **由用户在 shell 重启 `dsh web`**，代理不碰长驻进程。
- 模块级共享态保持最简、可重连自愈：列表在弹层打开时重拉（现有 `listTrash`）。
- 不覆盖原生图标/复制/分叉；沿用现有 `--dsw-*` token + 28×28/36×36 几何。

---

## 7. 验证计划（草案）

- 单元：`tests/smoke.mjs` 扩展 —— jsdom 驱动构建产物，断言：
  trash 后 host `trash.json` 含 `archived:true`；`ArchiveViewer` alive/dead 判别 + dead 置灰；
  `sessions.open` 失败 → 通知（不静默）；撤回（选定路线）两端：cancel + fork/同会 +
  `inputActions.setDraft` 收到原文。
- 宿主 RPC：curl 在 `/better-webui/trash` 后验证 `workspace.archiveSession` 生效
  （`workspace.archivedSessionIds` 含 id、`session.list` 不再含该会话、trash 目录已搬）。
- 真机流程：host.js 改 → 用户重启 `dsh web`；client-only 改 → 刷新即可。

---

## 8. 变更影响 / 增量（已实施）

- O1–O4 裁决落定 → v0.4 全部实施（见 §5.1）。
- harness 源码补丁（user-actions 槽）：`packages/client/ui-conversation` 三处 +
  部署镜像补丁脚本 `scripts/patch-ui-conversation.mjs`（升级 dsh 后重跑）。
- host：`src/host.js` — trash 归档联动、restore/destroy 反归档、cancel、
  restoreArchived、archive、purgeArchived RPC → 重启 `dsh web`。
- client：`src/client.bundle.js` — 撤回按钮、归档行改造、displayTitle 修正 → 刷新即可。