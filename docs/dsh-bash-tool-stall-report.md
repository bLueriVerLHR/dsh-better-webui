# dsh 持久 bash 工具调用卡顿调查报告（针对 dsh 0.1.0-rc.7）

> 调查对象：dsh 的 tool calling 是否在 `bash`（持久 shell）调用后出现长时间停顿，
> 根因是否如开发者所说与 `dsh>` / `__DSH_PERSISTENT_BASH_PROMPT__` 硬编码有关，
> 以及"最新版已修复"的说法是否成立。
>
> 证据来源：`/home/archie/forge/deepseek-harness`（dsh 源码 git checkout，HEAD =
> `99f6f02fec` = `dsh-v0.1.0-rc.7`，与运行中的全局安装版本
> `/home/archie/.nvm/.../@deepseek-ai/dsh` `0.1.0-rc.7` 完全一致）+ 真实 PTY 实测脚本
> [repro-pty-stall.mjs](repro-pty-stall.mjs)。
> 报告日期：2026-08-20。后续核查：2026-08-21（见 §11 更新）。
>
> > **2026-08-21 更新（重要）**：本报告初稿称"rc.7 已是最新发布版"，**已过时**。
> > 经核查 npm registry 与上游 `git clone`，最新版为 **`0.1.1-rc.2`**（= master），
> > 且 **该卡顿在 0.1.1-rc.2 中依然存在**（`terminal-bash` 的 `session.ts`/`sanitize.ts`
> > 原封不动，`tool-bash-persistent` 只做了 session-exit 重构）。详细对比见 §11。

---

## 1. 结论摘要（TL;DR）

1. **是，dsh 的 tool calling 存在一个真实、会静默反复发作的性能缺陷**，且
   **"最新版已修复"只修了一半**。
2. 根因与开发者说的一致：`dsh-tool-bash-persistent` 的每次 `bash` 调用能否快速
   返回，取决于后端能否在 PTY 输出里识别到 **`dsh> ` 提示符 + OSC `133;D;` 私有
   标记** 这条"就绪协议"。一旦协议被破坏，**每次调用静默退化为 3 秒沉默等待
   （`idleSilenceMs` 3000ms，可加 `handoffGraceMs` 500ms），没有任何报错或日志**。
3. rc.7（commit `a8dc6f9776`，Fixes #2585）修复了"工具自己把 PS1 改掉"这一种
   破坏方式，实测正常命令 ~100ms 返回；**但显式承认修复不了"命令覆盖
   `PROMPT_COMMAND`"这一种**——实测这种破坏会**永久**让之后每次 bash 调用都
   ~3s 返回，直到 shell 被重置。
4. 更糟的还有两类：**macOS（以及 Linux 容器里 ptrace 受限时）下的交互式子进程**
   （`cat`、REPL、`read`）会一路等到 **300s 命令超时**（5 分钟停顿）；长命令/流式
   输出的 settle 周期也可能按 30s/300s 的绝对超时走。
5. 性质：**不是安全漏洞、结果不会错**——是"静默、持续、无信号"的性能塌陷。
   快路径整条依赖硬编码的 `dsh> ` 字符串，是设计上最脆弱的一环。

---

## 2. 背景：开发者说的 `dsh>` 与 `__DSH_PERSISTENT_BASH_PROMPT__`

dsh 有两套 `bash` 工具，只有一套与本次问题相关：

| 工具 | 实现 | 用什么跑命令 | 与 `dsh>`/`__DSH_PERSISTENT_BASH_PROMPT__` 相关？ |
|---|---|---|---|
| `@deepseek-ai/dsh-tool-bash` | 非持久，`ctx.shell.run` | 每次 `bash -c` 子进程 | **否**（不走 PTY） |
| `@deepseek-ai/dsh-tool-bash-persistent` | **持久**，`ctx.terminals` PTY | 每个 Agent 一个常驻 bash | **是**（本次问题所在） |

Web GUI 的 `standard`（标准模式）预设用非持久 `tool-bash`；`minimal`（极简模式）
预设用 `tool-bash-persistent`（`apps/cli/config/agent-presets/minimal/agent.cordis.yml`）。

