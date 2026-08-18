# better-webui 开发记录（v0.4）

这份记录面向两件事：**恢复现场**（服务器、profile、热加载链路）与**未来插件编写**（哪些机制可用、契约长什么样、坑在哪）。文中所有结论均已在 2026-08-17/18 的实机上验证或从 harness 源码直接读出。

---

## 1. 部署拓扑（恢复现场用）

| 项 | 值 |
|---|---|
| 运行中的服务 | `dsh web`，PID 由 `ps aux | grep "dsh web"` 找，监听 `http://127.0.0.1:3080` |
| 服务实际 home | `DSH_HOME=/home/archie/.dsh`（注意：工作区里的 `.dsh-better/` 不是本服务的 home，是历史试验残留） |
| 实际使用的 profile | `/home/archie/.dsh/profiles/web/`，`package.json` 的 `dsh.profile.bundles` 只有 `dsh-base` + `dsh-web-app` |
| 插件安装方式 | `profiles/web/package.json` 的 `dependencies` 里 `"@better-webui/better-webui": "link:/home/archie/forge/better-webui"`，再在 `bundles` 数组加上包名 |
| 插件源码 | `/home/archie/forge/better-webui`（本仓库） |
| 插件回收站数据 | `$DSH_HOME/better-webui/trash/`（`trash.json` 索引 + 每会话一个目录） |
| dsh 源码（只读参考） | `/home/archie/forge/deepseek-harness` |
| 全局安装的 dsh | `/home/archie/.nvm/versions/node/v24.18.0/lib/node_modules/@deepseek-ai/dsh/`（运行的正是它，不是源码 checkout） |

**关键点**：当前 3080 服务是全局安装的 dsh，profile 里通过 `link:` 依赖软链到本仓库。插件源码改动后需要**重启 `dsh web`**（node half 是启动时加载的），client bundle 改动则会被 stat-poll 热加载（见 §3）。

### 重启命令模板

```sh
# 杀掉旧进程后，在用户 shell 里重新拉起：
dsh web   # 默认 127.0.0.1:3080
```

注意：dsh web 是前台进程（`Sl+` 状态），由用户终端持有；agent 沙箱里重启的实例可能落在不同 DSH_HOME。**重启操作请交给用户做**，或明确设置 `DSH_HOME=/home/archie/.dsh`。

---

## 2. 插件双面结构（dsh 插件模型）

dsh 插件是 **npm 包 + 两个 half**：

```
better-webui/
  package.json        # 声明 dsh.bundle.patch 与 dsh.client；devDependencies 仅测试用
  cordis.patch.yml    # 向 profile 插入 host 行
  build.mjs           # 一条命令产出两个产物（无需 tsc）
  src/
    host.js           # host half：函数插件（export inject / apply），复制到 lib/index.js
    client.bundle.js  # client half 源码（纯 JS，被包裹后产出 lib/client.js）
  lib/
    index.js          # host 产物（Node 加载）
    client.js         # client 产物（浏览器加载）
  tests/
    smoke.mjs         # jsdom 集成测试（驱动构建产物，23 项断言）
    primitives-stub.mjs
```

### package.json 关键字段

```json
{
  "main": "lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./cordis.patch.yml": "./cordis.patch.yml"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "inject": ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-ui-slots"],
      "platform": "web"
    }
  }
}
```

- `dsh.bundle.patch` → host 行插入 profile（cordis loader）。
- `dsh.client` → client-modules registry 识别本包有浏览器 half，服务 `/plugins/<id>/client.js`。
- `dsh.client.inject` 只是**信息性**的（预取/HMR diff 用），不决定 apply 顺序；apply 顺序由 cordis fiber 的 service inject 决定。

### cordis.patch.yml（host 行）

```yaml
- insert:
    - id: better-webui
      name: '@better-webui/better-webui'
```

host half 以函数插件（`export const inject` / `export function apply`）形式加载；class 插件（default export Service）也支持，但函数形态免编译、生命周期干净，本插件用它。

