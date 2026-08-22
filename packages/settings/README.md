# @blueriverlhr/dsh-better-webui-settings

better-webui 专属设置页（纯客户端）：注册「设置 → better-webui」页
（`settings.section`，id `better-webui-settings`，order 25，在「Agent 预设」与
「重试策略」之间），集中管理 better-webui 的功能偏好，不混入 dsh 自身设置分区。

v0.21 起重试策略已拆去独立包 `@blueriverlhr/dsh-better-webui-retry`
（独立「重试策略」页，RPC `/better-webui-retry`）；本包**只保留会话提示音卡**。

- **会话提示音卡**：描述文本放在卡片大项下，卡内两行功能项——「**启动**」
  （开关，启用/停用提示音）与「**调整音量**」（滑杆 0-100，0 静音）。
  纯客户端 localStorage（键 `better-webui:notify:enabled` / `:volume` 不变，
  老用户设置不丢），chime 包的播放逻辑继续读这两个键。无需重启。
- 纯客户端，**无宿主数据、无 RPC**；host half 是空 apply（行需要包入口）。
- 独立 locale NS（`better-webui-settings`）与独立 style 标签
  （`better-webui-settings-style`）。

独立安装：把 `@blueriverlhr/dsh-better-webui-settings` 加进 `dsh.profile.bundles`
并声明依赖（见根 README「按需安装」）。更常见的做法是装根元包一起带上。
