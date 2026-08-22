# better-webui monorepo 拆分架构（v0.14）

> 本文记录把单一大插件拆成"元包 + 功能小包"的架构、设计模式应用、风险隔离
> 与维护规则。机制背景见 [dev-notes.md](dev-notes.md)，历史决策见 [design.md](design.md)。

---

## 1. 为什么拆

原 v0.13 是一个 npm 包、一个 Cordis 行、一个 `apply()`、一个 client bundle，
五个功能耦合在一起。坏处：

| 耦合 | 具体表现 |
|---|---|
| **单点失败** | 宿主 `inject: ['connection','sessionPersistence','workspaceRegistry']`——推理补齐与卡顿卫士本不需要这三个服务，但缺任何一个，**整个宿主 half 挂起**，五个功能全不上 |
| **同生共死** | 一个 `apply()` 里任何未捕获异常 = 五个功能一起消失（靠 try/catch 硬扛） |
| **粗粒度热加载** | 改归档页面会连提示音代码一起 reload；两份客户端共用一份 DICT 和一个 style 标签 |
| **无法按需安装** | 只要归档 + 提示音的纯客户端部署也得装整个包 |
| **测试耦合** | 一个 smoke.mjs 同时测归档 UI 和提示音 |

拆分后每个功能是**独立 npm 包 + 独立 Cordis 行 + 独立 apply + 独立 client bundle**，
互不等待、互不拖累、可单独安装。

---

## 2. 布局

```
dsh-better-webui/                        # 元包 @blueriverlhr/dsh-better-webui（Facade，无自身代码）
  package.json                           # dependencies → 6 个小包（file:）
  cordis.patch.yml                       # 聚合 patch（GENERATED，勿手改）
  build.mjs                              # 组合构建：逐包 build + 重生成全部 patch
  scripts/
    build-package.mjs                    # Template Method：每包的 src→lib 管线
    patch-emitter.mjs                    # patch YAML 发射器（受控形状，无需 yaml 依赖）
    compose-patch.mjs                    # Composition Root：聚合各包 patch 源
  packages/
    archive/       host + client         归档会话管理（RPC 通道 /better-webui + 设置页）
    reasoning/     host                  推理等级补齐（settings 服务）
    chime/         client                会话活动提示音（dock；音量/开关在 better-webui 设置页）
    search/        host                  Exa 搜索 provider（含 web 行覆盖）
    bashguard/     host                  持久化 bash 卡顿卫士（tools/execute 守卫）
    settings/      host + client         可配置重试策略 + better-webui 专属设置页（RPC /better-webui-settings）
  tests/
    support/                             共享 jsdom 测试骨架（client-harness / primitives-stub）
    composition.mjs                      patch 组合守卫
    client-envelope.mjs                  client 包信封检查（参数化）
    run-all.mjs                          全部测试运行器
```

---

## 3. 设计模式映射

| 模式 | 落地 |
|---|---|
| **Facade（外观）** | 元包是唯一面向用户的入口：装一个包 = 五个功能全有；内部结构对用户隐藏 |
| **Composition Root（组合根）** | `scripts/compose-patch.mjs` 是唯一把各包 patch 源聚合的地方，产出元包聚合 patch；单一真源、两处产物永不漂移 |
| **Single Responsibility（SRP）** | 一个功能一个包；每包只声明自己真需要的服务（可选服务一律 `ctx.get` 能力探测） |
| **Open/Closed（开闭）** | 加新功能 = 新增一个包 + 在 `compose-patch.mjs` 的 `FEATURES` 加一行；已有包零改动 |
| **Template Method（模板方法）** | `scripts/build-package.mjs` 定义统一的 `src→lib` 管线（host 复制 / client 信封包裹 / lib 先清空保证幂等），各包只声明自己的 src |
| **纯函数决策核心（Strategy）** | bashguard 的 `updateStallStrikes`、chime 的 `lastTurnOutcome` 都是无副作用的纯函数，可脱离运行时单测；搜索的匿名 MCP / REST 双路径是策略切换 |
| **依赖倒置 / 能力探测** | 可选服务经 `ctx.get(name)` 读取并判空，缺了只跳过该功能（warning），绝不拖死整包；硬依赖才进 `inject` |
| **Command 派发** | archive 的 RPC 方法表（`table[endpoint]`）是命令分发表，新增方法只加一个键值对 |

---

## 4. 每包契约

