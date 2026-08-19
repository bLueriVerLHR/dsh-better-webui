# better-webui

DeepSeek Harness Web GUI 插件：**归档会话管理**（查看 · 恢复 · 二次确认彻底删除）。

## 功能

侧栏底部（Settings 上方）一枚安静的归档图标，数量徽标。原生 UI 只能把会话归档
（隐藏），没有查看/恢复/删除入口——这个弹层补齐它：

- **查看**：列出所有归档会话（标题用 `displayTitle`，工作区 + 相对时间）；
  曾被旧版"回收站"搬走目录的会话也在这里，同样可恢复/删除
- **恢复**（↺）：把归档会话带回侧栏（移出归档集；遗留目录同时搬回原位）
- **彻底删除**（🗑，两步确认）：真正删干净——会话目录、回收站残留副本、
  trash 记录、注册表归档集、工作区记账槽全部清除，无任何残留
- **失效记录**：会话已不存在的死行置灰标注；弹层底部「清除失效记录」
  （两步确认）把死 id 从归档集与记账槽中清掉。宿主启动时也会自动清扫一次

不覆盖任何原生 UI；不修改 dsh 本体（升级 dsh 不受影响）。

删除未归档会话的推荐流程：原生会话行菜单 →「归档会话」→ 在本弹层彻底删除。

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
```

- 改 client half → 刷新浏览器即可（webserver stat-poll 自动热加载）
- 改 host half → 重启 `dsh web`

完整机制说明见 [docs/dev-notes.md](docs/dev-notes.md)；设计裁决记录见 [docs/design.md](docs/design.md)。