---

## 3. client bundle 格式（lib/client.js）

浏览器侧**不是普通 ESM**，是这个信封：

```js
window.__ModuleLoader__.load({ id: '@better-webui/better-webui', factory: (require) => {
var module = { exports: {} };
var exports = module.exports;
// ...你的代码，exports.inject = [...] / exports.apply = function (ctx) {...}
return module.exports;
} });
```

- **factory 是工厂形态的 CJS**（`ClientModuleSystem.materialize` 的契约）：`require` 是唯一参数，**factory 的返回值就是模块导出**；体内必须自带 `var module = { exports: {} }; var exports = module.exports;` 前奏并以 `return module.exports;` 结尾。直接写裸的 `exports.foo = ...` 会抛 `exports is not defined`，整个浏览器 boot 失败（横幅 "Failed to load plugins"）。build.mjs 已内置该前奏/结尾，`src/client.bundle.js` 只写主体即可。

- `require` 只认**平台静态表**：`react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `@deepseek-ai/cordis`, `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-web-react`, `@deepseek-ai/dsh-client-ui-primitives`, `@deepseek-ai/dsh-client-ui-attachment`, `@deepseek-ai/dsh-client-schema-form`。
  完整清单在 `packages/client/web/src/platform.ts` 的 `PLATFORM_MODULES`。
- **不能** require 其它插件包（跨插件值导入被禁），不能 import css 文件——样式用 `<style>` 标签注入（`document.head.append`），并打上 `data-plugin` 归属（HMR 会认领无标签的 style）。
- factory 里导出 `inject`（数组）与 `apply(ctx)`（函数）。client ctx 上可用：`ctx.slots`、`ctx.sessions`、`ctx.workspaces`、`ctx.locale`、`ctx.connection`、`ctx.remote` 等（inject 声明后 cordis 会等待服务）。
- **HMR**：dsh web 的 webserver 会 stat-poll 它服务的 client bundle，文件 mtime/size 变化就广播 reload 帧，浏览器自动重载插件。所以改 `lib/client.js` 不用重启服务；改 host half（lib/index.js）要重启。

---

## 4. RPC：浏览器 → 宿主（自建 connection 通道，纯 JS 零编译）

这是本次打通的关键路径，**out-of-tree 插件最简单的宿主 RPC 方式**：

### host 侧（src/host.js，函数插件）

```js
export const inject = ['connection', 'sessionPersistence']

export function apply(ctx) {
  const handle = ctx.connection.rpc.handle('/better-webui', handler, { authority: 'trusted-host' })
  ctx.effect(() => handle, 'better-webui: rpc channel')
}
// handler: (endpoint, payload, signal) => Promise<RpcResult>
// RpcResult = { ok: true, value } | { ok: false, error: { code, message, details } }
```

- `ctx.connection` 是 **host 侧** `HostConnectionService`（`dsh-client-connection` 包的 node half 提供，web bundle 里有）。
- `handle(channel, handler, options)` 注册一个**专属通道**：自动在 webserver 上挂 `POST /<channel>/<endpoint>` 路由 + 信封解码 + 信任检查，handler 拿到的 `payload` 就是浏览器传的对象本体。
- 通道名规则 `/^\/[A-Za-z0-9._~-]+$/`；endpoint 段规则 `^[A-Za-z0-9_$.-]+$`。
- `authority: 'trusted-host'` = 回环 + 配置过的 LAN 主机 + 同源浏览器（与 typert gateway 同姿态）；`'loopback'` = 仅回环。
- 返回的 disposer 要挂到自己的 fiber（`ctx.effect(() => handle)`），否则通道活到连接服务死亡。

### browser 侧（client bundle 内）

```js
ctx.connection.rpc.call('/better-webui', 'trash', { sessionId, title })
  .then(result => { if (!result.ok) throw new Error(result.error.message); ... })