> ⚠️ **判定基准：以 dsh 版本为准，不与预设绑定。** 本缺陷根因在
> `@deepseek-ai/dsh-terminal-bash` 的 PTY 就绪协议（dsh 本体，版本相关），
> **任何**用到该后端的会话（无论哪个预设，只要底层走 `dsh-terminal-bash` 的
> `inferred_idle` 沉默档兜底）都可能出现；触发与否取决于会话内是否发生了
> `PROMPT_COMMAND` 覆盖 / 平台 ptrace 受限 / 静默命令等，与用户选的预设无关。
> 后续如需判断某次卡顿是否本缺陷，应按 **dsh 版本**（`dsh --version`）与
> 本报告的根因/复现对照，而不是按会话预设。


**旧版（修复前）的硬编码问题**（git 历史，见 §3）：
旧 `tool-bash-persistent` 初始化时执行 `stty -echo; PS1='__DSH_PERSISTENT_BASH_PROMPT__ '`，
把后端在 spawn 环境里设置的 `PS1='dsh> '` 覆盖掉。后端"就绪判定"要求提示符尾部
**恰好等于** `dsh> `（`packages/terminal/terminal-bash/src/sanitize.ts` 的
`CONTROLLED_PROMPT`），于是快路径永远不命中，**每次调用都付 3.5s 沉默档**。
修复 commit 自测：darwin 下工具调用从 7180/3560/3566ms 降到 355/88/91ms。

---

## 3. Git 历史记录（相关 commit）

在 `/home/archie/forge/deepseek-harness` 中检索 `__DSH_PERSISTENT_BASH_PROMPT__`：

```
a8dc6f9776  fix(pty): keep the controlled prompt so persistent bash settles fast   ← 本次"修复"（2026-08-15, Fixes #2585）
665c21693b  feat(tools): add persistent bash and str-replace editor                ← 引入该工具（2026-07-29）
a2d0f7f411  refactor: apply repository naming contract                              ← 只做包改名（packages/pty → packages/shell）
```

- 工作区 HEAD = `99f6f02fec` = `dsh-v0.1.0-rc.7`，`origin/master` 与之相同，
  **当时已是最新发布版**；全局安装的 dsh 也是 `0.1.0-rc.7`。（**注**：截至
  2026-08-21，npm 上已有更新版本 `0.1.0-rc.8` / `0.1.1-rc.2`，见 §11。）
- `a8dc6f9776` 通过 PR #2586（`7841e0a93e`）合入，**包含在 rc.7 里**
  （`git tag --contains a8dc6f9776` → `dsh-v0.1.0-rc.7`）。
- 修复的实现说明见
  `.agents/notes/implemented/bug-fix/2026-08-15-persistent-bash-keeps-controlled-prompt.md`，
  末尾明确写：
  > **The self-repair cannot survive a command that overwrites `PROMPT_COMMAND`
  > itself; the silence tier remains the bound there, unchanged from the prior design.**

  即：**官方已知修复不覆盖 `PROMPT_COMMAND` 被覆盖的情况**——这正是用户仍会遇到的
  主要残留问题之一。

---

## 4. 就绪协议机制（为什么快 / 为什么会慢）

后端 `dsh-terminal-bash` 的每次 `startSend` 何时算"结束"（`operation.done`），
由 `packages/terminal/terminal-bash/src/session.ts` 的 `pollReadiness` 决定：

| settle 路径 | 触发条件 | 时延 | 备注 |
|---|---|---|---|
| **快路径** `stdin_read` | 看到 OSC `133;D;` 标记 **且** 其后尾部**恰好等于** `dsh> `，且前台 pgid = shell pgid，且静默 ≥ 50ms | ~50–150ms | 正常命令都走这条 |
| stdin-wait 探针 `stdin_read` | ≥ `exactProbeAfterMs`(150ms) 且前台进程被证明在等 stdin | ~150ms | 靠 Linux ptrace，见 §7 |
| **沉默档** `inferred_idle` | 静默 ≥ `idleSilenceMs`(3000) + (`promptSeen`? `handoffGraceMs`(500) : 0) | **~3–3.5s** | 标记/提示符缺失时兜底 |
| 绝对超时 `timeout` | ≥ `timeoutMs`（默认 30000；minimal 预设配成 **300000**） | 30s / 300s | 流式输出持续时兜底 |