| 包 | main (host) | ./client | dsh.client | 服务依赖 | patch 贡献 |
|---|---|---|---|---|---|
| archive | `lib/index.js`（RPC 通道） | ✓ 设置页 | platform web | inject: connection/sessionPersistence/workspaceRegistry；可选 sessions/agents | 1 行 |
| reasoning | `lib/index.js`（provision 任务） | — | — | 可选 settings + ctx.root 事件 | 1 行 |
| chime | `lib/index.js`（空 apply） | ✓ dock | platform web | inject: slots/locale | 1 行 |
| search | `lib/index.js`（provider 注册） | — | — | 可选 web | 1 行 + **web 行 searchProvider 覆盖** |
| bashguard | `lib/index.js`（waterfall 守卫） | — | — | 可选 agentPresets/terminals | 1 行 |
| settings | `lib/index.js`（RPC 通道 + 设置命名空间） | ✓ 设置页 | platform web | inject: connection/settings | 1 行 |

**跨包约束（不能破坏，否则 HMR/挂载异常）：**

- **行 id 全局唯一**：`better-webui-archive` / `-reasoning` / `-chime` / `-search` /
  `-bashguard` / `-settings`。不要重复使用。
- **插槽 id 全局唯一**：archive 用 `better-webui-archive`（settings.section），
  chime 用 `better-webui-notify`（conversation.input.dock），settings 用
  `better-webui-settings`（settings.section）。
- **locale NS 独立**：archive 用 `better-webui-archive`，chime 用 `better-webui-notify`，
  settings 用 `better-webui-settings`。
- **style 标签 id 独立**：archive 用 `better-webui-style`，chime 用
  `better-webui-notify-style`，settings 用 `better-webui-settings-style`
  （HMR 按标签认领）。
- **RPC 通道唯一**：archive 用 `/better-webui`，settings 用 `/better-webui-settings`，
  各自带 `WIRE_VERSION` 握手。
- **localStorage 键保持稳定**：`better-webui:notify:enabled` / `:volume` 拆分后
  不变，老用户的设置不丢（chime 读、settings 页写，同一份键契约）。
- **client 跨包值导入被禁**：client half 只能 require 平台静态表；不引用兄弟包。
  settings 页的提示音卡与 chime 通过**同键字符串**（非导入）共享，属稳定的跨包
  值契约。

---

## 5. patch 组合规则

- **单一真源**：每个包的 `cordis.patch.js`（default export 数组）是该包行的唯一
  来源。`npm run build` 用它生成该包的 `cordis.patch.yml`（独立安装层）与根
  `cordis.patch.yml`（聚合层）。
- **聚合顺序**：`compose-patch.mjs` 的 `FEATURES` 数组决定元包 patch 的行顺序
  （加载顺序由服务可用性决定，行序无加载语义，仅可读性）。
- **守卫测试**：`tests/composition.mjs` 断言提交的每个 patch 与源逐字节一致，
  手改 patch 或忘记重建都会 CI 失败。
- **web 行覆盖归属**：`searchProvider: exa` 是 profile 级布线（改整个 web seam），
  随 search 包走——装了 search 才切，不装保持默认。

---

## 6. 安装语义（装大包 = 装小包）

1. profile `dependencies` 只声明**元包**，bundles 只列**元包**。
2. 元包 `dependencies` 指向 6 个小包；pnpm 把它们平铺进 `profiles/<name>/node_modules`。
3. 元包聚合 patch 插入 6 行，每个 `name` 是小包 → Loader 与 client-modules registry
   从 profile baseUrl 解析到小包，host half 与 browser half 各自挂载。

**关键坑**：pnpm 对 `link:` 依赖只软链、不装其传递依赖；必须用 `file:`（本地）或
版本号（发布后）。见 README「安装」。

**不要双重安装**：元包与个别小包同装会重复插入同一行 id → 同一插件挂载两次。
装元包或装小包，二选一。

---

## 7. 维护规则

**用户要求（2026-08）**：新功能尽量以子模块（独立小包）形式添加，不要写进某个
现有包内部——保持每包单域、互不干扰。以下规则为此服务：

- 加功能：**新建 `packages/<name>/`**（package.json + src + cordis.patch.js + tests），
  在 `compose-patch.mjs` 的 `FEATURES` 加名字，`npm run build` 后提交。
  不要把新功能塞进现有小包的 `apply()`——那会重新引入单点失败与粗粒度热加载。
- 小功能（十几个 token 的 helper）先放进宿主共享脚本或直接在功能包内联，
  不单独建包；**一个可独立安装/独立失败的功能单元**才值得一个子模块。
- 改功能：只改对应包；测试只跑该包或 `npm test`。
- 提交前 `npm test`；`cordis.patch.yml` 与 `lib/` 是构建产物但**提交进 git**
  （消费者不做构建，靠提交的产物安装）。
- 版本：各包与元包同版本（当前 0.19.0）保持锁步，简化发布。

---

## 8. 验证

- `npm run build`：6 包 lib/ + 全部 cordis.patch.yml 重新生成。
- `npm test`：10 个测试脚本（archive host/smoke、reasoning、chime、search、
  bashguard、settings host/smoke、composition、client-envelope）全绿。
- `dsh --profile web --dump-config`：确认 composed 树含 6 行 + `searchProvider: exa`。
