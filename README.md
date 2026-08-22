# @blueriverlhr/dsh-better-webui

DeepSeek Harness Web GUI 增强插件 —— **monorepo 元包**：一个"大包"聚合七个解耦的功能小包。
**安装这个包 = 七个功能全部挂上**；每个功能也都可以单独安装（见 [按需安装](#按需安装)）。

功能清单：

| 功能 | 小包 | half |
|---|---|---|
| **归档会话管理**（查看 · 恢复 · 二次确认彻底删除） | `@blueriverlhr/dsh-better-webui-archive` | host + client |
| **自定义模型推理等级自动补齐**（让自定义模型像预制模型一样能用原生「推理等级」菜单） | `@blueriverlhr/dsh-better-webui-reasoning` | host |
| **会话活动提示音**（agent 等待输入 / 完成任务 / 回合失败时播放提示音） | `@blueriverlhr/dsh-better-webui-chime` | client |
| **免密钥 Exa 网络搜索**（无 API key 也能用原生 `web_search`） | `@blueriverlhr/dsh-better-webui-search` | host |
| **持久化 bash 卡顿卫士**（minimal 预设的持久终端退化为 ~3s 沉默档后自动重置 shell） | `@blueriverlhr/dsh-better-webui-bashguard` | host |
| **可配置重试策略 + 专属设置页**（调大重试次数/退避；better-webui 偏好页 + 独立重试策略页，含提示音音量） | `@blueriverlhr/dsh-better-webui-settings` | host + client |
| **模型采样参数控制**（输入区温度输入框，全局默认温度，新会话生效、会话内固定；logprobs/penalty 标注暂不支持） | `@blueriverlhr/dsh-better-webui-modelparams` | host + client |

> 拆分动机与架构（设计模式、风险隔离、维护性）见 [docs/monorepo.md](docs/monorepo.md)。

---

## 功能

### 免密钥 Exa 网络搜索（search）

注册一个 `ctx.web` 搜索 provider（id `exa`），让 dsh 原生的 `web_search` 工具
**在没有 API key 的情况下也能真搜索**，无需任何配置：

- **匿名 MCP**（默认）：走 Exa 官方匿名托管 MCP（`mcp.exa.ai/mcp`，JSON-RPC
  `tools/call`，无凭据、有限流），结果归一化成 `web_search` 的源列表
- **REST 升级**（可选）：设置了 `EXA_API_KEY`（环境变量）后自动切到 Exa
  `POST /search`（`Bearer` 认证，限额更高），无需重启
- 行为与原生搜索一致：来源 URL / 标题 / snippet / 日期、`web_search` 结果卡片，
  都由 dsh 自带工具层处理，本包只补 provider

> 注：匿名路径是 Exa 的公共限流服务，429 时工具会提示配置 `EXA_API_KEY` 升级。
> 源码移植自 [@tonydua/dsh-web-search-exa](https://github.com/TonyDua/dsh-web-search-exa)
> （MIT，版权与许可全文见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)），
> 策略沿用 oh-my-pi 的「有 key 走 REST、无 key 走匿名 MCP」。

生效方式：search 包的 patch 用非 insert 覆盖把 `web` 行的 `searchProvider`
指向 `exa`（`deepseek-official` 缺 key 时不可用，所以切到本 provider）；
改 host half 后**重启 `dsh web`**。

### 会话活动提示音（chime）

当前打开的会话里，agent **开始等待用户输入**、**完成一个回合**或**回合失败**时，
播放一段合成的提示音（**只响铃、不弹窗**）：

- **等待输入**：`ask_user_question` 提问 / 等待审批 / 方案评审时，播放下降双音
- **任务完成**：agent 由运行转为空闲、无待处理交互且正常产出答复时，播放上升三音
- **回合失败**：模型重试耗尽 / 硬错误 / 输出上限截断导致回合终止时，播放低沉双音
  （与完成音区分，绝不把失败报成完成）
- 用户手动**停止**的回合不提醒

**设置**（v0.19 起在「设置 → better-webui」页，已从通用设置移入）：会话提示音
卡内**两行功能项**——「启动」（开关，启用/停用提示音）与「调整音量」（滑杆
0-100，0 为静音），描述文本放在卡片大项下。音量滑块**拖动中不响、松手时才试听
一次**。开关和音量存 **localStorage**（纯客户端，不改宿主、不写
`settings.yaml`），所以**无需重启**，刷新页面即可生效。老用户的设置（键
`better-webui:notify:enabled` / `:volume`）迁移后不丢。

实现要点：

- 检测订阅输入区 `conversation.input.dock` 的 ConversationSnapshot（`pending` /
  `running` 状态跳变），只在跳变时触发，不随每次渲染重复响
- 回合结束时按**结尾节点类型**（`assistant` / `turn-error` / `turn-max-tokens` /
  `interrupted`）路由到完成音 / 错误音 / 静音——模型重试期间的 `running` 保持 true
  不会误响，重试耗尽失败只响错误音
- 声音用 **Web Audio API 合成**（正弦振荡，无音频文件、无需构建资源）；在首次
  用户交互时解锁音频上下文，规避浏览器自动播放策略
- 不覆盖任何原生 UI

> 注：**模型采样超参数（temperature / top_p / 惩罚系数 / logprobs）控制为暂缓
> 需求**（v0.20 调研后用户裁决暂不做，未来继续）。完整可行性调查见
> [docs/design.md](docs/design.md) §11：temperature（+maxTokens）可通过官方
> `agent/request` 钩子干净注入、零 dsh 源码修改；top_p / 惩罚系数 / logprobs 在
> 整条链路（harness 词汇表 + pi-ai schema + 两个 adapter + 三种 wire 构造器）均
> 无字段——唯一出路 pi-ai 的 `samplingParams` 透传（上游 0.84 已实现）需等
> dsh-llm-pi-ai 升级采用。现成插件 `dsh-sampling-sliders`（GitHub，MIT）用同一
> 机制但**仅全局唯一值、无 per-provider/model、UI 在输入栏**，不满足本需求。

### 归档会话管理（archive）

设置面板左侧导航里的**归档会话**页（紧跟「Agent 预设」页下方）。原生 UI 只能把
会话归档（隐藏），没有查看/恢复/删除入口——这个页面补齐它。做成独立设置页而非
侧栏图标/通用页行，是为了不占用侧栏底部，避免被动态插件面板挤掉：

- **查看**：列出所有归档会话（标题用 `displayTitle`，工作区 + 相对时间）
- **恢复**（↺）：把归档会话带回侧栏（移出归档集）
- **彻底删除**（🗑，两步确认）：真正删干净——会话目录、注册表归档集、
  工作区记账槽全部清除，无任何残留。
  唯一例外：**本进程打开过的"活"会话**（dsh 无公开 API 丢弃宿主内存里的
  活会话）删除后仍保留在归档集里**隐藏**（不回未分组），页面里以
  "会话已删 · 重启后清除"的死行呈现，重启后启动清扫自动清掉
- **失效记录**：会话已不存在的死行置灰标注；页脚「清除失效记录」
  （两步确认）把死 id 从归档集与记账槽中清掉。宿主启动时也会自动清扫一次

### 自定义模型推理等级（reasoning）

DSH 的「推理等级」菜单只对带推理元数据的模型出现；手写进 `llm-pi-ai`
provider 的自定义模型（只有 id/name/容量）适配器判定为不推理，
composer 菜单缺失，无法在会话里切换思考等级。本包宿主在启动时
（以及 `settings.yaml` 每次变更后）**幂等**地为所有未声明推理能力的自定义
模型补上**全档位** `reasoningEfforts: { off: null, minimal: minimal,
low: low, medium: medium, high: high, xhigh: xhigh, max: max }`，
写回同一个 `llm-pi-ai` 命名空间（持久化到 `settings.yaml`，热加载），
原生 composer 的「推理等级」菜单随即对自定义模型生效，行为与预制模型一致。

- **全档位**：off / minimal / low / medium / high / xhigh / max，覆盖 pi-ai
  原生支持的全部思考等级；wire 值按声明透传给后端（DeepSeek 官方认
  `low/high/max`，OpenAI 系认 `xhigh`——按你的网关后端自选档位）
- **旧档位自动升级**：模型声明若恰好等于旧的四档默认
  （`off/low/medium/high`，即本包此前补上的），重启后自动升级为全档位，
  无需手改文件；手写/自定义的 dict 从不被改动
- **不改 UI、不改 dsh 本体**：菜单是原生的，包只补配置元数据
- **不覆盖已有声明**：已写 `reasoningEfforts`（自定义 dict 或 `false`）的模型从不被改动
- **退出自由**：某个不支持推理的模型，在 `settings.yaml` 里给它
  `reasoningEfforts: false` 即可恢复无菜单状态
- **事件驱动、无需等待**：补齐由 `llm/adapters-updated`（pi-ai 适配器注册/更新
  的瞬间）与 `settings/document-updated`（settings.yaml 热重载）两个事件触发，
  无定时器、无轮询——重启后 `llm-pi-ai` 一生效就补齐
- **幂等持久化**：补齐写回 `settings.yaml`，下次开机已全档则不再写入、不干扰，
  无需每次手动调整
- 生效路径：宿主改动 → **重启 `dsh web`**（宿主侧启动时加载）

不覆盖任何原生 UI；不修改 dsh 本体（升级 dsh 不受影响）。

删除未归档会话的推荐流程：原生会话行菜单 →「归档会话」→ 在本页彻底删除。

### 持久化 bash 卡顿卫士（bashguard）

dsh 的**持久化** `bash` 工具（minimal 预设及任何挂载它的 preset 使用）在每次
发送命令前通过 PTY 就绪协议等一个 prompt 标记：健康时几十 ms 即返回，但一旦
会话内有人覆盖了 `PROMPT_COMMAND`（`.bashrc`、starship/direnv/conda 或显式
赋值都可能），标记不再发出，**每次** `bash` 调用都静默退化为 ~3s 沉默档——
工具只在超时/退出时重置，所以这个退化对当前会话是**永久**的。本包宿主在
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

### 可配置重试策略 + 专属设置页（settings）

设置面板里**两个** better-webui 专属页（v0.20 起拆分）：**better-webui** 页
（「Agent 预设」与「重试策略」之间，含提示音音量）与**重试策略**页（紧跟
better-webui 页，含重试卡），集中管理 better-webui 的功能偏好，不混入 dsh
自身设置分区。

**重试策略**——DSH 原生模型请求重试默认 `maxRetries: 2` 且没有可调的入口
（`dsh-llm-retry` 按 provider 读 `llm-pi-ai.providers.*.retryPolicy`）。独立
「重试策略」页提供**全局默认策略**：重试次数 + 初始延迟 + 最大延迟 + 抖动比例，
点「应用」后由宿主通过 `settings` 服务幂等地写入**每个未自行声明 `retryPolicy`
的 provider**：

- **不覆盖手写**：某个 provider 若已声明自己的 `retryPolicy`（与插件上次写入的
  `lastApplied` 标记不同），页面上标为「手写配置（不覆盖）」并跳过；想单独设的
  provider 手写 `settings.yaml` 即可
- **DSH 原生执行**：写入的是 DSH 自己的 `retryPolicy` 形状（`mode: normal` +
  `backoff`），由 `dsh-llm-retry` 原样执行；改 `settings.yaml` 即**热加载**
  （pi-ai 适配器实时读 `retryPolicy`），**无需重启**
- **持久化**：策略与 `lastApplied` 标记存在 `better-webui.retry` 设置命名空间
  （settings.yaml 里 `better-webui:` 一节），重启后依然生效；「恢复默认」一键回到
  DSH 原生默认（2 次 / 500ms / 10s / 0.1）
- **Provider 状态**：页面列出每个 provider 当前是「未配置（将应用全局默认）」「已应用
  全局策略」「沿用上次应用的策略」还是「手写配置（不覆盖）」

**会话提示音**——better-webui 页里保留提示音卡：「启动」开关 + 「调整音量」
滑杆（0-100，0 静音），描述在卡片大项下。纯客户端 localStorage（键
`better-webui:notify:enabled` / `:volume` 不变，老用户设置不丢），chime 包的
播放逻辑继续读这两个键，无需重启。中英文双语。

生效方式：宿主改动（RPC 通道 + 设置命名空间）→ **重启 `dsh web`**；客户端页面
改动刷新浏览器即可。

### 模型采样参数控制（modelparams）

输入区（composer 工具行、发送键前）的**「超参配置」图标按钮**（滑杆/调谐图标，
hover/无障碍名称为「超参配置」），点击弹出面板配置
**全局默认温度**。语义：**每个新会话取默认值，会话内固定**。

- **temperature**：可用。**数值留空 = 系统默认（placeholder 直接显示具体默认值
  ，如 1.0），填写 = 覆盖**；数值框隐藏上下箭头、仅输入数字。经官方
  `agent/request` 钩子注入（新会话首请求解析后按会话钉住并保持固定；
  `agent/disposed` 清理会话态）。零 dsh 源码修改。
- **logprobs / penalty**：面板中显示「**暂不支持**」——harness 词汇表与两个
  adapter 均无这些字段，唯一出路是 pi-ai 0.84 的 `samplingParams` 透传（等
  dsh-llm-pi-ai 升级采用，详见 [docs/design.md](docs/design.md) §11）。
- **恢复默认**：**清空已保存的覆盖配置**（温度回到留空/系统默认 1.0）。
- **生效方式**：持久化（写入 settings.yaml，重启仍在）或热调（本次运行生效，
  开机清除残留）。
- **双语**：zh / en 两套文案。
- 宿主改动（RPC + 设置命名空间）→ **重启 `dsh web`**；客户端改动刷新浏览器即可。

---

## 安装

本仓库是 monorepo：根目录是**元包** `@blueriverlhr/dsh-better-webui`（无自身代码，
只聚合），`packages/<feature>/` 是六个功能小包。元包的 `dependencies` 指向小包，
patch 挂载全部六行。

### 整包安装（推荐）

在 dsh 的 profile 里把**元包**装成 bundle（`@deepseek-ai/dsh-web-app` 对应的
profile）。以默认 `web` profile 为例，编辑 `~/.dsh/profiles/web/package.json`：

```json
"dependencies": { "@blueriverlhr/dsh-better-webui": "<指向本仓库的路径，或 git/npm 依赖>" },
"dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@blueriverlhr/dsh-better-webui"] } }
```

> **本地开发务必用 `file:` 而不是 `link:`**：pnpm 对 `link:` 依赖只做软链、**不安装
> 其传递依赖**，而 `file:` 会安装元包声明的七个（小）包并把它们平铺进
> `profiles/<name>/node_modules`（Loader 与 client-modules registry 都从 profile
> baseUrl 解析行名）。发布到 npm 后改回版本号依赖即可，pnpm 会自动拉齐小包。
> 改完在 profile 目录 `pnpm install`（如无 TTY 加 `CI=true --no-frozen-lockfile`），
> 再 `dsh web` 重启生效。

### 按需安装（只装部分功能）

元包装齐所有功能；若只想装一部分，把对应小包直接加进 `dsh.profile.bundles`，
并把它们的依赖（或 `file:` 路径）写进 profile 的 `dependencies`：

```json
"dependencies": {
  "@blueriverlhr/dsh-better-webui-chime": "file:/path/to/this/repo/packages/chime",
  "@blueriverlhr/dsh-better-webui-archive": "file:/path/to/this/repo/packages/archive"
},
"dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@blueriverlhr/dsh-better-webui-chime", "@blueriverlhr/dsh-better-webui-archive"] } }
```

> **不要同时安装元包和某个小包**：元包的聚合 patch 与单个小包的 patch 会插入
> 同一个行 id，导致同一插件被挂载两次（通道/插槽重复注册冲突）。装元包或装
> 小包，二选一。元包的 `cordis.patch.yml` 是 `npm run build` 生成的聚合产物，
> 源在各小包的 `cordis.patch.js`。

### 生效方式

- 宿主 half（小包的 host 侧改动）→ **重启 `dsh web`**
- client bundle 改动 → 刷新浏览器即可（webserver stat-poll 热加载）

---

## 开发

```sh
npm run build   # 构建全部 6 个小包的 lib/ + 重新生成全部 cordis.patch.yml
npm test        # 构建 + 运行全部测试（见下）
```

测试（每个都是独立 node 脚本，`tests/run-all.mjs` 依次执行）：

| 测试 | 覆盖 |
|---|---|
| `packages/archive/tests/host.mjs` | 归档宿主：真实临时目录 + 模拟注册表，验证彻底删除无残留 |
| `packages/archive/tests/smoke.mjs` | 归档客户端：jsdom 集成测试（真实 React 18.3.1 + 真实点击） |
| `packages/reasoning/tests/reasoning.mjs` | 推理等级补齐（模拟 settings 服务，验证幂等补齐/不覆盖/监听） |
| `packages/chime/tests/smoke.mjs` | 提示音客户端：dock 跳变触发 + localStorage 读取 |
| `packages/search/tests/web-search-exa.mjs` | 免密钥 Exa 搜索 provider（匿名 MCP/REST/429/abort） |
| `packages/bashguard/tests/stall-guard.mjs` | 卡顿卫士（纯决策逻辑 + tools/execute 接线） |
| `packages/settings/tests/host.mjs` | 重试策略宿主：规划/应用/幂等/不覆盖手写 |
| `packages/settings/tests/smoke.mjs` | better-webui 设置页：重试卡 + 提示音卡 + RPC/localStorage |
| `packages/modelparams/tests/host.mjs` | 采样参数宿主：RPC/apply/reset + agent/request 会话级固定 + hot 清除 |
| `packages/modelparams/tests/smoke.mjs` | 采样参数客户端：输入框（非滑杆）+ 面板 + 暂不支持标注 + RPC/双语 |
| `tests/composition.mjs` | patch 组合守卫：提交的 cordis.patch.yml 与各包源一致 |
| `tests/client-envelope.mjs` | 每个 client 包的加载信封 + 插槽注册（参数化） |

- 改某个小包的 client half → 刷新浏览器即可；改 host half → 重启 `dsh web`
- **新功能尽量以子模块（独立小包）形式添加**：新建 `packages/<name>/`（package.json +
  src + cordis.patch.js + tests），在 `scripts/compose-patch.mjs` 的 `FEATURES` 加名字，
  然后 `npm run build`。不要把新功能塞进现有小包的 `apply()`。详见
  [docs/monorepo.md](docs/monorepo.md) §7 维护规则。
- 提交前跑 `npm test`；`cordis.patch.yml` 由构建生成，不要手改（会触发组合测试失败）

完整机制说明见 [docs/dev-notes.md](docs/dev-notes.md)；设计裁决记录见
[docs/design.md](docs/design.md)；本次拆分架构与设计模式见
[docs/monorepo.md](docs/monorepo.md)。