工具 `tool-bash-persistent` 的循环（`src/index.ts` `executeCommand`）：
1. 首次 `startSend(包装后的命令, submit:true)` → `await operation.done`（**这一步
   就卡在上一张表**）。
2. 读 scrollback，若含随机 end 标记 `__DSH_PERSISTENT_BASH_END_<nonce>:` → 返回完整
   输出。
3. `waitReason === 'stdin_read'` 且无 end 标记 → 返回部分输出（`exec`/交互子进程）。
4. 否则空文本重发 + 25ms 轮询，直到命令超时（工具级 300s）。

**关键点**：工具必须先等 `operation.done` 结束，才去读 scrollback 找 end 标记。
所以 end 标记早就出现了，但只要 PTY 就绪判定走了慢路径，工具就照样干等
3s / 5min。**工具返回时延被"提示符就绪"完全绑架。**

---

## 5. rc.7 到底修了什么（实测验证）

`a8dc6f9776` 两处改动：
1. 后端 `PROMPT_COMMAND` 变成 `printf "\033]133;D;%s\007" "$?"; PS1='dsh> '`——
   **每次渲染提示符前都重新断言 PS1**，让"命令改了 PS1"这种破坏只活一个提示符。
2. 工具初始化只留 `stty -echo`，不再动 PS1；"没有 end 标记"的兜底改用 seam 的
   `stdin_read`，不再匹配自己的提示符文本。

我用真实 node-pty bash + 忠实移植的 sanitizer/session 判定逻辑做了实测
（`repro-pty-stall.mjs`，本机 Linux，默认参数）：

```
1) normal command (echo ok)            → settle in   101 ms  (stdin_read)   ✓ 快路径
2) normal command after PS1=broken     → settle in    52 ms  (stdin_read)   ✓ 自愈生效
3) after PROMPT_COMMAND=... override   → settle in  3021 ms  (inferred_idle) ✗ 退到沉默档
4) normal command still degraded       → settle in  3017 ms  (inferred_idle) ✗ 永久退化
```

→ **修复对"正常命令 / 改 PS1"有效（~50–100ms），对"覆盖 PROMPT_COMMAND"无效，
且该退化会一直持续到 shell 重置。**

---

## 6. 残留问题（用户"还是觉得没修好"的具体来源）

### 6.1 覆盖 `PROMPT_COMMAND` → 每次 bash 调用永久 +3s（实测确认，官方已知）
只要 shell 里有一次 `PROMPT_COMMAND=...` 赋值（`export`、`source ~/.bashrc`、
starship/direnv/conda 类环境管理脚本都可能干），`133;D;` 标记就不再发出，
快路径从此永不命中 → **之后每次 bash 调用都静默付 ~3s**，直到 `exit`/超时/发送失败
重置 shell。没有任何报错、没有日志、没有给模型的信号。

### 6.2 交互式子进程在 mac（以及 Linux 容器 ptrace 受限）下 → 最多等 5 分钟
`cat`、`read`、`python3` REPL、任何在前台等 stdin 的程序，靠 `stdin_read` 提前
返回。但：
- **macOS**：`MacProcessInspector.isStdinWaiting()` 直接 `return false`
  （`process-inspector.ts`），无 ptrace 档 → 交互子进程不触发提前返回 → 一路等到
  **工具 300s 命令超时**。
- **Linux 容器/沙箱**：stdin 证据靠读 `/proc/<pid>/task/<tid>/syscall`，只有线程
  阻塞在 syscall 且进程可被 ptrace 时才给出。受限环境下返回 `running` 或读失败 →
  `readSyscall` 返回 undefined → 同样退化成"无法证明 stdin 等待"。
  注意：极简预设里 bash 是在 `danger-full-access` 下跑，但 PTY 自身是否可被
  ptrace 取决于宿主沙箱，并不保证。
