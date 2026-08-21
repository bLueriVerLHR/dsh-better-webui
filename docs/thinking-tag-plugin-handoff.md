# 交接文档：思考区识别修复（llm/stream 插件方案）

> 目的：把调查结论、真实证据、插件设计、以及需要拍板的取舍写清楚，交给一个**没有本对话上下文**的插件智能体，让它能独立完成插件实现。
> 日期：2026-08-21 · 环境：DeepSeek Harness（dsh `0.1.0-rc.7`）· 默认模型：`scnet` / `DeepSeek-V4-Flash-0731` / Anthropic Messages 协议

---

## 1. 现象（用户报告）

用户在使用 dsh Web GUI 时发现：**模型明明在思考，但"Think"思考区是空的**，思考内容泄漏到了可见正文里，而且正文里还出现**字面的 XML 标签**（用户原话：` response`），看起来像脏输出。

具体例子（真实会话日志 `--home-archie-forge--/2f060382.../session.jsonl.zstd` seq 33041 的 text 块，原始字节已确认）：

```
Let me review the complete diff.  responseSensitive-word scan: zero hits. Let me review the complete diff...
```

即：`[思考/推演文本]` + ` response`（闭合标签）+ `[干净可见回复]`，全部挤在**同一个可见 text 块**里，同时该消息的 `reasoning` 块是**空的**（长度 0）。

## 2. 调查结论（已用真实数据证实）

### 2.1 两个并存的现象，同一根因

1. **scnet 代理在 Anthropic 通道里大量发送"空 thinking 块"声明**：
   - 本会话（`--home-archie-forge-dsh-fix--/session-0bb4c9bb...`）统计：**63 次 reasoning block-start，只有 12 次（19%）收到任何 reasoning-delta，51 次（81%）从线上就是空内容**（无孤儿 delta，0 丢失——DSH 没丢任何东西，是上游没发）。
   - 用逐步骤状态机重放 chunk 流验证过：空块对应的 `block-start(reasoning) → block-end(reasoning)` 之间**一个 `reasoning-delta` 都没有**。

2. **模型的实际思考文本（含字面 XML 标签）落在了 text 通道**，成为可见正文：
   - 全库 46 个会话扫描，真实字面标签计数：
     - ` response`（`<`+`/`+`think`+`>`，闭合，无 "ing"）：**280 次** ← 主导标记
     - ` thinking`（`<`+`think`+`>`，开头，无 "ing"）：36 次
     - `<thinking>`（开头，带 "ing"）：43 次
     - `</thinking>`（闭合，带 "ing"）：45 次
   - 消息级命中（text 块里真实出现）：**396 处**，遍布用户所有真实工作会话（forge、better-webui、coteam 等），非个例。

**根因一句话**：scnet 的 Anthropic 兼容代理没有把模型的思考抽进 thinking 通道（只发空 thinking 块），模型把"思考 + ` response` 标签 + 干净回复"整段写进了 text 通道。DSH 忠实渲染了 text 通道 → 空 Think 行 + 泄漏的思考正文 + 字面标签全部可见。

### 2.2 标记的精确形态（关键！）

- **主导闭合标记是 ` response`**，不是英文单词 "response"，也不是 `</thinking>`。
  字节序列：`3c 2f 74 68 69 6e 6b 3e` = `<` + `/` + `t` `h` `i` `n` `k` + `>`（8 字节，中间没有 "ing"）。
- **开头标记是 ` thinking`**（`<`+`think`+`>`）或 `<thinking>`。
- 闭合标记（` response`）**远多于**开头标记（280 vs 36/43），且**开头标记常缺失**（scnet 可能剥掉了一部分）。因此探测应**以闭合标记 ` response` 为主**，向前取"思考文本"。
- ⚠️ 陷阱：之前多次搜错是因为（a）搜英文单词 "response"（大量误报，且标签里根本没有这个词）；（b）内联 shell/python 引号转义 bug。**必须用字面字节序列匹配**（如 `chr(60)+'/think'+chr(62)` 或直接写 `" response"`），并写成文件脚本测试，避免内联引号地狱。
- 用户明确：**"这个配对不应该在 ` 符号内"**——即标签若出现在反引号代码段 / 代码块 / 字符串字面量内部，**不应视为标记切分**（避免误伤代码）。

