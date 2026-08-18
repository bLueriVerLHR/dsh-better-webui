# better-webui

DeepSeek Harness Web GUI 插件：**真正的两步会话删除（归档联动）** + **提示词撤回重写（fork 桥接）** + **归档会话管理**。

## 功能

### 会话删除（回收站）
- 会话标题栏垃圾桶图标：第一次点击 → ✓/✗ 确认对（4 秒自动复位）
- 确认后：停止运行 → **原生归档（侧栏立即消失）** → 会话目录搬入宿主回收站 → 切到新会话 → 带撤销 toast
- 撤销/恢复 = 目录搬回 + **反归档（直接回侧栏分组，不再是"恢复后仍归档"）**

### 提示词撤回（每条用户消息行，复制按钮旁）
- 编辑图标 → 两步确认 → 从该提示词**上一回合结束处** fork 子会话并自动切换，输入框预填原文，源会话自动归档（可回看）
- 运行中先自动取消；首条消息不可撤回（按钮禁用）
- 语义：此前对话保留、模型上下文不含被撤回的提示词；视觉像就地重写，后台是子会话

### 侧栏底部（Settings 上方）两个安静图标
- **回收站**：数量徽标、弹出列表（标题 + 工作区 + 相对时间），每项 ↺恢复 / 🗑两步确认后永久删除
- **归档**：列出原生归档的会话，标题用 `displayTitle`（修复"全显示无标题"）；每行 ↺**恢复回侧栏**（反归档）/ 🗑移入回收站；会话已不存在的死行置灰标注，弹层底部「清除失效记录」两步确认后把死 id 从注册表归档集清除

不覆盖任何原生 UI：原生复制/分支图标、bash 工具卡、会话树全部保持原样。

## 前置条件：user-actions 插槽

用户消息行原无插件插槽，需要 harness 侧提供 `conversation.chat.user-actions`（源码补丁已落在
`deepseek-harness/packages/client/ui-conversation`，见 docs/dev-notes.md §11）。对已部署的全局安装 dsh：

```sh
node scripts/patch-ui-conversation.mjs   # 幂等；每次升级 dsh 后重跑
```

## 安装（已装好）

`~/.dsh/profiles/web/package.json`：

```json
"dependencies": { "@better-webui/better-webui": "link:/home/archie/forge/better-webui" },
"dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@better-webui/better-webui"] } }
```

## 开发

```sh
pnpm run build          # 产出 lib/index.js (host) + lib/client.js (browser)
node tests/smoke.mjs    # jsdom 集成测试（真实 React 18.3.1 + 真实点击，36 项断言）
```

- 改 client half → 刷新浏览器即可（webserver stat-poll 自动热加载）
- 改 host half → 重启 `dsh web`

完整机制说明见 [docs/dev-notes.md](docs/dev-notes.md)；设计裁决记录见 [docs/design.md](docs/design.md)。
