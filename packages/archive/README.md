# @blueriverlhr/dsh-better-webui-archive

归档会话管理（host + client）：注册 RPC 通道 `/better-webui`（ping / listArchive /
restore / destroy / purge）与「设置 → 归档会话」页（紧跟「Agent 预设」页下方），
补齐原生 UI 缺失的查看 / 恢复 / 二次确认彻底删除 / 清除失效记录。宿主启动时自动
清扫死引用。

做成独立设置页而非侧栏图标/通用页行，是为了不占用侧栏底部，避免被动态插件面板挤掉。

- **查看**：列出所有归档会话（标题用 `displayTitle`，工作区 + 相对时间）
- **恢复**（↺）：把归档会话带回侧栏（移出归档集）
- **彻底删除**（🗑，两步确认）：真正删干净——会话目录、注册表归档集、工作区记账槽
  全部清除，无任何残留。唯一例外：**本进程打开过的"活"会话**（dsh 无公开 API 丢弃
  宿主内存里的活会话）删除后仍保留在归档集里**隐藏**（不回未分组），页面里以
  "会话已删 · 重启后清除"的死行呈现，重启后启动清扫自动清掉
- **失效记录**：会话已不存在的死行置灰标注；页脚「清除失效记录」（两步确认）把死 id
  从归档集与记账槽中清掉

删除未归档会话的推荐流程：原生会话行菜单 →「归档会话」→ 在本页彻底删除。

- 服务依赖（硬）：`connection`、`sessionPersistence`、`workspaceRegistry`
- 服务依赖（可选）：`sessions`、`agents`
- wire 版本：`WIRE_VERSION = 3`（host）与 `WIRE = 3`（client）必须一致

独立安装：把 `@blueriverlhr/dsh-better-webui-archive` 加进 `dsh.profile.bundles`
并声明依赖（见根 README「按需安装」）。更常见的做法是装根元包一起带上。