## 3. 修复方案（纯插件，不碰 DSH 源码）

### 3.1 为什么必须用插件

- dsh 会更新覆盖安装目录，任何对 `node_modules` 源码的 patch 都会被冲掉（`dsh-fix` 仓库现有机制是 patch `dsh-terminal-bash`，但那是一次性的，dsh 升级就失效）。
- 用户明确要求：**不修改源码、通过插件完成、dsh 升级不覆盖**。

### 3.2 钩子：Host 端 `llm/stream` waterfall 事件

这是**关键发现**——DSH 提供且唯一合适的中断点：

```
'llm/stream'(this: LlmRuntime, options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk>
```

- **waterfall 模式**，包裹**每一次**流式模型调用（重试 / 重放 / 路由都经过它）。
- 监听器签名：`(options, next)`，`next()` 返回下游原始 chunk 流（`AsyncIterable<StreamChunk>`）。
- 监听器可返回自己的 `AsyncIterable`（把 `next()` 的流包一层转换器），或 `return next()` 放行。
- **在流层转换 = 数据、会话日志、轨迹、流式 UI 全部一致**，一处修复全链路生效。

### 3.3 `StreamChunk` 协议（转换器必须遵守）

```ts
type StreamChunk =
  | { type: 'block-start'; index: number; blockType: 'text'|'reasoning'|'tool-call'|... }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: CallId; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: ContentBlock }  // block = {type:'text',text} | {type:'reasoning',text} | {type:'tool-call',...}
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'finish'; reason: FinishReason; replayState?: ReplayEnvelope }
```

关键约束：
- **索引一致性**：每个块用同一个 `index` 贯穿 `block-start → deltas → block-end`；块之间 index 不能复用（装配器 `BlockAssembler` 按 index 聚合、按**首见顺序**排列，所以 index 不需要严格 0,1,2…，只要自洽且不撞）。
- **必须成对**：`block-start` 和对应 `block-end` 都要发（或都不发）；不能只发半个块。
- `block-end` 携带组装好的块本体（如 `{type:'reasoning', text: ...}`）。
- `usage` / `finish` 原样透传；`replayState.blocks` 数组与发出的块数一一对应——**若增删块导致长度不匹配，replay 会自动降级**（该消息不再走 replay，可接受，但要知晓）。

### 3.4 转换器状态机（每次模型调用一个实例）

目标：把 `[思考文本] response [干净回复]` 切分成 `reasoning` 块 + `text` 块。

```
状态：
  probing = false            // 是否在探测标记
  buf: string[] = []         // 缓冲的 text-delta 片段
  bufIndex                    // 被缓冲的 text 块的 index
  emittedReasoningIndex       // 切分后思考块用的新 index
  emittedTextIndex            // 切分后回复块用的新 index
  sawMarker = false

逐 chunk：
  'block-start'(text, idx):
      探测模式下 → 记录 bufIndex=idx，暂不转发（等决定）
      否则 → 原样转发
  'text-delta'(idx):
      probing 且 idx==bufIndex → 追加到 buf，并拼接检测标记
          找到闭合标记（` response` 或 `</thinking>`，且不在代码段内）：
              marker = 标记前的文本，reply = 标记后的文本
              发: block-start(reasoning, R) / reasoning-delta(R, marker) / block-end(R, {reasoning, marker})
              发: block-start(text, T) / text-delta(T, reply) / block-end(T, {text, reply})
              恢复 probing=false，清 buf
          未找到 → 继续缓冲
      否则 → 原样转发
  'tool-call-delta' / 'block-start'(tool-call) / 'block-end'(text) / 'finish':
      probing 且 buf 非空且没找到标记 → 整段按 text 原样放行（发 block-start(text) + text-deltas + block-end），探测结束
  'usage' / 'finish' → 原样透传（finish 前若有未决缓冲，先按上一条 flush）
```

