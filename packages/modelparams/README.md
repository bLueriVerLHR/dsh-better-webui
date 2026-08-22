# @blueriverlhr/dsh-better-webui-modelparams

模型采样参数控制（host + client）：输入区（`conversation.input.right`，composer
工具行、发送键前）放一个**「超参配置」按钮**，点击弹出面板编辑。语义：**每个新
会话取默认值，会话内固定**。

## 功能

- **温度（temperature）**：可用。**数值留空 = 跟随模型默认，填写 = 覆盖**；
  空输入用虚字（placeholder）提示默认。经官方 `agent/request` 钩子注入
  （新会话首请求解析「留空 ? 跟随默认 : 全局温度」，按会话钉住并保持固定；
  `agent/disposed` 清理会话态）。零 dsh 源码修改，与重试/推理补齐同层的官方
  扩展点。
- **logprobs / penalty**：面板中显示「**暂不支持**」——harness 请求词汇表与两个
  adapter 均无这些字段，唯一的出路是 pi-ai 0.84 的 `samplingParams` 透传（等
  `dsh-llm-pi-ai` 升级采用，见 [docs/design.md](../docs/design.md) §11）。高级
  设置不逐项加说明，悬停行有原因提示。
- **恢复默认**：**清空已保存的覆盖配置**（温度回到留空/默认）。
- **生效方式**：`持久化`（写入 settings.yaml，重启仍在）或 `热调`（本次运行生效，
  开机清除残留）。
- **双语**：zh / en 两套文案，键集一致。

## 机制

- Host（`src/host.js`）：注册 `better-webui-modelparams` 设置命名空间（schema
  `{ temperature?, mode }`，temperature 空 = 不覆盖）+ RPC 通道
  `/better-webui-modelparams`（ping / read / apply / reset，写用 `replace`
  清空）+ `agent/request` 拦截器（会话级钉住温度）+ `agent/disposed` 清理 +
  boot 热调残留清除。
- Client（`src/client.bundle.js`）：`conversation.input.right` 单个「超参配置」
  按钮 + 弹层面板（温度输入框 / 暂不支持行 / 持久化·热调 / 应用·恢复默认），
  经 RPC 与宿主通信。

- 服务依赖（硬）：`connection`、`settings`
- wire 版本：`WIRE_VERSION = 1`（host）与 `WIRE = 1`（client）必须一致

独立安装：把 `@blueriverlhr/dsh-better-webui-modelparams` 加进 `dsh.profile.bundles`
并声明依赖（见根 README「按需安装」）。更常见的做法是装根元包一起带上。
