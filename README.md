# better-webui

DeepSeek Harness Web GUI 体验增强插件（out-of-tree bundle）。

## 功能
1. 两步删除：首次删除置灰并排到末尾（可恢复），第二次删除真实删除。
2. 工具输出：默认折叠，可展开、复制、新标签页查看，超长可截断。
3. 分支会话树：从任意用户消息处分叉新会话，侧栏树形展示且重启后恢复。

## 安装
```sh
pnpm build
dsh plugin --profile web add /path/to/better-webui
```

## 开发
```sh
pnpm install
pnpm build
pnpm run dev:web   # harness 侧热更新验证
```