要点：
- **空 reasoning 块处理（清除 / 与后续合并）**：上游的空 `block-start(reasoning)` + `block-end(reasoning, '')` 不再原样转发——要么**清除**（整对不发射，UI 不出现空 Think 框），要么**与紧随其后的 reasoning 块合并**成一个有内容的块（详见 §3.7）。这是独立于标记探测的、总是生效的清理。
- **流式延迟取舍**（见 §4 取舍 2）：探测模式下缓冲会导致这段文本不实时显示。推荐"缓冲到第一个 tool-call 边界或块结束/流结束"。
- **代码段保护**：匹配时维护一个"是否在反引号/代码块内"的轻量状态（见 §4 取舍 1）。

### 3.5 作用域限定

`options` 有 `provider` / `model` / `purpose`。建议：
- 只对 `provider === 'scnet'`（或可配置的 provider 列表）启用转换；
- `purpose` 为 `'compaction'` / `'session-title'` 的辅助调用**不**转换（保持原样）；
- 其余 provider 直接 `return next()`。

### 3.6 插件代码骨架（Host 半，无 Client）

```js
return {
  apply(ctx) {
    // llm/stream 是 host 级事件；用 ctx.on 挂 waterfall
    ctx.on('llm/stream', (options, next) => {
      if (options.provider !== 'scnet') return next()           // 或可配置
      if (options.purpose) return next()                        // 辅助调用不转换
      const raw = next()
      return transformStream(raw)                               // async generator 包装
    })
  },
}
```

### 3.7 空 think 块处理（清除 / 与后续合并）——用户明确要求的补全功能

**背景**：上游 scnet 大量声明"空 thinking 块"（§2.1：81% 的 reasoning 块自
`block-start` 起一个 `reasoning-delta` 都没有，`block-end` 携带空文本）。webui 对每个
reasoning 块渲染一个 Think 折叠框 → 一条消息里可能出现"多个空 Think 框"或
"空 Think 框 + 后续有内容的 Think 框"并存，都是视觉噪声。

**目标**：空 think 块不以"空框"形式存在——要么**清除**，要么**与紧随其后的 think 块
合并**成一个。二者择一即可满足用户要求，推荐下面的"合并优先、清除兜底"统一规则。

**统一规则（推荐）**：

- reasoning 块在 `block-end` 时若累计文本为空（自 `block-start` 起没收到任何
  `reasoning-delta`），**不转发**它的 `block-start`/`block-end`，先挂起
  （记入 `emptyPending`），等待后继。
- 若紧接着（中间没有 text / tool-call / finish）出现**另一个 reasoning 块**且最终
  有内容：**合并**——两个块合成一个 reasoning 块（空块内容 `''` + 后继内容），只发
  一个 `block-start → reasoning-deltas → block-end`（§3.3 协议约束照旧：成对、索引
  自洽；建议用后继块的 index 或独立新索引）。
- 若紧接着出现非 reasoning 块（text / tool-call / usage / finish / 流结束）：
  **清除**——挂起的空块整对不发射，消息里不出现空 Think 框。
- 连续多个空块同理：要么全部并入首个有内容的后继块，要么全部消失。
- 有内容的 reasoning 块**从不被清除、也互不合并**——"只要该消息有思考内容，就有且
  只有一个 Think 框"由本规则天然保证；相邻的两个有内容块保持为两个框，不额外合并。

**与现状（lib/index.js / README）的关系**：早前实现是"reasoning 块**始终转发**（含空）
以保证 Think 折叠框存在"（README「保留折叠框」），与本功能**相反**。本功能已落地到
`lib/index.js`（v0.11+，见 §6 的实现记录）：空框是噪声，清除或合并。若担心"整条消息
全空导致无框"——那正是期望（无思考则无框）；只要有内容的块在，框就不会消失。