```

浏览器侧 `ctx.connection` 是同一包的 client half（fetch 信封 + rpcId 关联），`call` 直接返回 `RpcResult`。

### wire 上的形状（可直接 curl 验证）

```json
POST /better-webui/trash
{ "type": "client-request", "rpcId": "<uuid>", "method": "trash",
  "payload": { "sessionId": "...", "title": "..." } }
```

业务错误 = HTTP 200 + `{ ok: false, error }`；handler 抛异常 = HTTP 500（要自己 catch 成 error result）。

### 另一条路（不推荐 out-of-tree 用）：Typert SRC 模式

host half 继承 `TypertRemoteService` + `@Remote('method')` 装饰器方法，浏览器走 `/api` 通道 `ctx.connection.rpc.call('/api', 'ns/method', { args })`。网关用**函数源码解析参数名**（参数必须是简单标识符，不能解构/默认值/rest，参数名即 wire 字段）。缺点：装饰器是 TS/编译期特性，纯 JS 不能用（Node 不支持运行时 TC39 装饰器），需要 tsc/tsdown 工具链。v0.1 用的就是这条路。

---

## 5. 删除会话：宿主侧真实删除的实现

**没有现成的"删除 session"API**（`WorkspaceRegistry` 只有 archive；`sessions.*` RPC 无 delete）。可用积木：

| 积木 | 位置 | 用途 |
|---|---|---|
| `ctx.get('agents').get(id)` | dsh-agent | 拿到活 agent：`agent.cancel('disposed')` + `agent.whenIdle()` 停止 |
| `ctx.get('sessions').get(id)` | core/session | 活 session：`store.flush(session)` 把缓冲事件刷盘 |
| `ctx.get('sessionPersistence')` | dsh-session-persistence | `list()`（全部 header）+ `locate(header) → { path }` |
| jsonl 后端的磁盘布局 | session-persistence-jsonl | `$root/<projectDir(cwd)>/session-<id>/session.jsonl(.zstd)` |

**v0.2 的删除算法（trash）**：

1. `headerOf(id)`：活 store → persistence.list() 找 header。
2. `quiesce(id)`：cancel agent → `whenIdle()`（3s 超时兜底）→ `store.flush(session)`。
3. `persistence.locate(header)` 得到日志文件路径，`dirname` 得到会话目录。
4. `mkdir -p $DSH_HOME/better-webui/trash` → `renameSync(sessionDir, trash/<sessionId>)`。
5. 写 `trash.json` 索引（sessionId, title, cwd, trashedAt, sessionDir, trashDir）。

效果：会话**既不活也不在持久层**，下一次客户端 `sessions.refresh()`（我们主动调）后从所有列表消失。这是真删除——不是置灰标记。

**restore**：`renameSync(trashDir, sessionDir)` 回原位（先把 live writer 可能重建的残目录 rm 掉），再 `sessions.refresh()`，会话回到 workspace 分组。

**destroy**：`rm -rf` 掉 trash 副本与原位置残渣。

### 为什么不 dispose agent

`AgentHandle.dispose()` 只归创建它的 owner（apiproxy 的 session 工厂）所有，插件拿不到 handle；`agent.ctx` 上的 fiber dispose 是结构性 API，第三方调用会破会话注销配对。实测 **cancel + flush + 移走文件** 就够了：agent 留在内存里无害（其 session 对象还在 store 里，但持久层已无此会话，重启后自然消失）。活会话被 trash 后其 `session/disposed` 不会发，但客户端 `refreshList` 会把它从列表清掉。

---

## 6. UI：可用插槽与本次选型

### 选用的两个（全部 additive，不覆盖任何原生件）

1. **`conversation.session.header.actions`**（list，session scope）
   - owner props 为空；框架给 `sessionId`、`useSessions` 等标准 kit。
   - 注册：`ctx.slots.inject(name, () => ctx.slots.register({ name, id, order: 60, locale: NS, inject }, Comp))`。
   - 渲染会话标题栏里的垃圾桶图标 → 两步确认（✓/✗）→ trash + 跳到新会话 + 撤销 toast。

2. **`sidebar.footer.action`**（list，root scope）
   - owner props：`{ wide: boolean }`。
   - v0.3：与 Settings 行对齐的一行**两个安静图标**——回收站（数量徽标 + 弹层：恢复/两步彻底删除）与归档查看器（弹层列出原生 `workspace.archiveSession` 归档的会话，点击行即 `ctx.sessions.open(id)` 回看，只读浏览不取消归档）。撤销 toast 宿主也在这里（root scope 常驻）。

### 归档回看的数据来源（v0.3 新增，全部现成积木，零 host 改动）

- `useWorkspaces(state => state.archivedSessionIds)`：宿主 `workspace.list` 的全局归档集，`host/archived-sessions-changed` 帧实时推。
- `useSessions(list => list.byId)`：`session.list` **不过滤归档**，标题/updatedAt 都在。
- 归档会话的工作区归属：在 `workspaces.items[].sessionIds` 里查（归档保留记账槽）。
- 回看 = `ctx.sessions.open(sessionId)`：会话正常打开（对话只读与否由运行态决定），列表仍隐藏它——正是"回看"语义。
- 原生侧栏的归档入口在会话行菜单里（Archive），没有 unarchive RPC；本插件的回收站（trash/restore）与它互补、互不干扰。

### 明确不碰的（重要教训）

| 插槽 | 为什么不覆盖 |
|---|---|
| `conversation.chat.node` key `user`/`steering` | 覆盖会把**原生 copy/branch 图标按钮**（`MessageIconActions`）换掉——v0.1 就是这样把 icon 变难看文字的。原生复制本来就是好的。 |
| `tool.call.toolview` key `bash` | 原生 bash 行（terminal 卡片、展开交互、Inspect 按钮）是完整产品件；v0.1 覆盖成 `<details>` 反而降级。**用户反馈"现在能看到 bash 输出"正是因为 v0.1 卸载后原生件恢复**。 |
| `sidebar.workspaces` | 整个浏览区重写代价巨大；原生会话树已带 workspace 分组/归档/搜索。 |

### 本次发现的其它可用插槽（未来参考）

- `conversation.session.header.utilities`：标题栏右侧 utilities（同 actions）。
- `conversation.chat.assistant-actions`：某条已完成 assistant 消息的操作条（owner 给 `messageId`）。
- `conversation.chat.turnTail`（chain）：Turn 尾部扩展。
- `conversation.input.left/right/dock`、`conversation.composer.dock`：输入框周边。
- `sidebar.settings`（single）：设置座位。
- `details`：详情面板。
- keyProps 派发：`conversation.chat.commandview`（按命令名）、`tool.call.toolview`（按工具名，用于**自己的**工具）。

### 注册规范（必须遵守，否则 HMR/重载泄漏）

- 永远 `ctx.slots.inject(slotName, () => ctx.slots.register(...))` —— 等声明出现、声明塌了自动撤、随调用方 fiber 生命周期走。
- list 插槽用 `id` 区分自己；`order` 控制排序。
- `inject: () => ({ ... })` 工厂只回**纯数据与回调**，不回 ReactNode、不回整个 service 对象。
- 组件只从 props 拿东西（四股 props：runtime/renderSlots/store/inject face）；组件内看不到 ctx。
- locale：`ctx.effect(() => ctx.locale.register(NS, { zh, en }))`，组件经 `locale: NS` 注册拿到 `t`。

---

## 7. 样式与图标

- **图标**：`require('@deepseek-ai/dsh-client-ui-primitives')` 里有 `IconTrashOutline16`、`IconCheckOutline16`、`IconCloseOutline16`、`IconRefreshOutline16`（当 restore 用）、`IconArchiveOutline20`、`IconCopyOutline16`、`IconBranchOutline16`、`Tooltip`、`StateDot` 等 70 个导出。**用这些，不要用文字按钮**（v0.1 的主要丑因）。
- **颜色**：只用 `--dsw-*` 语义 token，如 `--dsw-alias-label-tertiary`、`--dsw-alias-label-primary`、`--dsw-alias-interactive-bg-hover`、`--dsw-alias-interactive-bg-hover-danger`、`--dsw-alias-state-error-primary`、`--dsw-alias-state-business-primary`、`--dsw-alias-bg-overlay`、`--dsw-alias-border-l2`。不写字面色值、不引组件库。
- 图标按钮规格沿用原生：28×28、padding 6、圆角 28、transparent 底、tertiary 色，hover 换 interactive-bg-hover + primary 色。
- **侧栏底行几何**（v0.3 对齐 Settings 触发行 `ui-settings-general/SettingsRoot.module.css` `.trigger`）：宽侧栏 = 高 34px、`margin: 4px -4px 4px`、`padding: 0 6px 0 10px` 的横排；窄侧栏（rail）= 36×36 圆形按钮居中。要"安静"就用 tertiary 色而非 primary。
- 产品文案是中文（本插件带了 zh/en 双词典，`ctx.locale.register` 自动按 app locale 选）。
- 弹层/toast 用 `ReactDOM.createPortal(..., document.body)`，避免被侧栏 overflow 裁剪；弹层定位用按钮 `getBoundingClientRect()` 换算 `position: fixed` 的 left/bottom。

---

## 8. 测试：jsdom 集成测试（v0.3 关键基建）

`tests/smoke.mjs` 用**真实 jsdom DOM + 与 app 完全同版 React（18.3.1）+ 真实 portal + 派发 click 事件**驱动**构建产物 lib/client.js**（不是源码），23 项断言覆盖：信封加载、apply 注册、两组件渲染、arm→confirm→trash RPC→startSession、**撤销 toast 出现→点击→restore RPC→「已恢复」**、回收站弹层恢复/两步彻底删除、归档弹层列出与点击回看。

运行：

```sh
cd /home/archie/forge/better-webui
npm run build && node tests/smoke.mjs
```

测试要点（照抄即可写新测试）：
- 依赖装在 `better-webui/node_modules`（`npm install --cache /home/archie/forge/.cache/npm`，缓存指到工作区内即可免提权），**放 devDependencies**——profile 的 pnpm 只装 prod 依赖，混进 dependencies 会污染 profile 安装。
- React 版本必须对齐 app：`/home/archie/.dsh/profiles/node_modules/react/package.json` 的版本（18.3.1）。
- 加载信封：把 `__ModuleLoader__` 挂在 jsdom 的 `dom.window` 上（**别用 stub window 对象**——组件闭包里的 `window.setTimeout` 会丢），再 `new Function('require','window','document', source)` 执行 `lib/client.js`。
- `factory(require)` 的**返回值**才是模块导出（`module_.exports` 上的赋值不会被看见）。
- React 18 `createRoot` 没有 render 回调：`root_.render(tree)` 后 `setTimeout(resolve, 20)` 等挂载。
- mock ctx：`effect(fn)` 立即执行、`slots.inject(name, begin)` 立即 `begin()`、`slots.register(spec, comp)` 收集、`connection.rpc.call` 记日志回 `{ok:true,...}`。

这个测试就是抓 v0.2 撤销消失 bug 的手段：UI 链路没验证过就上线 = 靠猜。

---

## 8. 构建 & 热加载操作卡

```sh
cd /home/archie/forge/better-webui
pnpm run build        # = node build.mjs：包裹 client + 复制 host，零工具链依赖

