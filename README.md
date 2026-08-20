# better-webui

DeepSeek Harness Web GUI 插件：**归档会话管理**（查看 · 恢复 · 二次确认彻底删除）+
**自定义模型推理等级自动补齐**（让自定义模型像预制模型一样能用原生「推理等级」菜单）+
**会话活动提示音**（agent 等待输入 / 完成任务时播放提示音）。

## 功能

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

## 安装（已装好）

`~/.dsh/profiles/web/package.json`：

```json
"dependencies": { "@better-webui/better-webui": "link:/home/archie/forge/better-webui" },
"dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@better-webui/better-webui"] } }
```

## 开发

```sh
pnpm run build          # 产出 lib/index.js (host) + lib/client.js (browser)
node tests/smoke.mjs    # 客户端 jsdom 集成测试（真实 React 18.3.1 + 真实点击）
node tests/host.mjs     # 宿主 half 集成测试（真实临时目录 + 模拟注册表，验证彻底删除无残留）
node tests/reasoning.mjs # 宿主 half 推理等级补齐测试（模拟 settings 服务，验证幂等补齐/不覆盖/监听）
```

- 改 client half → 刷新浏览器即可（webserver stat-poll 自动热加载）
- 改 host half → 重启 `dsh web`

完整机制说明见 [docs/dev-notes.md](docs/dev-notes.md)；设计裁决记录见 [docs/design.md](docs/design.md)。