**状态机增量**（在 §3.4 的 `pendingReasoning` 机制上扩展）：

```
'block-start'(reasoning, i):   记录槽位，不转发 start（与现状一致）
'reasoning-delta'(i):          有内容了 → 若 emptyPending 非空先消化合并，
                               再转发 block-start（首次）与 delta
'block-end'(reasoning, i):
    若本块已转发过 start（有内容）→ 转发 block-end，结束
    否则（空块）→ 不转发，挂入 emptyPending，等待后继
text/tool-call/usage/finish 到达时：
    若 emptyPending 非空：
        后继若是 reasoning 且将有内容 → 合并（后继块的 start 即合并块的 start）
        否则 → emptyPending 整批清除（不发射任何块）
```

注意：**空块的 `block-start` 绝不能提前转发**（一旦发出就无法收回）。这正是现实现
（在 `block-end` 时才补发 start）必须改动的地方——空块路径改为"不发 start、
挂起、等后继"，而非"补发 start 保持折叠框"。

## 4. 担忧与取舍（需要用户/插件智能体确认）

### 取舍 1：标记匹配形态与代码段保护
- 建议默认匹配全部 4 种变体：` response`、` thinking`、`</thinking>`、`<thinking>`（用字面字节，正则可选）。
- 用户说"配对不应在 ` 符号内"：**当标签处于反引号代码段 / 代码块（``` fenced block ```）/ 行内代码内时不切分**。实现需要轻量的代码段状态机（统计未闭合反引号、``` 围栏 ```）。这是防误伤的关键，但会增加复杂度——**需要确认这个保护是必须的**（因为 280 次命中里可能有部分是代码里的字符串）。

### 取舍 2：缓冲策略（流式延迟 vs 探测完整性）
- 探测逻辑本质要求"把可能是思考的前缀文本先攒着"，等到看见 ` response` 才决定归属 → **这段文本不实时流式显示**。
- 真实数据：` response` 前的思考文本通常不长（几十~几百字符），且**后面几乎总跟 tool-call**（agent 循环）。
- 推荐：**缓冲到第一个 tool-call 边界 / 块结束 / 流结束**再 flush（贴合数据，短叙述无感）。
- 备选 A：**有界窗口**（如缓冲前 N=2000 字符，无标记即放弃探测、实时放行）——不延迟长回复，但可能漏掉"思考很长才写 ` response`"的情况。
- 备选 B：只做"丢弃空 reasoning 块"，不做标记切分——最稳，但不恢复思考。

### 取舍 3：持久化路径
- **动态插件**（`cordis_define` + `cordis_run`，进程内）：立即验证效果，重启失效。
- **预设插件**（写进 `~/.dsh/.agent-presets/<id>/agent.cordis.yml`）：dsh 升级不覆盖，长期生效；但 `llm/stream` 是 host 级事件，预设里挂的监听器是否对所有会话生效需要实测验证。
- 建议顺序：**先动态插件验证 → 验证 OK 落成预设插件**。

### 取舍 4：空 think 块的清除 vs 合并（§3.7 的两条路径）
- **清除**：空 reasoning 块整对（`block-start`+`block-end`）不发射。最简单、零延迟
  （在 `block-end` 到来时即可决定），代价是"空框 + 后续内容框"并存时仍会看到
  **两个框**（空框消失、内容框单独显示）——视觉上仍是分裂的两段思考。
- **合并**：空块与紧随其后的 reasoning 块合成一个（内容拼接；空块内容为空，合并
  结果即后继内容）。视觉上"一条消息一个连续 Think 框"；代价是空块的 `block-start`
  必须**挂起延迟到确定后继才发射**，多一点点流式复杂度。
- 真实数据下两者结果几乎相同（空块后面几乎总跟着切分出来的思考块，见 §3.7）；
  **推荐合并优先、清除兜底**：相邻 reasoning 块合并，合并后仍空的块清除。