# 只改了 client：什么都不用做，webserver stat-poll 会广播 reload（浏览器自动刷新插件）
#   也可以强制触发：touch lib/client.js

# 改了 host：需要重启 dsh web（见 §1 重启命令模板）
```

构建零依赖（只要 Node）。host half 是纯 ESM JS，直接复制；client half 只是文本包裹。

### 验证清单

1. `curl -s -X POST http://127.0.0.1:3080/better-webui/listTrash -H 'content-type: application/json' -d '{"type":"client-request","rpcId":"t1","method":"listTrash","payload":{}}'` → 应返回 `{...ok:true, value:{items:[]}}`（404 = host half 没加载）。
2. 浏览器刷新 `http://127.0.0.1:3080`，会话标题栏应出现垃圾桶图标。
3. 侧栏底部 Settings 行上方出现回收站 + 归档两个安静图标。
4. 部署核对：`sha1sum lib/client.js | cut -c1-12` 应等于 boot manifest 里的 `?rev=`（首页 HTML `plugins/@better-webui/better-webui/client.js?rev=…`）。注意插件 URL 带_scope_前缀 `@better-webui/`。
5. `node tests/smoke.mjs` 全绿。

---

## 9. 坑与教训（v0.1 → v0.3）

1. **v0.1 的三个失败根源**：
   - 覆盖 `conversation.chat.node/user`，把原生 MessageIconActions（copy 图标）替换成文字按钮 → 丑 + copy/branch 全坏。
   - 覆盖 `tool.call.toolview/bash`，原生 terminal 卡片没了 → bash 输出看不到（用户后来看到的是 v0.1 被移除后的原生恢复）。
   - 删除只写 localStorage/宿主 JSON 标记 → "删除"不了任何真实东西。
