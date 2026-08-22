# better-webui 开发记录（v0.5）

> **v0.14 起**：本插件已重构为 monorepo（元包 + 5 个功能小包）。本文的 `src/host.js`、
> `src/client.bundle.js`、`tests/*.mjs` 等单包描述已成为历史布局；当前布局、设计模式、
> 维护规则见 [docs/monorepo.md](monorepo.md)，构建/测试命令见根 README「开发」。
> 本文仍保留为机制与裁决的历史依据。

这份记录面向两件事：**恢复现场**（服务器、profile、热加载链路）与**未来插件编写**（哪些机制可用、契约长什么样、坑在哪）。文中所有结论均已在 2026-08-17/18 的实机上验证或从 harness 源码直接读出（v0.5 针对 dsh 0.1.0-rc.7 复核）。

---

## 1. 部署拓扑（恢复现场用）

| 项 | 值 |
|---|---|
| 运行中的服务 | `dsh web`，PID 由 `ps aux | grep "dsh web"` 找，监听 `http://127.0.0.1:3080` |
| 服务实际 home | `DSH_HOME=/home/archie/.dsh`（注意：工作区里的 `.dsh-better/` 不是本服务的 home，是历史试验残留） |
| 实际使用的 profile | `/home/archie/.dsh/profiles/web/`，`package.json` 的 `dsh.profile.bundles` 只有 `dsh-base` + `dsh-web-app` |
| 插件安装方式 | `profiles/web/package.json` 的 `dependencies` 里 `"@blueriverlhr/dsh-better-webui": "link:/home/archie/forge/dsh-better-webui"`，再在 `bundles` 数组加上包名 |
| 插件源码 | `/home/archie/forge/dsh-better-webui`（本仓库） |
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
    - id: dsh-better-webui
      name: '@blueriverlhr/dsh-better-webui'
