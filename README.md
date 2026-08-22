# @blueriverlhr/dsh-better-webui

DeepSeek Harness Web GUI 增强插件 —— **monorepo 元包**：一个"大包"聚合多个解耦的
功能小包。**安装这个包 = 全部功能挂上**；每个功能也都可以单独安装
（见 [按需安装](#按需安装)）。

## 组件索引

| 功能 | 目录 · README | 包 | half |
|---|---|---|---|
| 归档会话管理（查看 / 恢复 / 二次确认彻底删除） | [`packages/archive`](packages/archive/README.md) | `@blueriverlhr/dsh-better-webui-archive` | host + client |
| 自定义模型推理等级自动补齐 | [`packages/reasoning`](packages/reasoning/README.md) | `@blueriverlhr/dsh-better-webui-reasoning` | host |
| 会话活动提示音 | [`packages/chime`](packages/chime/README.md) | `@blueriverlhr/dsh-better-webui-chime` | client |
| 免密钥 Exa 网络搜索 | [`packages/search`](packages/search/README.md) | `@blueriverlhr/dsh-better-webui-search` | host |
| 持久化 bash 卡顿卫士 | [`packages/bashguard`](packages/bashguard/README.md) | `@blueriverlhr/dsh-better-webui-bashguard` | host |
| 可配置重试策略 + 专属设置页 | [`packages/retry`](packages/retry/README.md) | `@blueriverlhr/dsh-better-webui-retry` | host + client |
| better-webui 专属设置页 | [`packages/settings`](packages/settings/README.md) | `@blueriverlhr/dsh-better-webui-settings` | client |
| 模型采样参数控制 | [`packages/modelparams`](packages/modelparams/README.md) | `@blueriverlhr/dsh-better-webui-modelparams` | host + client |

> 本 README 只是索引；每个功能小包的详细说明（功能细节、实现要点、生效方式）见其
> 目录下的 `README.md`。拆分动机与架构见 [docs/monorepo.md](docs/monorepo.md)；
> 设计裁决记录见 [docs/design.md](docs/design.md)；开发笔记见
> [docs/dev-notes.md](docs/dev-notes.md)。

---

## 安装

本仓库是 monorepo：根目录是**元包** `@blueriverlhr/dsh-better-webui`（无自身代码，
只聚合），`packages/<feature>/` 是各功能小包。元包的 `dependencies` 指向小包，
patch 挂载全部功能行。

### 整包安装（推荐）

在 dsh 的 profile 里把**元包**装成 bundle（`@deepseek-ai/dsh-web-app` 对应的
profile）。以默认 `web` profile 为例，编辑 `~/.dsh/profiles/web/package.json`：

```json
"dependencies": { "@blueriverlhr/dsh-better-webui": "<指向本仓库的路径，或 git/npm 依赖>" },
"dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@blueriverlhr/dsh-better-webui"] } }
```

> **本地开发务必用 `file:` 而不是 `link:`**：pnpm 对 `link:` 依赖只做软链、**不安装
> 其传递依赖**，而 `file:` 会安装元包声明的各（小）包并把它们平铺进
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
npm run build   # 构建全部小包的 lib/ + 重新生成全部 cordis.patch.yml
npm test        # 构建 + 运行全部测试（见下）
```

测试（每个都是独立 node 脚本，`tests/run-all.mjs` 依次执行；各小包的测试见
`packages/<feature>/tests/`）：

| 测试 | 覆盖 |
|---|---|
| `packages/archive/tests/host.mjs` | 归档宿主：真实临时目录 + 模拟注册表，验证彻底删除无残留 |
| `packages/archive/tests/smoke.mjs` | 归档客户端：jsdom 集成测试（真实 React 18.3.1 + 真实点击） |
| `packages/reasoning/tests/reasoning.mjs` | 推理等级补齐（模拟 settings 服务，验证幂等补齐/不覆盖/监听） |
| `packages/chime/tests/smoke.mjs` | 提示音客户端：dock 跳变触发 + localStorage 读取 |
| `packages/search/tests/web-search-exa.mjs` | 免密钥 Exa 搜索 provider（匿名 MCP/REST/429/abort） |
| `packages/bashguard/tests/stall-guard.mjs` | 卡顿卫士（纯决策逻辑 + tools/execute 接线） |
| `packages/settings/tests/smoke.mjs` | better-webui 设置页：提示音卡（开关 + 音量，localStorage） |
| `packages/retry/tests/host.mjs` | 重试策略宿主：规划/应用/幂等/不覆盖手写 |
| `packages/retry/tests/smoke.mjs` | 重试策略页：四字段 + 应用/恢复默认 RPC + 页面描述不重复 |
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
