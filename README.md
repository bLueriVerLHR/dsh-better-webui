# @blueriverlhr/dsh-better-webui

DeepSeek Harness Web GUI 插件：**归档会话管理**（查看 · 恢复 · 二次确认彻底删除）+
**自定义模型推理等级自动补齐**（让自定义模型像预制模型一样能用原生「推理等级」菜单）+
**会话活动提示音**（agent 等待输入 / 完成任务时播放提示音）+
**免密钥 Exa 网络搜索**（无 API key 也能用原生 `web_search`）+
**思考标签切分**（把泄漏进正文的思考文本折叠回 Think 块）+
**持久化 bash 卡顿卫士**（minimal 预设的持久终端退化为 ~3s 沉默档后自动重置 shell）。

## 功能

### 思考标签切分（Thinking-tag splitter）

部分模型提供方（如 `scnet` 的 Anthropic 兼容代理）把模型的思考文本连同字面
闭合标签（` response` = `<`+`/`+`think`+`>`、`</thinking>`）直接写进 **text 通道**，
同时声明的 reasoning 块是空的。webui 忠实渲染 text 块 → 思考显示成可见对话、
Think 区空白。本功能挂在 host 端 `llm/stream` waterfall，在数据源头把流重写：

- **切分**：text 块含代码外的真实闭合标签 → 按**最后一个**标签切分，之前全部进
  `reasoning` 块（webui 折叠进 Think 区），之后是干净可见 text；支持多标签、
  `</thinking>`、反引号/代码块保护（代码内的标签不切分）。
- **空块清除/合并**：上游声明的**空** reasoning 块（`block-start` 后一个
  `reasoning-delta` 都没有、空文本结束）**不发射** block-start/block-end——
  空 Think 框不会出现在 UI 里；若紧跟着有内容的 reasoning 块，则并入它（一条消息
  一个连续 Think 框），否则直接清除。有内容的 reasoning 块**始终保留**、互不合并。
- **协议安全**：悬空块（上游打开未闭合）在流结束时干净闭合（空块则直接丢弃），保证
  `llm-invariant` 校验通过、装配正确。
- **作用域**：只对 `provider === 'scnet'`、非辅助调用（compaction / session-title
  放行）生效；其余 provider 原样透传。

生效方式：改动在 host half，需**重启 `dsh web`**。重启后本插件随 `dsh web`
启动自动挂载，全局（所有会话）生效；dsh 升级不覆盖（插件经 `dsh plugin add`
安装，见下）。

### 免密钥 Exa 网络搜索（v0.10 新增）

注册一个 `ctx.web` 搜索 provider（id `exa`），让 dsh 原生的 `web_search` 工具
**在没有 API key 的情况下也能真搜索**，无需任何配置：

- **匿名 MCP**（默认）：走 Exa 官方匿名托管 MCP（`mcp.exa.ai/mcp`，JSON-RPC
  `tools/call`，无凭据、有限流），结果归一化成 `web_search` 的源列表
- **REST 升级**（可选）：设置了 `EXA_API_KEY`（环境变量）后自动切到 Exa
  `POST /search`（`Bearer` 认证，限额更高），无需重启
- 行为与原生搜索一致：来源 URL / 标题 / snippet / 日期、`web_search` 结果卡片，
  都由 dsh 自带工具层处理，本插件只补 provider

> 注：匿名路径是 Exa 的公共限流服务，429 时工具会提示配置 `EXA_API_KEY` 升级。
> 源码移植自 [@tonydua/dsh-web-search-exa](https://github.com/TonyDua/dsh-web-search-exa)
> （MIT，版权与许可全文见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)），
> 策略沿用 oh-my-pi 的「有 key 走 REST、无 key 走匿名 MCP」。

生效方式：插件 bundle patch 里用非 insert 覆盖把 `web` 行的 `searchProvider`
指向 `exa`（`deepseek-official` 缺 key 时不可用，所以切到本 provider）；
改 host half 后**重启 `dsh web`**。

### 会话活动提示音（v0.9 新增）

当前打开的会话里，agent **开始等待用户输入**、**完成一个回合**或**回合失败**时，
播放一段合成的提示音（**只响铃、不弹窗**）：