2. **dsh.client.inject 不保证加载顺序**——依赖 slot 声明必须用 `slots.inject`。
3. **不能跨插件 import**——client bundle 里只能 require 平台静态表。
4. **profile 的 node_modules fallback**（`$DSH_HOME/profiles/node_modules`，dsh 启动时自愈的平铺软链）只覆盖 `@deepseek-ai/*` 官方包；插件本体靠 profile `dependencies` 的 `link:` 解析。
5. **两个 DSH_HOME 陷阱**：工作区 `.dsh-better/` 是历史残留；真实服务 home 是 `/home/archie/.dsh`。诊断前先 `tr '\0' '\n' < /proc/<pid>/environ`（不行就查 `~/.dsh` 的 sessions 时间戳）确认。
6. **RPC 方法参数名即 wire 字段**（Typert SRC 模式）；自建 connection 通道则无此约束（payload 整体传）。
7. `hostDescription`、agent dispose handle 等都不对插件开放；能用的宿主积木见 §5 表。
8. **factory 信封契约**（v0.2 抓到的撤销消失根因之一）：factory 的**返回值**才是模块导出；手写 bundle 必须自带 `var module = { exports: {} }` 前奏 + `return module.exports` 结尾。测试驱动产物时同样要用返回值，用 `this`/外部 exports 对象会**掩盖真实加载失败**。
9. **npm 在工作区内可用**：`npm install --cache <workspace>/.cache/npm`（缓存默认写 `~/.npm` 会 EROFS）。测试依赖必须进 `devDependencies`。
10. **撤销 toast 是跨组件通信**：header action 发事件、footer 宿主听（模块级单播总线 `subscribeToast/publishToast`）。若 footer 组件没挂上（比如 factory 加载失败），撤销就无声消失——这正是写 §8 集成测试的原因。

