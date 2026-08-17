# better-webui — dsh Web GUI 体验增强插件（实施计划 v1）

> 独立 repo、不修改 deepseek-harness 源码、以 out-of-tree bundle 插件形式挂载。
> 目标 profile：`web`；安装方式：`dsh plugin --profile web add <better-webui 产物>`。

## 已确认的决策（来自讨论）
1. 不直接修改 deepseek-harness 源码；新 repo `better-webui` 以插件/bundle 形式加入。
1a. 彻底删除需要第二重确认弹窗。
1b. 分支树默认折叠，展开状态仅存浏览器本地偏好（不要求宿主持久化）。
1c. 输出截断阈值可配置；默认 200KB / 10k 行。
2. 通过 `dsh plugin --profile web add` 安装；插件热加载（HMR）。
3. 软删除后客户端只看得到标题，看不到内容；状态持久化在宿主侧。
4. 第二次删除 = 宿主侧真实删除 session 内容。
5. 工具输出（尤其 bash）在 UI 中默认折叠，但必须能展开查看。
6. 树形侧栏（分支关系）需持久化，重启后恢复。
7. 独立 git 仓库，不含 harness 内部代码改动。

## 仓库结构
```
better-webui/
  package.json            # npm 包，声明 dsh.bundle.patch 与 dsh.client
  cordis.patch.yml        # 向 web profile 插入 host/client 插件行
  tsconfig.json
  src/
    host/                 # 宿主侧逻辑（RPC、软删除/分支持久化）
    client/               # 浏览器侧 UI（侧栏、工具输出、分支入口）
  docs/plan.md
  README.md
  tests/
```

## 插件加载机制（依据源码）
- dsh 的 bundle 是 npm 包，`package.json` 里 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`；
  用 `dsh plugin --profile web add <path-or-tarball>` 装入 profile（见 `packages/boot/app-boot/src/profile.ts`）。
- Cordis 的 slot 是覆盖点：`single` 槽位注册到更小 priority 可 shadow 原实现
  （见 `packages/client/ui-slots/src/store.ts` 的 shadowing 语义）。因此我们可：
  - 覆盖 `sidebar.workspaces`（会话列表/树）
  - 覆盖/增强工具输出渲染（新增 `tool.*` 展示槽或注册 keyed 渲染）
- Host 侧 RPC：Typert remote 支持 `ctx.remote.$mount({package, descriptors})`
  （见 `packages/api/remotes/tests`），插件可在宿主侧挂自己的 RPC namespace，无需改 harness 源码。

## 功能一：两步删除 + 置灰排序
### 数据/宿主
- 新增 host 插件：
  - `sessions.trash(sessionId)`：首次删除 → 写 `trash` 标记到宿主会话目录（如 `session.trash.json`/SQLite 标记）。
  - `sessions.restore(sessionId)`：清除标记。
  - `sessions.destroy(sessionId)`：第二次删除 → 真实删除会话文件。
- `sessions.list` 返回的 `SessionSummary` 增加 `trashed?: boolean`（列表投影）。
- 排序：活跃在前，已删除在后并保持原始相对顺序。

### 客户端 UI
- 覆盖 `sidebar.workspaces` 的 WorkspaceBrowser：
  - 行内增加「删除」→ 两步确认；首个状态置灰、可打开、只能看标题；
  - 置灰行 hover 提供「恢复 / 彻底删除」。
- 会话列表数据来自 `ctx.sessions` runtime；`flattenLineage` 保持原顺序。

## 功能二：工具输出可展开查看
- 复用会话日志已有 `tool.result` / `content` 字段（已确认存在）。
- 在 Tool 卡片上增加 `<details>`（默认收起，摘要「输出」）。
- 首次点击展开完整输出；超大输出截断（可配置阈值：200KB / 10k 行）。
- 提供「复制」与「新标签页打开完整输出」。
- 纯 UI 层：新增/覆盖 `ui-tool` 的 keyed tool 渲染槽，不改 host。

## 功能三：从任意用户消息处分叉（分支树）
### 宿主
- host namespace `sessions.branch(sessionId, atSeq)`：
  - 把 `[0, atSeq]` 的前缀日志复制到新 session；
  - 新 session 记录 `parentSessionId`（复用现有字段）+ `branchPointSeq`；
  - 持久化到宿主侧目录（保证重启后树形侧栏可恢复）。
### 客户端
- 用户消息卡片「从此处分支」：
  - 新建会话，第一条消息为可编辑用户消息（预填原文，发送时上下文 = 复制来的前缀 + 新消息）。
- 侧栏树视图：
  - 用 `flattenLineage`/父子关系渲染为可展开树；
  - 树结构持久化数据来自宿主 `parentSessionId`；
  - 节点显示分支点缩略、分叉图标。

## 验证
- 每个功能一个 PR/里程碑；跑 `pnpm run dev:web` 热更新实测。
- 统一跑 `pnpm run test:web`，最后 `pnpm run build`。
- 宿主侧加单测（trash/restore/destroy、branch 持久化、重启恢复）。

## 里程碑
1. M1：仓库骨架 + 安装脚本 + 空 bundle 可被 `dsh plugin --profile web add` 加载
2. M2：功能一（两步删除 + 置灰排序）
3. M3：功能二（工具输出可展开）
4. M4：功能三（分支树 + 持久化）
5. M5：整体验证与文档

## 待确认的次要细节
- 软删除的「恢复」入口放在置灰行 hover；彻底删除是否需要二次确认（建议：是）。
- 分支树是否默认全部展开（建议：折叠，展开保存为 UI 本地偏好即可，不要求宿主持久化）。
- 截断阈值默认值是否 200KB / 10k 行。