```

host half 以函数插件（`export const inject` / `export function apply`）形式加载；class 插件（default export Service）也支持，但函数形态免编译、生命周期干净，本插件用它。

---

## 3. client bundle 格式（lib/client.js）

浏览器侧**不是普通 ESM**，是这个信封：

```js
window.__ModuleLoader__.load({ id: '@blueriverlhr/dsh-better-webui', factory: (require) => {
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

### 选用的槽（v0.8 起，全部 additive，不覆盖任何原生件）

1. **`settings.section`**（list，root scope）
   - owner props：`{ close }`；框架给 `useSessions`、`useWorkspaces` 等标准 kit。
   - 注册：`ctx.slots.inject(name, () => ctx.slots.register({ name, id: 'better-webui-archive', order: 30, label: () => ctx.locale.bind(NS)('archive.title'), locale: NS, inject }, Comp))`。
   - 渲染设置面板左侧导航里的「归档会话」页（紧跟「Agent 预设」order 20 下方）；
     页面直接列出全部归档会话（查看/恢复/两步彻底删除/清除失效记录），无弹层、无计数。
   - **为什么从这里**：原 `sidebar.footer.action` 归档图标与 ui-cordis 的动态插件
     面板（CordisPanel）同槽，运行 probe 等动态插件时面板占据同位置把图标挤掉；
     设置页从根上避开该冲突，原图标删除。

2. **`conversation.input.dock`**（list，session scope）—— v0.9 新增的会话活动提示音
   - owner props：`{ session: ConversationSnapshot, input: InputState }` —— 输入区的
     即时快照，状态变化时由 dispatching skeleton 重渲染（无需订阅）。
   - 注册：`ctx.slots.inject(name, () => ctx.slots.register({ name, id: 'better-webui-notify', order: 30, locale: NS }, NotifyDock))`。
   - `NotifyDock` 本体不渲染任何可见内容（`return null`）——**只响铃、不弹窗**。
   - 触发（仅状态跳变，ref 存上一次观察）：
     - **等待输入**：`session.pending` 由 0 → 非空（`ask_user_question` 的 question /
       approval / plan-review），下降双音。
     - **回合结束**：`session.running` true→false 且 `pending` 为空时，按结尾节点
       `lastTurnOutcome(nodes)` 路由：
       - `assistant`（正常答复）→ 上升三音（完成）
       - `turn-error` / `turn-max-tokens`（重试耗尽 / 硬错误 / 输出上限）→ 低沉双音
         （错误，绝不与完成音混淆）
       - `assistant-interrupted`（用户手动停止）→ 静音
   - **为什么不会误响**：模型请求失败后安排重试时，`dsh-agent-loop` 的 `step()` 在
     同一 `running` phase 的 `while(true)` 内重试（`agent/request-error` waterfall 返回
     `retry` 就 `continue`），所以重试等待期间 `running` 保持 **true**，不会触发任何音；
     重试耗尽才 `throw` → `turn/end(reason: error)` → phase→idle → `running` false，
     此时结尾是 `turn-error`，只响**错误音**而非完成音。
   - 声音用 Web Audio API 正弦合成（无音频资源），振幅按音量设置缩放；首次用户手势
     （pointerdown/keydown）解锁 AudioContext，规避自动播放策略。
   - **为什么从这里**：需要一个“会话打开期间始终挂载、且能拿到该会话 ConversationSnapshot”
     的座席。`conversation.input.dock` 是 session scope 的 additive 槽，正好满足；
     不覆盖任何原生件。

3. **`settings.general.item`**（list，root scope）—— v0.9.1 新增的提示音设置行
   - owner props 为空；行自绘 title/desc/控件（与 shipped 行一致），标准 props 只有
     `useSessions`/`useWorkspaces`。注册带 `locale: NS` 让行拿到 `t`。
   - 注册：`ctx.slots.inject(name, () => ctx.slots.register({ name, id: 'better-webui-notify', order: 30, locale: NS }, NotifySettingsRow))`。
   - 行内容：开关（`button[role=switch]` + track/thumb，**复刻 trajectory 工具栏的原生
     switch CSS**：track 20×10 圆角、thumb 6×6、`data-on` 时 business-primary + thumb
     translate(10px)）+ 音量滑块（`<input type=range>`，`-webkit-`/`-moz-` 伪元素自绘
     主题色 thumb/track）。
   - 持久化：**localStorage**（`better-webui:notify:enabled` / `:volume`）。用户明确要求
     不改宿主数据（担心未来 host 更新覆盖），所以不碰 settings.yaml / host.js —— 纯客户端，
     刷新即生效，无需重启。
   - 音量滑块用**原生事件监听**（ref + `addEventListener`），不依赖 React 受控
     range 的合成 `onChange`（后者在 jsdom 里被 value tracker 挡住难测，原生监听在浏览器与
     测试中行为一致）；input 上保留 no-op `onChange` 以消除 React「value without onChange」
     警告。`input`（拖动中）只持久化值，**`change`（松手）才试听一次**，避免拖动全程
     连响。
   - **为什么从这里**：用户要的是“通用设置里放提示音调节”，且 dsh 通用设置正是
     `settings.general.item` 行槽；一个行同时放下开关 + 滑块，状态天然共享。

### 明确不做：模型超参设置页

用户曾想“在设置里看/调 dsh 默认参数（temperature / top_p）”。调研结论（v0.9.1 记录）：

- dsh 请求配置 `LlmCallConfig` / `GenerateOptions`：`temperature?`（请求级）、`maxTokens?`、
  `stop?`、`reasoningEffort?` —— **没有 top_p**。
- pi-ai `StreamOptions`：`temperature?`（请求级）；pi-ai `Model` 接口**没有** temperature
  字段。全栈无 top_p。
- `llm-pi-ai` 设置 schema `PiAiModelProfile`：只有 `id / name / contextWindow / maxTokens /
  input / reasoningEfforts / compat` —— 无 temperature、无 topP。
- 结论：temperature 是**请求级**而非模型级持久配置，top_p 全栈无注入点。做模型超参设置页
  必须改 dsh 本体的请求链路（升级会被覆盖），超出插件范畴，**已放弃**。若只想展示/调整 schema
  原生支持的模型能力字段（contextWindow / maxTokens / reasoning 等），可另立需求。

历史选型（已退役，仅供追溯）：
- `conversation.session.header.actions`（list，session scope）：v0.3-v0.4 的标题栏
  垃圾桶 → 两步确认 → trash + 撤销 toast。v0.4 后随「标题栏垃圾桶」一起移除。
- `sidebar.footer.action`（list，root scope）：v0.3 起与 Settings 行对齐的一行
  安静图标（回收站 + 归档查看器），v0.5 收缩为单枚归档图标，v0.8 迁移进
  `settings.section` 后移除。

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
cd /home/archie/forge/dsh-better-webui
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
cd /home/archie/forge/dsh-better-webui
pnpm run build        # = node build.mjs：包裹 client + 复制 host，零工具链依赖

# 只改了 client：什么都不用做，webserver stat-poll 会广播 reload（浏览器自动刷新插件）
#   也可以强制触发：touch lib/client.js

# 改了 host：需要重启 dsh web（见 §1 重启命令模板）
```

构建零依赖（只要 Node）。host half 是纯 ESM JS，直接复制；client half 只是文本包裹。

### 验证清单

1. `curl -s -X POST http://127.0.0.1:3080/better-webui/listTrash -H 'content-type: application/json' -d '{"type":"client-request","rpcId":"t1","method":"listTrash","payload":{}}'` → 应返回 `{...ok:true, value:{items:[]}}`（404 = host half 没加载）。
2. 浏览器刷新 `http://127.0.0.1:3080`，设置面板左侧导航出现「归档会话」页
   （位于「Agent 预设」下方）。
3. 打开该页：直接列出全部归档会话（活行可恢复/两步彻底删除；死行置灰 + 页脚
   「清除失效记录」）；不再有侧栏底部图标（已迁入设置页）。
4. 部署核对：`sha1sum lib/client.js | cut -c1-12` 应等于 boot manifest 里的 `?rev=`（首页 HTML `plugins/@blueriverlhr/dsh-better-webui/client.js?rev=…`）。注意插件 URL 带_scope_前缀 `@blueriverlhr/`。
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

- 归档弹层的"全部恢复"批量操作。
- 若 harness 未来提供 unarchive / sessions.delete RPC，host half 可去掉对注册表私有成员的依赖、整体简化。
- i18n：目前 zh/en，缺其它 locale 时 fallback 到 en。

---

## 11. v0.5 机制记录（归档会话管理）

### 11.1 范围演变：v0.4 → v0.5

v0.4 曾实现"标题栏垃圾桶 + 回收站 + 撤回重写（fork 桥接）"。用户裁决后收缩：

- **不再修改 dsh 本体**。撤回按钮依赖给 `dsh-client-ui-conversation` 打的
  `conversation.chat.user-actions` 槽位补丁，dsh 升级（0.1.0-rc.7）即被覆盖 ——
  该功能与补丁脚本整体移除。若将来官方提供用户消息行插槽，可按
  docs/design.md §5.1 的 fork 边界数学复活。
- **删除收敛进归档视图**。v0.4 的 trash = 归档 + 搬目录，被删会话同时出现在
  回收站与归档区、两边都能删，体验冗余。v0.5 只保留一枚归档图标：
  查看 / 恢复 / 二次确认彻底删除。删除未归档会话走原生「归档会话」菜单再删。

### 11.2 删除的完整性（"真的都删了"的构成）

彻底删除一个会话要清三处（v0.7 起回收站已移除，见 11.8），`destroy` 全部覆盖
（tests/host.mjs 逐项断言）：

| 残留物 | 位置 | 清理方式 |
|---|---|---|
| 会话目录 | `$DSH_HOME/sessions/<proj>/session-<id>/` | `rm -rf`（活会话先 cancel + flush） |
| 归档集条目 | `storages/workspace.json` → `global.archivedSessionIds` | 注册表操作队列内 `setState`（见 11.3） |
| 记账槽条目 | 同文件 → `tables.workspaces.*.sessionIds` | 注册表**公开 API** `entity.detachSession(id)` |

归档集/记账的每次提交都会发 domain change，apiproxy 存储监视器自动推
`host/archived-sessions-changed` / `host/workspace-changed` 帧，全端实时更新。

### 11.3 仍需内部路径的部分（rc.7 核实）

rc.7 依然没有公开 unarchive（dsh-workspace README 明示 archived sessions
"have no viewing or unarchive surface"；`workspace.unarchiveSession` 不存在）。
归档集增删继续走注册表串行队列：`enqueueOperation(op)` + `requireState()` +
`setState(state)`（TS-private，编译后是普通方法）。带能力检测，未来 dsh 重构掉
这些成员时降级为日志警告。记账清理只用公开的 `detachSession`；死记账 id 的
**发现**读 `storages/workspace.json`（实体投影会把死 id 过滤掉，文件是唯一来源），
只读不改。

### 11.4 启动自愈清扫

`apply()` 注册完通道后跑一次 `purge`：把"既不活、也不在持久层"的归档 id 与
记账 id 全部清掉（best-effort，失败仅日志）。历史遗留的死记账 id（v0.4 destroy
及手工清理残留）就是被它清的。

### 11.5 行模型（client）

设置页的行 = `archivedSessionIds`，按 id 分态：
`byId` 有 → 活归档行（displayTitle）；两者皆无（或 host `listArchive` 报
`dead`）→ 死行（置灰 + 「清除失效记录」入口出现在页脚；`dead && live` 的
销毁活会话行另标「重启后清除」）。归档集通过帧实时更新，`listArchive` 在页面
挂载（每次进入设置页）时拉取。

### 11.6 测试（tests/smoke.mjs 28 项 + tests/host.mjs 20 项）

- smoke：单一注册、无标题栏垃圾桶/回收站、活/死/销毁活会话行、restore/destroy/
  purge 的两步确认与 RPC、toast、空态、旧宿主 stale。
- host：真实临时 DSH_HOME + 模拟注册表（含 setState 持久化回文件的保真），
  断言启动清扫、destroy 三处清理、restore、活会话保留归档 id、重启模拟 purge、
  workspace.json 终态零残留。

### 11.7 v0.7：活会话「彻底删除」不回未分组（修复记录）

**问题**：未分组会话归档后在本弹层彻底删除，会话回到「未分组」而不是被删除。

**根因**：`destroy` 把归档 id 一并移除，但活会话仍驻留宿主内存（`session.list`
从内存返回它），于是「反归档 + 未分组 + 内存仍提供」三件事叠加，会话“复活”。
dsh 无公开 API 丢弃活会话（`AgentHandle.dispose()` 是一次性 capability，
`SessionStore`/`AgentRegistry` 无 detach-by-id）——§2 第 49 行早有记录。

**修复（方案 A，用户裁决）**：
- `destroy`：删除磁盘 + 记账照旧；**活会话保留归档 id**（删冷会话时仍移除）。
  返回值增加 `keptArchived: true`。
- 新增 host 方法 `listArchive`：返回归档集每个 id 的 `dead`（无持久数据）与
  `live`（宿主内存驻留）。dead = 无 header 或日志文件不存在。
- client：destroy 成功且 `keptArchived` 时 toast“已彻底删除（记录将在重启后清除）”；
  行 dead 判定加入 host 的 `dead` 信号；`dead && live` 的行标「重启后清除」且无
  恢复/删除按钮。
- 重启后：启动清扫 `purge` 发现该 id 既不活也不在持久层 → 自动清掉。
- wire 版本 2 → 3（新 client 对旧 host 走「请重启 dsh web」stale 提示）。

**测试**：host.mjs 新增活会话 destroy + 重启模拟 purge 断言；smoke.mjs 新增
`listArchive` dead+live 死行断言。wire 版本同步更新。

### 11.8 v0.7 追加：移除回收站/垃圾桶遗留（用户裁决）

用户澄清：当初设想的“回收站”与“归档”功能重叠——“第一次删除进回收站，回收站里可
二次删除或恢复”，与“进归档后可恢复/彻底删除”流程相同，故回收站冗余；遗留记录一并
删除。落地：
- 宿主删除 `trash.json` 索引（`loadRecords`/`saveRecords`）与 `listTrash` RPC；
  `restore` 只移出归档集；`destroy` 只删会话目录；`purge` 不再把 trash 记录当可恢复。
- 客户端删除 `listTrash` API 与“遗留搬运行”行模型；行 = `archivedSessionIds`。
- 实机核查 `$DSH_HOME/better-webui/trash/` 为空（`trash.json` 仅 `[]`，无会话目录），
  无数据需迁移；删除该空目录。
- wire 版本维持 3。

### 11.9 v0.8：归档入口迁入设置页（用户裁决）

**问题**：侧栏 `sidebar.footer.action` 的归档图标会被 ui-cordis 的动态插件面板
（CordisPanel，同样注册在该 list 槽）挤掉——运行 probe 等动态插件时面板占据同
位置，图标不可见/被覆盖。

**裁决**：归档入口从侧栏迁进**设置面板左侧导航**，做成 `settings.section` 独立页
（id `better-webui-archive`，order 30，紧跟「Agent 预设」页 order 20 下方），
原 `sidebar.footer.action` 注册删除。附带两个打磨：
- **去掉会话数量计数**：与其他设置页一致不计数（原「1 个会话」难看且随数量变位置）；
  清除失效记录按钮保留，仅在存在死行时右对齐显示在列表下方。
- **简介文案风格**：对齐「模型」页 intro（如「填入各提供方的 API 密钥即可使用其
  模型。」）——改为一句话平实叙述，如「管理被原生界面归档隐藏的会话，可恢复到
  侧栏或彻底删除。」，不再用「A · B · C 入口」式技术清单；样式同步 14px/22px。

落地：
- `settings.section` 注册带 `label: () => ctx.locale.bind(NS)('archive.title')`
  （导航随语言切换）；页面挂载时 `reload()` + `checkHost()`（每次进入设置页重拉）。
- 页面结构 = 标题 + 简介 + 列表卡（活/死行）+ 页脚清除按钮；toast 沿用 body portal。
- wire 版本维持 3（无宿主改动）。
- **测试**：smoke.mjs 改为断言设置页（单注册 `settings.section`、页面直列 3 行、
  无计数、清除按钮在 `.bwt-footer`、简介非「入口」式），29 项全绿。

---

## 12. v0.15→v0.18 reasoning 排查记录（两代修复 + 事件驱动重构）

> 功能：`packages/reasoning` 给 `llm-pi-ai` 下未声明推理能力的自定义模型自动补
> `reasoningEfforts` 全档位（off/minimal/low/medium/high/xhigh/max），写回
> `settings.yaml` 持久化，让原生 composer「推理等级」菜单对 scnet 等自定义服务商
> 生效。本文记录「功能写了两次都没生效 → 最终定位并事件驱动化」的完整经验。

### 12.1 症状与初步结论（都指向"补齐没跑"）

- v0.15（`feat: full reasoning levels`）与 v0.16（`fix: wait on settings via inject`）
  都已合入，`npm test` 全绿，但**实机重启后 `settings.yaml` 里的模型仍是旧四档**
  （`off/low/medium/high`），composer 里看不到 xhigh/max/minimal。
- 用动态插件读 live `settings`（`describe()` + `get('llm-pi-ai')`）确认：`llm-pi-ai`
  命名空间**已注册**（在 `describe()` 的 namespace 列表里），但 **revision = 0**——
  证明从启动到现在**从未发生过任何一次写**，补齐 pass 从没跑过它的 `mutate`。
- 代码逻辑（`provisionCustomModelReasoning` + 幂等 + 测试）本身是对的；问题在
  **触发时机**，即 `apply()` 到底有没有、能不能在 `llm-pi-ai` 存在后执行补齐。

### 12.2 根因 1：`ctx.effect` 的语义被误用（v0.17 修复）

启动时序是这样的：

1. reasoning 插件 `inject: ['settings']` —— Cordis 在 `settings` 服务一注册就激活它。
2. 但 `llm-pi-ai` 命名空间是 **`dsh-llm-pi-ai` 在它自己的 `apply()` 里**
   `installSettingsSection(...)` 注册的，比 reasoning 插件激活**晚**。
3. 所以 apply 时第一次 `provision()`：`settings.describe()` 里还没有 `llm-pi-ai` →
   `descriptor` 为 undefined → 直接 return，什么都没写。
4. 原设计留了一个兜底：2 秒后重跑。**但兜底永远没触发**：

```js
// v0.16（错）：ctx.effect 的 callback 在 apply 时【立即同步执行】，
// clearTimeout(lateTimer) 当场把 2 秒定时器杀掉，晚补全永不发生。
const lateTimer = setTimeout(() => provision(), 2000)
ctx.effect(() => { clearTimeout(lateTimer) }, '...')
```

Cordis 的 `ctx.effect(callback)` **不是"挂一个回调等卸载时执行"**，而是：
- **立即**调用 callback（`fiber._execute` 同步执行）；
- callback 的**返回值**才是 disposer，存起来等 fiber 卸载时调用。

所以正确的写法是让 callback **返回**清理函数：

```js
// v0.17（对）：callback 返回 () => clearTimeout(...)，清理只在卸载时跑。
ctx.effect(() => () => clearTimeout(lateTimer), '...')
```

（对比：`ctx.effect(() => disposeSettingsWatcher, '...')` 是对的——它返回的是
`disposeSettingsWatcher` 这个函数引用，没有立即调用。）

**教训**：在 Cordis 里 `ctx.effect` = 「立即执行 + 返回值作 disposer」，不是
`useEffect` 式的声明。凡是想"注册一个清理动作"，callback 必须 `() => () => cleanup`，
绝不能 `() => { cleanup() }`。同理 `ctx.on()`、`slots.inject()` 等返回 disposer 的
API，都要通过 `ctx.effect(() => disposer)` 交给 fiber 管理。

### 12.3 根因 2（用户裁决）：硬编码时间本身就是错的（v0.18 重构）

v0.17 修好后功能能用了，但用户指出：**固定 2 秒 `setTimeout` 完全不符合工程逻辑、
不直觉**——它是个竞态（boot 慢不够、boot 快浪费），也解释不了"为什么要等 2 秒"。
用户也明确提出期望：**补齐一次后持久化固定，下次开机保留，不要每次手动调整**。

重新读 dsh 源码找"llm-pi-ai 生效的精确信号"，发现：

- `dsh-llm-pi-ai` 在 apply 里调 `ctx.llm.registerAdapter(routes, adapter)` 和
  `ctx.llm.registerConfigurableProviders(entries)`；
- `registerAdapter` → `commitRoutes()` 与 `registerConfigurableProviders` → `commit()`
  都会**同步** `emitAdaptersUpdated()` → 广播 **`llm/adapters-updated`** 事件；
- 该事件是全局 emit（`ctx.events.dispatch("emit", ...)`），`ctx.root.on(...)` 在
  `llm` 服务注册前监听也能收到之后的事件。

**结论：`llm/adapters-updated` 就是"llm-pi-ai 配置生效"的精确事件**。用它替代定时器：

```js
export function apply(ctx) {
  const provision = () => { void provisionCustomModelReasoning(ctx, 'provision').catch(() => {}) }
  provision() // 覆盖持久化场景（上次开机已补好 → 幂等不写）
  if (typeof ctx.root?.on === 'function') {
    // llm-pi-ai 适配器注册/更新的瞬间 → 补齐。事件驱动，零定时器、零轮询。
    ctx.effect(() => ctx.root.on('llm/adapters-updated', () => provision()),
      'better-webui-reasoning: adapter watcher')
    // settings.yaml 热重载 → 补齐（用户手改/插件写回都会触发）。
    ctx.effect(() => ctx.root.on('settings/document-updated', (ns) => {
      if (ns !== LLM_PI_AI_NS) return
      provision()
    }), 'better-webui-reasoning: provisioning watcher')
  }
}
```

**经验**：
- **不要用定时器去"等一个还没注册的东西"**。找那个东西注册/生效时的**事件或回调**
  信号，事件驱动才正确、可解释、无竞态。dsh 的 `llm/adapters-updated`、
  `settings/document-updated`、`settings/updated`、`tools/change`、`skills/change` 等
  都是这种"配置/能力生效"的精确信号。
- 一个信号的可用性要从 dsh 源码确认（`grep registerAdapter / emitAdaptersUpdated`），
  不能只靠名字猜。
- **幂等 + 持久化是"开机保留"的关键**：补齐写回 `settings.yaml`，下次开机读出来
  已全档 → `needsGrant` 全 false → 不写不干扰。用户不用每次手动调。

### 12.4 排查手法（可复用）

- **动态插件读 live 状态**：用临时 dynamic plugin 调 `settings.describe()` /
  `settings.get('llm-pi-ai')` 读当前进程内的真实状态（比看文件准），确认命名空间
  是否注册、revision 是否为 0、user 层档位；把结果写到工作区文件再读回。
- **从源码确认契约**：`ctx.effect`/`ctx.on`/事件 emit 的语义、`registerAdapter` 是否
  emit 事件，都要从 `node_modules/@deepseek-ai/*/lib/index.js` 读出，不能靠印象。
- **回归测试要能复现真 bug**：新增的 boot-race 测试先临时还原 bug 验证「测试会失败」，
  再恢复修复验证「测试通过」——确认测试真的守得住这条线。事件驱动后，测试也变成
  **触发 `llm/adapters-updated` 事件立即断言**，不再等待定时器，又快又准。
- 注意：动态 plugin（sandbox）里 `settings.update/mutate` 会因 **cross-realm 的
  plain-object 检查**失败（沙箱 VM 里的对象 prototype 不是 host realm 的
  `Object.prototype`）——这是沙箱限制，不是 reasoning 插件的问题；静态 bundle 插件
  （host-realm，ESM import 加载）不受影响。

### 12.5 当前行为（v0.18，文档化）

- 启动：apply 立即 `provision()`（幂等）→ `llm/adapters-updated` 事件在
  `llm-pi-ai` 适配器注册时同步触发 → 补齐写 `settings.yaml`。无定时器、无等待。
- settings.yaml 热重载：`settings/document-updated` → 补齐。
- 持久化：下次开机已全档 → 不写不干扰，composer 直接有七档，无需手动调整。
- 生效路径：host 改动 → 重启 `dsh web`。

### 12.6 v0.19：可配置重试策略 + better-webui 专属设置页（settings 包）

**需求**：dsh 原生重试默认 `maxRetries: 2` 太少且不可调。用户要在设置里开一个
**专属 better-webui 的面板**（与通用/模型/插件/Agent 预设/归档会话并列），
把重试次数与退避做成可调项，并把提示音音量从通用设置**移入**该页，不和 dsh
自身设置混放。

**调研（dsh 机制）**：
- 重试由 `dsh-base` 里已启用的 `@deepseek-ai/dsh-llm-retry`（行 id `llm-retry`）
  执行，挂在 agent loop 的 `agent/request-error` waterfall 上。策略是**每 provider
  一份**：`llm-pi-ai.providers.<route>.retryPolicy`（`mode: normal|always` +
  `maxRetries` + `retryableCodes` + `backoff`）。没有全局旋钮。
- 默认值（`dsh-llm/lib/types/retry-policy.js`）：`maxRetries: 2`、
  `backoff: { initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 }`、
  `retryableCodes: [EMPTY_RESPONSE, RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT]`。
- **热加载**：pi-ai 适配器 `providerRetryPolicy()` 每次实时读 `profiles()`；
  `settings` 变更 → `setSource` → `onChange` → 重新 resolve（含 `resolveRetryPolicy`）。
  所以改 `settings.yaml` 的 `retryPolicy` **无需重启**。

**设计（与用户确认的三点，全部采纳推荐项）**：
1. **全局默认**：一套控件（maxRetries + 初始延迟 + 最大延迟 + 抖动）写进**每个未
   自行声明 retryPolicy 的 provider**；已手写自定义策略的 provider 不覆盖。
2. **全参数**：不只是重试次数，退避三参数也暴露，带「恢复默认」。
3. **彻底移走**：音量/开关从 `settings.general.item` 移除，只在 better-webui 页。
   localStorage 键不变（`better-webui:notify:enabled` / `:volume`），老用户设置不丢。

**实现要点**：
- 新包 `packages/settings`（host + client），行 id `better-webui-settings`，
  插槽 `settings.section` order 25（Agent 预设 20 与归档 30 之间），标签「better-webui」。
- **设置命名空间 `better-webui`**：schema 为
  `{ retry: { policy, lastApplied } }`（policy 四标量；lastApplied 是"上次写入
  provider 的策略"标记）。作用有二——(a) 持久化全局策略，重启不丢；(b) 区分
  "我们写过的"（= lastApplied，可再更新）与"手写的"（≠ lastApplied，跳过）。
- **幂等 provision**（`planRetryOps`）：每个 provider 写条件 = 当前无 retryPolicy，
  或当前==lastApplied 且 != 目标策略；已==目标策略的跳过（不写，防 ping-pong）。
  写入形状是 DSH 自己的 `{ mode: 'normal', maxRetries, backoff: {...} }`
  （`policyToRetryPolicy`，省略 retryableCodes → DSH 默认）。
- **写路径**：RPC `apply` → `planRetryOps` → `settings.mutate('llm-pi-ai', ops, rev)`
  → `settings.mutate('better-webui', [policy, lastApplied], rev)`；仅当策略真的变才写
  命名空间，避免自触发 watcher 死循环。boot + `scope.watch` + `settings/document-updated`
  三个触发点，都走同一幂等 provision。
- **client 跨包值导入被禁**：settings 页的提示音卡不 import chime，而是硬编码同一对
  localStorage 键字符串（稳定契约，monorepo.md §4 已文档化）。chime 包保留 dock +
  播放 + `readNotifyPrefs`（删 `writeNotifyPref` 与设置行）。

**经验**：
- 一个"全局默认 + 不覆盖手写"的配置注入，关键是**区分机器写入与手写**。这里用
  `lastApplied` 标记（持久化在自家命名空间）——比 reasoning 的"legacy 默认即机器
  写入"更通用，因为重试策略的值由用户选、不是固定默认。
- **幂等必须连"写路径本身"一起防**：光让 provider 不重复写不够，还要让"写命名空间"
  在值未变时跳过，否则自己的写会触发 watcher → 再 provision → 再写…… 用 `policyEqual`
  判 `changed`。
- 写入 DSH 自己的 schema 形状（而非自造格式），让原生 `dsh-llm-retry` 原样执行，
  是最低耦合、最不可能被升级破坏的路径。
- 测试：host.mjs 用可变的 mock settings 服务（`applyOps` 模拟 mutate），覆盖
  首次应用/幂等/改策略更新 ours/跳过 custom；smoke.mjs 用真实 jsdom + RPC stub
  驱动页面（4 输入框、apply→read、恢复默认、音量 localStorage）。

### 12.7 v0.20：重试策略拆成独立设置页（settings 包内重构）

用户反馈 better-webui 设置页里重试卡字段多、占面积大；模型超参需求（design.md
§11）暂缓后，顺带把重试配置**拆成独立设置页**，原页只留提示音音量。

- **client.bundle.js**：`SettingsPage` 拆为 `BetterWebuiPage`（id
  `better-webui-settings`，order 25，只渲染 ChimeCard）与 `RetryPage`（id
  `better-webui-retry`，order 26，紧跟 better-webui 页，只渲染 RetryCard）。
  `apply()` 现在注册**两个** `settings.section` 条目。
- **同源同包**：两个页共享同一 locale NS（`better-webui-settings`）、同一 style
  标签（`better-webui-settings-style`）、同一 RPC 通道（`/better-webui-settings`）。
  只有重试页需要 `api`（RPC），better-webui 页纯客户端、不声明 inject 面。
- **host 零改动**：重试逻辑/命名空间/RPC 全在 host half，纯客户端页面布局变化，
  无需重启宿主。
- **测试**：smoke.mjs 改为断言两个 settings.section 注册 + 分别渲染两页
  （重试页：4 输入框/provider 状态/apply/restore；better-webui 页：提示音开关 +
  音量、且确认不含重试输入框/provider 列表）。
- 新增 locale 键 `retry.pageTitle` / `retry.pageDesc`（页标题/简介，独立于
  `retry.title`/`retry.desc` 卡片文案）。

**提示音卡重构**（用户反馈，同 v0.20 迭代）：`chime.enabled` 从「启用提示音」
改为「启动」、`chime.volume` 从「提示音音量」改为「调整音量」（en 对应
`Enable chime` / `Adjust volume`）；描述文本只在卡片大项下（`chime.desc`）出现
一次，子行不再重复。卡片由单行（标题+描述+开关+滑杆挤一行）改为**两行**：
`启动` 行 = 文本 + 开关，`调整音量` 行 = 文本 + 滑杆（复用 `.bwts-chimerow` /
`.bwts-volume`，删除不再使用的 `.bwts-chimerowdesc` 样式）。所有键均中英双语
（zh/en 各 26 键，键集一致，smoke 断言两行标题 + 无重复描述）。

### 12.8 v0.21：模型采样参数（modelparams 包，全局温度 + 输入框）

用户转向落地：按参考插件 `dsh-sampling-sliders` 形态做**全局配置 + 输入框 UI**
的最小版本；logprobs/penalty 显示「暂不支持（等上游）」（方案 A）。设计详见
design.md §11.5；这里记实现要点与坑。

- **新包** `packages/modelparams`（host + client），行 id `better-webui-modelparams`，
  设置命名空间 `better-webui-modelparams`（schema `{ enabled, temperature, mode }`），
  RPC 通道 `/better-webui-modelparams`（ping / read / apply / reset，Command 表）。
- **注入机制**：`agent/request` 拦截器（`ctx.on`，宿主级可收所有 agent）。返回
  `{ ...config, temperature }` 即可注入——全链路已核实（§11.1）。**只经此钩子注入
  temperature**；compaction / session-title 不走此钩子，不受影响。
- **会话级固定**（用户语义：新会话默认、会话内固定）：`Map<sessionId, temp|undefined>`
  按 `payload.agent.id` 键控。首请求（map miss）从 settings 解析 `enabled ? temp :
  undefined` 并钉住；后续请求复用钉住值（全局改不影响进行中会话）；`agent/disposed`
  清理。`applyTemperature` 只在 pinned 为数值时注入、从不剥离。
- **hot 模式**：开机清残留（`mode==='hot'` → 重置默认），与参考插件一致。
- **client**：`conversation.input.right` 常驻**数字输入框**（非滑杆）+ ▾ 面板
  （启用开关 / logprobs·penalty 标注「暂不支持（等上游）」/ 持久化·热调 / 应用·恢复
  默认 / 双语 20 键，键集一致）。`locale` 注册进 slot spec（occupant 收 `t`）。
- **v0.21 UX 迭代**（用户反馈后重做）：① 工具行只留一个「超参配置」按钮（`.bwm-btn`，
  有覆盖时 `data-active` 高亮），编辑全在面板；② 温度「留空 = 跟随模型默认，填写 =
  覆盖」，空输入用 placeholder「默认（留空跟随模型）」虚字提示；③ **恢复默认 =
  清空已保存配置**（温度回空）；④ 去掉逐参数说明与启用开关、hint/desc（高级设置）。
  schema 从 `{ enabled, temperature, mode }` 简化为 `{ temperature?, mode }`，
  写路径从 `mutate`（三字段）改为 **`settings.replace`**（`sectionOf` 只写有值键，
  温度空时整个键消失 → replace 落到 schema 默认 undefined = 清空）。RPC apply
  接受 `temperature: null`（清空）/ 数值（覆盖 0–2 夹取）。
- **v0.21 UX 二次微调**：① 数值框**隐藏上下箭头**（`.bwm-input` 加
  `::-webkit-outer/inner-spin-button{appearance:none}` + `-moz-appearance:textfield`，
  保留 `type="number"` 仅输入数字）；② **placeholder 直接写具体默认值**——
  host `read` 返回 `defaultTemperature`（`DEFAULT_TEMPERATURE`），客户端用
  `fmtTemp` 显示（`String(1.0)` 在 JS 是 `"1"` 会丢 `.0`，故 toFixed(2) 去尾零
  再补一位小数，得 `1.0`/`0.7`/`1.25`）；③ 语义一致化：拦截器把空解析为
  `DEFAULT_TEMPERATURE`（`stored === undefined ? DEFAULT : stored`），**wire 总
  是携带具体值**（不再有"不注入"状态）。
- **坑 1（RPC 双重包装）**：handler 表方法若返回 `{ ok, value }`，外层再包一次就
  变成双层——表方法必须返回**裸值**，外层统一 `{ ok, value }` 包装（参照 settings 包）。
- **坑 2（jsdom + React 18 number 输入事件）**：对 number 输入派发 `input`/keydown
  会触发 React 的 value-change polyfill 崩溃（"reading 'tag'"）。smoke 改为：
  用真实按钮驱动可测路径（空输入 + 应用 → `temperature:null`、恢复默认 → reset），
  填写→覆盖路径做源码级接线检查（`onChange: setTemp` / `raw.trim() === ''` /
  `api.apply({ temperature: temperature`），RPC 值语义由 host 测试覆盖。
- **client-envelope**：modelparams 的 apply 直接调用 `ctx.locale.bind`，envelope 的
  mock locale 需补 `bind`（settings 包是懒调用所以没暴露这个依赖）。
- **设置中心规则**（架构契约）：settings 包是设置面板承载包；只有需要被配置页配置
  的包才 detect 它（`ctx.get` 判空，装了经它注册、没装降级）。modelparams 本轮
  输入框 UI 不需要设置页，故不依赖。见 monorepo.md §4。