- ✅ 已实现（lib/index.js v0.11+）：本功能推翻了"空块也保留"的旧默认。若担心"整条
  消息全空导致没有 Think 框"——注意合并规则只在有内容的块存在时才保留框，全空则无
  框，这是用户期望的（空框是噪声）。

### 担忧 D：replay 一致性
切分会增删块（空 reasoning 块清除/合并、一个 text 块切成 reasoning+text）。
`finish.replayState.blocks` 的条目数会与新块数不一致 → replay 自动降级为重新请求。
可接受，但要在设计里知道并说明。

### 担忧 E：转换器正确性
- 块索引必须自洽（§3.3）。建议用**独立的新索引**（如从 1000 开始）给切分出的 reasoning/text 块，避免与上游 index 冲突。
- 上游 `block-start(text)` 在探测模式下被"暂存"；若最终决定不切分，要把暂存的 block-start + 缓冲的 text-deltas + block-end 按原顺序完整放出，不能丢。
- 边界：`response` 后紧跟空串、多个 ` response` 连续出现、` response` 出现在块最末尾等，都要有确定行为（建议：只在第一个"带内容的"闭合标记处切分；标记后为空则整段按思考处理，不产生空 text 块）。

### 担忧 F：作用域误伤
- 只对目标 provider + 非辅助调用生效，其余放行（§3.5）。
- 转换是纯增量（不改 token 数语义、不改工具调用参数），不应影响 usage 统计正确性。

## 5. 参考（代码位置）

- 事件签名：Host Event `llm/stream`（可用 `cordis_inspect_query` 查 `Event.listEvents`，`{event:'llm/stream'}`）
- `llm` 服务：`Service.listService` → `{service:'llm'}`，`stream(options)` 返回 `AsyncIterable<StreamChunk>`
- `StreamChunk` / `ContentBlock` 类型：`@deepseek-ai/dsh-llm/lib/types/types.d.ts`
- 装配器（印证索引语义）：`@deepseek-ai/dsh-llm/lib/types/assembler.js`
- 上游翻译链（证明空 thinking 块来自 pi-ai→dsh 翻译）：`@deepseek-ai/dsh-llm-pi-ai/lib/index.js`（`thinking_start/end` → `block-start/end(reasoning)`）
- Anthropic 适配器（请求端发 `thinking:{type:"enabled",budget_tokens,display}`；响应端 `thinking` 块 → `thinking_start/end`）：`@earendil-works/pi-ai/dist/api/anthropic-messages.js`
- 会话日志证据：`~/.dsh/sessions/**/session.jsonl.zstd`（用 `unzstd -c` 解压，JSONL；`assistant/chunk` = 流式块，`assistant/message` = 最终消息）

## 6. 建议的下一步

> **实现状态（2026-08-21）**：本方案已落地到 `lib/index.js`（thinking-tag splitter，
> 含 §3.7 空块清除/合并）。最小可用版（scnet 限定 + 空块清除/合并 + ` response` 切分
> + 缓冲到 tool-call 边界）已实现并有 `tests/splitter.mjs` 覆盖。剩余步骤：

1. 插件智能体先**读本文档 + §5 的参考代码**，用 `cordis_inspect_list`/`cordis_inspect_query` 确认 `llm/stream` 契约。
2. 用一条真实会话（如 `2f060382...` seq 33041 那种含 ` response` 的）构造或复现输入，验证切分正确、**空 reasoning 块被清除或与后继思考块合并（消息里不残留空 Think 框）**、块协议合法、replay 降级可接受。
3. 验证 OK 后，把同一段代码落成**预设插件**（`~/.dsh/.agent-presets/`），并说明重启/新建会话的生效条件。

---
*交接完毕。插件智能体应以本文件为唯一依据，遇到不确定处优先查 `cordis_inspect_*` 与 `@deepseek-ai/dsh-llm` 的类型定义，不要臆测 API。*