---

## 10. 未来方向（未做）

- 回收站 UI 的"清空全部"。
- 归档查看器加"取消归档"（需等 harness 提供 unarchive RPC；现在只有 archiveSession）。
- trash 记录带 workspace 归属，恢复后回原分组（现在靠 cwd 重挂）。
- 会话正在运行时 trash 的更优雅处理（目前 cancel + 3s 兜底）。
- 若 harness 未来提供 `sessions.delete` RPC，host half 可整体简化。
- i18n：目前 zh/en，缺其它 locale 时 fallback 到 en。

---

## 11. v0.4 机制记录（撤回 + 归档联动 + 死记录清除）

### 11.1 `conversation.chat.user-actions` 槽（harness 补丁）

用户消息行原无插件槽：`UserMessageNodeView` 渲染 `MessageIconActions` 时不传
`extraActions`（只有 assistant 回合尾接 `conversation.chat.assistant-actions`）。
v0.4 在 harness 侧新增 list 槽 `conversation.chat.user-actions`，owner props
`{ node: UserMessageNode, turn?: number }`：

- **源码补丁**（`packages/client/ui-conversation`，随下次 dsh 发布带走）：
  `contract/slots.ts`（SlotMap + `UserActionOwnerProps`）、`chat/MessageItem.tsx`
  （新增 `UserPromptNodeView`，steering 行保持原组件——children 声明是排他的，
  只挂 `'user'` key 正好把撤回限定在真正的提示词行）、`chat/register-node-renderers.ts`。