- 这是工具 README 里明示的 known limitation，也是官方实测只在 darwin 上验证过
  "stdin_read" 档的原因之一。

### 6.3 无输出 / 有静默间隙的命令 → 每个轮询周期固定 +3s
`sleep`、编译期停顿、下载间隙等：每个 `startSend` 都等满 `idleSilenceMs`(3s) 才
settle，工具循环每 3s 才查一次 end 标记。正确但慢。

### 6.4 流式/持续输出命令 → 按绝对超时 30s/300s 结算周期
命令持续输出时 `idleFor` 永远到不了 3s，settle 只能等绝对 `timeoutMs`
（默认 30s；**minimal 预设给 `terminal-bash` 配成 300s**）。命令本身没结束就
一直空转。虽然 end 标记出现后下一轮能快返，但长命令整体时延被放大。

### 6.5 提示符尾部污染（边缘）→ 偶发 3.5s
`sanitize.ts` 的 tail 追踪上限是 `dsh> ` 长度+1（6 字符），一旦标记之后紧跟超过
1 个字符的输出（如同 chunk 里提示符后紧跟后台任务输出），`promptTextSeen` 被写成
`dsh> \0` 而变 false → 该 send 丢失快路径。属边缘，但说明整条协议对时序极其敏感。

---

## 7. 平台差异（为什么"有些机器快、有些机器慢"）

| 平台 | `isStdinWaiting` | 交互子进程行为 |
|---|---|---|
| Linux（ptrace 可用） | 读 `/proc/.../syscall` + ptrace 拦截 `read/poll/ppoll/epollWait` | ~150ms 提前返回 |
| Linux（容器/沙箱 ptrace 受限） | 恒 false（读不到有效 syscall） | 退到沉默档/超时 |
| macOS | **恒 false**（`process-inspector.ts` 明写） | 一路到 300s 命令超时 |

---

## 8. 严重性评估

- **不是安全漏洞**：结果永远正确，只是慢。
- **是严重的可靠性 / 体验缺陷**：
  - **静默**：没有任何报错、日志、模型可见信号；
  - **持续**：一次破坏 `PROMPT_COMMAND`，整个会话剩余时间的每次 bash 都付 3s；
  - **可放大**：多步任务里每步都付，累加起来非常明显；mac 下交互命令直接 5 分钟。
- 根因是**设计脆弱性**：快路径把"就绪"建立在"硬编码的 `dsh> ` 提示符 + 私有 OSC
  标记"上，而这二者可以被任何普通命令意外破坏。`__DSH_PERSISTENT_BASH_PROMPT__`
  那个硬编码字符串删掉了，但 `CONTROLLED_PROMPT = 'dsh> '` 这个**协议常量**仍在，
  依赖关系没变，只是不再由工具自己触发。

---

## 9. 可选处理方案（供决策，未实施）

> 用户的约束：dsh 本体在 `deepseek-harness`（升级会被覆盖）；better-webui 是
> 运行时插件。方案按"改哪层"分类，标注实施成本与效果。

### 方案 A（推荐，改 dsh 本体 `tool-bash-persistent`）：工具不再等 PTY 就绪，改等 end 标记
- **做法**：`executeCommand` 里不要死等 `await operation.done`；提交包装命令后，
  以 ~25ms 轮询 `ctx.terminals.read` 找随机 end 标记，**end 标记一出现就返回**；
  并行仍监听 `operation.done` 的 `stdin_read`（交互子进程）/ `session_exit`（退出）/
  命令超时，保留现有兜底。
- **效果**：工具返回时延与提示符就绪**完全解耦**——6.1 / 6.3 / 6.4 / 6.5 全部消除；
  6.2（交互子进程）由 stdin_read/超时兜底维持原样。
- **成本**：改动集中在 `packages/shell/tool-bash-persistent/src/index.ts`（dsh 上游
  或本地 patch）。这是从根上修，官方路线也符合"回归即失败"的测试要求。
- **说明**：`operation.done` 本就只是"PTY 判定 settle"，end 标记才是命令完成的
  唯一可靠信号；工具已在读 scrollback，轮询成本可忽略。

