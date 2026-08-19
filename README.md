# better-webui

DeepSeek Harness Web GUI 插件：**归档会话管理**（查看 · 恢复 · 二次确认彻底删除）+
**自定义模型推理等级自动补齐**（让自定义模型像预制模型一样能用原生「推理等级」菜单）。

## 功能

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
