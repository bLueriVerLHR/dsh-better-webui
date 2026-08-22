# @blueriverlhr/dsh-better-webui-chime

会话活动提示音（client only）：`conversation.input.dock` 条目在 agent 等待输入 /
完成任务 / 回合失败时播放合成提示音（只响铃不弹窗），`settings.general.item`
行提供开关 + 音量滑块。纯客户端——localStorage 持久化，无 host 依赖、无重启。

- 服务依赖：`slots`、`locale`
- localStorage 键：`better-webui:notify:enabled` / `better-webui:notify:volume`
  （稳定，勿改名，避免老用户设置丢失）
