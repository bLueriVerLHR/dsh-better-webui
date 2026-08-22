# @blueriverlhr/dsh-better-webui-archive

归档会话管理（host + client）：注册 RPC 通道 `/better-webui`（ping / listArchive /
restore / destroy / purge）与「设置 → 归档会话」页，补齐原生 UI 缺失的
查看 / 恢复 / 二次确认彻底删除 / 清除失效记录。宿主启动时自动清扫死引用。

- 服务依赖（硬）：`connection`、`sessionPersistence`、`workspaceRegistry`
- 服务依赖（可选）：`sessions`、`agents`
- wire 版本：`WIRE_VERSION = 3`（host）与 `WIRE = 3`（client）必须一致

独立安装：把 `@blueriverlhr/dsh-better-webui-archive` 加进 `dsh.profile.bundles`
并声明依赖（见根 README「按需安装」）。更常见的做法是装根元包一起带上。