- **等待输入**：`ask_user_question` 提问 / 等待审批 / 方案评审时，播放下降双音
- **任务完成**：agent 由运行转为空闲、无待处理交互且正常产出答复时，播放上升三音
- **回合失败**：模型重试耗尽 / 硬错误 / 输出上限截断导致回合终止时，播放低沉双音
  （与完成音区分，绝不把失败报成完成）
- 用户手动**停止**的回合不提醒

**设置**（「通用」设置分区）：一个开关（启用/停用提示音）+ 一个音量滑块
（0-100，0 为静音）。音量滑块**拖动中不响、松手时才试听一次**。开关和音量存
**localStorage**（纯客户端，不改宿主、不写 `settings.yaml`），所以**无需重启**，
刷新页面即可生效。

实现要点：

- 检测订阅输入区 `conversation.input.dock` 的 ConversationSnapshot（`pending` /
  `running` 状态跳变），只在跳变时触发，不随每次渲染重复响
- 回合结束时按**结尾节点类型**（`assistant` / `turn-error` / `turn-max-tokens` /
  `interrupted`）路由到完成音 / 错误音 / 静音——模型重试期间的 `running` 保持 true
  不会误响，重试耗尽失败只响错误音
- 声音用 **Web Audio API 合成**（正弦振荡，无音频文件、无需构建资源）；在首次
  用户交互时解锁音频上下文，规避浏览器自动播放策略
- 不覆盖任何原生 UI

> 注：不做「模型超参设置页」。调研确认 dsh 的模型配置 schema（`llm-pi-ai`）原生
> 只支持 `contextWindow` / `maxTokens` / `input` / `reasoningEfforts` / `compat`，
> **temperature 是请求级而非模型级配置，top_p 在整个栈（dsh + pi-ai）里都没有
> 字段**，无法在不改 dsh 本体的前提下做成设置项，因此该需求已放弃。

### 归档会话管理

设置面板左侧导航里的**归档会话**页（紧跟「Agent 预设」页下方）。原生 UI 只能把
会话归档（隐藏），没有查看/恢复/删除入口——这个页面补齐它。做成独立设置页而非
侧栏图标/通用页行，是为了不占用侧栏底部，避免被动态插件面板挤掉：

- **查看**：列出所有归档会话（标题用 `displayTitle`，工作区 + 相对时间）
- **恢复**（↺）：把归档会话带回侧栏（移出归档集）
- **彻底删除**（🗑，两步确认）：真正删干净——会话目录、注册表归档集、
  工作区记账槽全部清除，无任何残留。
  唯一例外：**本进程打开过的“活”会话**（dsh 无公开 API 丢弃宿主内存里的
  活会话）删除后仍保留在归档集里**隐藏**（不回未分组），页面里以
  “会话已删 · 重启后清除”的死行呈现，重启后启动清扫自动清掉
- **失效记录**：会话已不存在的死行置灰标注；页脚「清除失效记录」
  （两步确认）把死 id 从归档集与记账槽中清掉。宿主启动时也会自动清扫一次

### 自定义模型推理等级（v0.6 新增）

DSH 的「推理等级」菜单只对带推理元数据的模型出现；手写进 `llm-pi-ai`
provider 的自定义模型（只有 id/name/容量）适配器判定为不推理，
composer 菜单缺失，无法在会话里切换思考等级。本插件宿主在启动时
（以及 `settings.yaml` 每次变更后）**幂等**地为所有未声明推理能力的自定义
模型补上标准档位 `reasoningEfforts: { off: null, low: low, medium: medium,
high: high }`，写回同一个 `llm-pi-ai` 命名空间（持久化到 `settings.yaml`，
热加载），原生 composer 的「推理等级」菜单随即对自定义模型生效，
行为与预制模型完全一致。

- **不改 UI、不改 dsh 本体**：菜单是原生的，插件只补配置元数据
- **不覆盖已有声明**：已写 `reasoningEfforts`（dict 或 `false`）的模型从不被改动
- **退出自由**：某个不支持推理的模型，在 `settings.yaml` 里给它
  `reasoningEfforts: false` 即可恢复无菜单状态