### 方案 B（改 dsh 本体 `terminal-bash`）：让协议能自愈 `PROMPT_COMMAND`
- **做法**：把 PROMPT_COMMAND 的恢复放进工具每次命令的包装前缀（`PROMPT_COMMAND='...'; PS1='dsh> '; eval ...`），
  使破坏只影响"覆盖那一次"而不是永久；或检测到连续 N 次走了沉默档就自动重置 shell。
- **效果**：缓解 6.1；不解决 6.2–6.5。
- **成本**：改后端 + 工具，仍需上游/本地 patch。

### 方案 C（不动 dsh，只调配置）：降低 `idleSilenceMs` / `handoffGraceMs`
- **做法**：在 preset 的 `terminal-bash` 配置里把 `idleSilenceMs` 从 3000 调低
  （如 300），`handoffGraceMs` 同步调。
- **效果**：把"每次 3s"缩到"每次 0.3–0.8s"，立竿见影但只是**重新平衡**；6.1 的
  静默退化依旧、6.2 mac 5 分钟依旧，且调太低可能误判长命令。
- **成本**：纯配置，零代码，可立即在 `~/.dsh/.agent-presets/.../agent.cordis.yml`
  或 profile patch 里改。

### 方案 D（better-webui 插件内缓解）—— **已于 2026-08-21 实施**（见 §11）
- 插件无法干净地改 `terminal-bash` 内部。可行的是：宿主 half 里加一条
  `tools/execute` 监听，检测到"连续 bash 调用走沉默档"后调用
  `ctx.terminals.kill` 重置 shell（让下一次调用从干净状态开始）；
  或在 persona/系统提示里提醒模型不要改动 `PROMPT_COMMAND`（很弱）。
- **效果**：把"永久退化"变成"最多影响几次"，属止痛而非治本。
- **已实施形态**：`src/host.js` 的 `installPersistentBashStallGuard` —— 用
  `tools/execute` 量每次 `bash` 调用的墙钟耗时（插件拿不到内部 `waitReason`，
  只能按时长推断：健康调用几十 ms，沉默档调用 ≥ idleSilenceMs 3s），同一 owner
  连续 3 次 ≥ 2.8s 且持有活动 PTY 会话 → `ctx.terminals.kill` 重置该 owner 的
  所有会话；带 60s 冷却防止抖动。纯逻辑 `updateStallStrikes` 已单测
  （`tests/stall-guard.mjs`，23 项断言）。代价：重置后下一次 `bash` 调用会
  **先报一次错**（工具缓存了已死会话 id → `startSend` 失败 → 工具 reset 缓存 →
  下下次从新 shell 开始），符合"止痛"定位。

### 建议
优先推动**方案 A**（工具级解耦），它是唯一能从根上消除"每次 bash 都慢"且不依赖
提示符协议的修法，且可独立验证（回归测试断言"故意覆盖 PROMPT_COMMAND 后，下一条
命令仍应在几百 ms 内返回"）。在 patch 落地前，可用**方案 C** 快速缓解，
**方案 D 已作为 better-webui 的运行时止痛落地**（见 §11）。

---

## 10. 复现脚本

`docs/repro-pty-stall.mjs`：真实 node-pty bash + 忠实移植的 `TerminalSanitizer` /
`LocalPtySession` 判定逻辑，直接打印每次 `startSend` 的 settle 时延与 waitReason，
可复现本报告 §5 的四组数字。运行：

```sh
node docs/repro-pty-stall.mjs   # 依赖全局安装 dsh 的 node-pty，或设 NODE_PTY_PATH
```

---

## 11. 2026-08-21 更新：最新版核查 + better-webui 插件侧缓解

### 11.1 "rc.7 已是最新"已过时，且 0.1.1-rc.2 并未修此卡顿

- npm registry（`@deepseek-ai/dsh` dist-tags）：`latest` = **`0.1.1-rc.2`**；
  另有 `0.1.0-rc.8`（08-19）、`0.1.1-rc.1` / `rc.2`（08-21）。