- **部署镜像补丁**（当下生效）：全局安装的
  `dsh-client-ui-conversation/lib/client.js` 是**未压缩 esbuild 产物**，可外科手术式
  修改。`scripts/patch-ui-conversation.mjs` 幂等（含 marker 检测 + 唯一性校验 +
  备份），**每次升级 dsh 后重跑**。webserver 直接 serve 该文件，改完刷新即生效。
- 插件侧注册照旧 `ctx.slots.inject(name, () => ctx.slots.register({...}, Comp))`；
  组件经四股 props 拿 `node`/`turn`/`useSession`/`sessionId`/`inputActions`
  （`inputActions` 来自 ui-conversation 的 `sessions.provide` 标准件，session 槽位全可达）。

### 11.2 撤回的 fork 边界数学

`sessions.fork({atSeq})` 的边界 = **atSeq 起第一个 `turn/end`**（消息 fork 按钮传
消息 seq 即含该消息整回合）。撤回 M 要"保留 M 之前的对话"，因此
`atSeq = max(turnEnds[t] for t < M.turn)`——快照里 `snapshot.turnEnds` 是
`Map<turn, turn/end seq>`。无更早回合（首条）→ 撤回不可用，按钮禁用。流程：
cancel（若 running）→ fork → `setDraft(原文)` → open(子) → host `archive`(源)。

### 11.3 归档集的运行时增删（无 unarchive RPC 的出路）

`WorkspaceRegistry`（dsh-workspace）TS-private 成员编译后是普通方法：
`enqueueOperation(op)`（串行队列，与 archiveSession 同队列）+ `requireState()` +
`setState(state)`（`DomainGlobal.set` → 持久化 + `domain/changed` 事件）。
apiproxy 的存储监视器（api-proxy.ts ~3570）对比新旧 `archivedSessionIds` 后自动推
`host/archived-sessions-changed` 帧，**所有客户端的侧栏/归档集实时更新，零额外通知**。
原地改 `requireState()` 返回的对象是安全的（`globalValue` 是普通对象，无冻结）。
host half 的 `mutateArchiveSet` 带能力检测，未来 dsh 重构掉这些成员时降级为
日志警告而非报错。用途：restore 反归档（会话回侧栏）、`restoreArchived`、
`destroy`/`purgeArchived` 清死 id。

### 11.4 trash 归档联动顺序

先 `archiveSession`（目录还在，存在性检查通过）再搬目录；索引记录 `archived`
标记。restore/destroy 时按标记反归档。归档失败的容错：照常搬目录 + 警告日志。

### 11.5 已核实不可行 / 已修

- **归档行 `sessions.open` 回看**：原生投影规则会立即清掉归档会话的打开状态
  （§2 表），路线放弃——这正是 v0.3"点开变空白会话"的根因，不是网络问题。
- **归档行标题"无标题"**：改用 `summary.displayTitle`（durable title → 项目目录名 → id）。
- **purgeArchived 的判定**：`live sessions ∪ persistence.list()` 都没有的归档 id 即死。
  注意 purge 只清注册表归档集，不动磁盘（死 id 本就无目录）。

### 11.6 测试覆盖（tests/smoke.mjs，36 项）

撤回：按钮渲染、两步确认、`fork` atSeq=41（上一回合 end）、setDraft 原文、
open 子会话、archive 源、toast；首条禁用。归档：displayTitle、restoreArchived、
trash、死行置灰标注、清除入口两步确认 + purgeArchived RPC。原有 trash/undo 全保留。