- 生效路径：宿主改动 → **重启 `dsh web`**（宿主侧启动时加载）

不覆盖任何原生 UI；不修改 dsh 本体（升级 dsh 不受影响）。

删除未归档会话的推荐流程：原生会话行菜单 →「归档会话」→ 在本页彻底删除。

### 持久化 bash 卡顿卫士（v0.12 新增）

dsh 的**持久化** `bash` 工具（minimal 预设及任何挂载它的 preset 使用）在每次
发送命令前通过 PTY 就绪协议等一个 prompt 标记：健康时几十 ms 即返回，但一旦
会话内有人覆盖了 `PROMPT_COMMAND`（`.bashrc`、starship/direnv/conda 或显式
赋值都可能），标记不再发出，**每次** `bash` 调用都静默退化为 ~3s 沉默档——
工具只在超时/退出时重置，所以这个退化对当前会话是**永久**的。本插件宿主在
`tools/execute` waterfall 上量每次 `bash` 调用的墙钟耗时，检测到退化后自动恢复：

- **检测**：同一 owner（agent）持有活动 PTY 会话、且连续 3 次 `bash` 调用
  每次 ≥ 2800ms → 判定沉默档退化（健康调用几十 ms，退化调用必达 ~3s）
- **动作**：调用 `terminals.kill` 重置该 owner 的**所有**会话，下一次 `bash`
  调用从干净 shell 重新开始，快路径恢复
- **冷却**：每个 owner 两次重置之间至少隔 60s，病态循环不会反复杀 shell；
  kill 本身有 2s 上限，绝不拖住工具调用
- **作用域**：`terminals` 服务按 preset 隔离，只有挂载持久终端的 preset
  （minimal）能读到；一次性 `bash` 工具（cordis/standard 预设）无终端，跳过
- **已知代价**：重置后下一次 `bash` 调用先报一次错（工具缓存了已死会话 id），
  随后从新 shell 恢复。属"止痛"：把"永久每次 +3s"变成"最多影响几次 + 一次报错"。
  根治（工具级解耦，见 [docs/dsh-bash-tool-stall-report.md](docs/dsh-bash-tool-stall-report.md)
  §9 方案 A）仍在 dsh 上游或本地 patch 层面

生效方式：改动在 host half，需**重启 `dsh web`**。

## 安装

在 dsh 的 profile 里把它装成 bundle（`@deepseek-ai/dsh-web-app` 对应的 profile）。
以默认 `web` profile 为例，编辑 `~/.dsh/profiles/web/package.json`：

```json
"dependencies": { "@blueriverlhr/dsh-better-webui": "<指向本仓库的路径，或 git/npm 依赖>" },
"dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@blueriverlhr/dsh-better-webui"] } }
```

改完 `dsh web` 重启后生效（宿主 half 为启动时加载，client bundle 走 stat-poll
热加载）。

## 开发

```sh
pnpm run build          # 产出 lib/index.js + lib/web-search-exa.js (host) + lib/client.js (browser)
node tests/smoke.mjs    # 客户端 jsdom 集成测试（真实 React 18.3.1 + 真实点击）
node tests/host.mjs     # 宿主 half 集成测试（真实临时目录 + 模拟注册表，验证彻底删除无残留）
node tests/reasoning.mjs # 宿主 half 推理等级补齐测试（模拟 settings 服务，验证幂等补齐/不覆盖/监听）
node tests/web-search-exa.mjs # 免密钥 Exa 搜索 provider 测试（模拟 ctx.web + fetch，验证匿名 MCP/REST/429/abort）
node tests/stall-guard.mjs # 持久化 bash 卡顿卫士测试（纯决策逻辑 + tools/execute 接线，验证重置/冷却/永不拖住调用）
node tests/splitter.mjs # 思考标签切分测试（验证切分/空块清除合并/协议安全）
```

- 改 client half → 刷新浏览器即可（webserver stat-poll 自动热加载）
- 改 host half → 重启 `dsh web`

完整机制说明见 [docs/dev-notes.md](docs/dev-notes.md)；设计裁决记录见 [docs/design.md](docs/design.md)。