- 用 `git clone https://github.com/deepseek-ai/deepseek-harness`（`--filter=blob:none`，
  保留全历史与标签）逐文件对比 `dsh-v0.1.0-rc.7` → `dsh-v0.1.1-rc.2`：
  - `packages/terminal/terminal-bash/src/session.ts`、`sanitize.ts`：**零改动**。
    `CONTROLLED_PROMPT = 'dsh> '`、`idleSilenceMs=3000`、`handoffGraceMs=500` 原样。
  - `packages/shell/tool-bash-persistent/src/index.ts`：仅把 session-exit 处理抽成
    `respondToSessionExit` 辅助函数（重构，无行为变化），仍然 `await operation.done`
    先于读 end 标记——**卡顿结构未变**。
  - `terminal-bash` 其余改动全部围绕 **pwsh（PowerShell）持久终端** 新增支持，
    与 bash 就绪协议无关。
  - `origin/master` == `dsh-v0.1.1-rc.2`（没有更新于 rc.2 的提交）。
- 结论：**最新版依然受此缺陷影响，不值得等上游**。这也是为什么选择插件侧止痛。

### 11.2 网络检索补充的知识

- `OSC 133;D` 即标准 shell integration 的 `FTCS_COMMAND_FINISHED`（iTerm2 / VS Code /
  Ghostty 等都在用），dsh 复用了它但**私有地**要求提示符尾部恰好等于 `dsh> `
  （[terminfo.dev 协议说明](https://terminfo.dev/extensions/osc133-d-command-finished)）。
- 业界最佳实践是**"标记优先"**——注入唯一标记字符串定位命令结束，而非匹配提示符
  （如 [ripple/SCHEMA.md](https://github.com/yotsuda/ripple/blob/master/adapters/SCHEMA.md)、
  VS Code OSC 633）。这印证 **方案 A**：dsh 工具本来就有随机 end 标记
  `__DSH_PERSISTENT_BASH_END_<nonce>:`，只是它先等 PTY settle 而非先查标记。
- `PROMPT_COMMAND` 被环境脚本互相覆盖是生态级已知问题
  （[starship#4642](https://github.com/starship/starship/issues/4642)），与 dsh 场景同类。
- GitHub issue 追踪（#2585 等）不对公网开放（仓库 `open_issues_count: 0`）；
  `Fixes #2585` 由 commit `a8dc6f9776` 的消息佐证，指向内部追踪号。
- dsh 源码 checkout（`.tmp-check/deepseek-harness`，已被 `.gitignore` 忽略）保留
  在 better-webui 工作区，供后续 `spec.sh` 生成补丁参考；全库 119MB。

### 11.3 better-webui 插件侧缓解（方案 D 落地）

按用户决策（删除 dsh-fix 库方案、只走插件方法），在 better-webui 宿主 half 实现
`installPersistentBashStallGuard`（`src/host.js`）：

- **检测**：`tools/execute`（waterfall，同 `guard/timeout-policy` 的挂法）量每次
  `bash` 调用墙钟耗时；同一 owner 且持有活动 PTY 会话（`ctx.terminals.list` 非空，
  天然排除一次性 `bash` 工具）时，连续 3 次 ≥ 2800ms → 判定沉默档退化。
- **动作**：`ctx.terminals.kill(owner, sessionId, reason)` 重置该 owner 所有会话；
  下一次 `bash` 调用触发工具缓存重置并重新 spawn 新 shell，恢复快路径。
- **参数**：`STALL_THRESHOLD_MS=2800`、`STALL_STRIKES=3`、`STALL_RESET_COOLDOWN_MS=60000`。
- **测试**：`tests/stall-guard.mjs`（23 项断言，含纯逻辑 + 接线），全部通过；
  既有 host/reasoning/web-search-exa/smoke 测试不受影响。
- **生效**：宿主侧为静态 bundle，改动已构建进 `lib/index.js`，需**重启 `dsh web`**
  后加载；重启由用户执行。
- **已知代价**：重置后下一次 `bash` 调用先报一次错（工具缓存了已死会话 id），随后
  从新 shell 恢复。属"止痛"：把"永久每次 +3s"变成"最多影响几次 + 一次报错"。
  根治仍应推 **方案 A**（上游或本地 patch，见 §9）。
