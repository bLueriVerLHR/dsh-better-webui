# @blueriverlhr/dsh-better-webui-chime

会话活动提示音（client only）：当前打开的会话里，agent **开始等待用户输入**、
**完成一个回合**或**回合失败**时，播放一段合成的提示音（**只响铃、不弹窗**）。
`conversation.input.dock` 条目（id `better-webui-notify`）在状态跳变时触发；纯客户端
——localStorage 持久化，无 host 依赖、无重启。

- **等待输入**：`ask_user_question` 提问 / 等待审批 / 方案评审时，播放下降双音
- **任务完成**：agent 由运行转为空闲、无待处理交互且正常产出答复时，播放上升三音
- **回合失败**：模型重试耗尽 / 硬错误 / 输出上限截断导致回合终止时，播放低沉双音
  （与完成音区分，绝不把失败报成完成）
- 用户手动**停止**的回合不提醒

**设置**：开关与音量**不在本包**——由 `@blueriverlhr/dsh-better-webui-settings` 的
「设置 → better-webui」页渲染（提示音卡内「启动」开关 +「调整音量」滑杆 0-100，
0 静音；音量滑块**拖动中不响、松手时才试听一次**）。两包共享**同一组 localStorage
键**，设置改动刷新页面即生效，无需重启。

实现要点：

- 检测订阅输入区 `conversation.input.dock` 的 ConversationSnapshot（`pending` /
  `running` 状态跳变），只在跳变时触发，不随每次渲染重复响
- 回合结束时按**结尾节点类型**（`assistant` / `turn-error` / `turn-max-tokens` /
  `interrupted`）路由到完成音 / 错误音 / 静音——模型重试期间的 `running` 保持 true
  不会误响，重试耗尽失败只响错误音
- 声音用 **Web Audio API 合成**（正弦振荡，无音频文件、无需构建资源）；在首次用户
  交互时解锁音频上下文，规避浏览器自动播放策略
- 不覆盖任何原生 UI

- 服务依赖：`slots`、`locale`
- localStorage 键：`better-webui:notify:enabled` / `better-webui:notify:volume`
  （稳定，勿改名，避免老用户设置丢失）

独立安装：把 `@blueriverlhr/dsh-better-webui-chime` 加进 `dsh.profile.bundles`
并声明依赖（见根 README「按需安装」）。更常见的做法是装根元包一起带上。
