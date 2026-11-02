# DSH Side Chat

独立的 DSH `/side` 侧边对话插件。源码、构建、测试和安装声明都在本目录内，不依赖原来的 Better Sidebar 包或源码目录。

支持 `/side`、`/side 问题`、主对话划词追问、上下文快照继承、多标签、独立选择模型与推理等级、流式 Markdown 回复、停止回复和关闭删除。只保留侧边对话相关代码。

## 文件入口

- `src/index.ts`：服务端插件入口与 HTTP/WebSocket 路由。
- `src/client/index.tsx`：客户端插件入口、原生标签、命令和划词入口。
- `src/client/SideChatPanel.tsx` 与同名 CSS：对话界面。
- `src/client/commands.ts`、`api.ts`、`store.ts`：命令、请求和线程状态。
- `src/sidechat-core.ts`、`sidechat-routes.ts`：上下文继承与子会话操作。
- `src/assistant-live.ts`、`sidechat-push.ts`：实时回复与增量推送。
- `src/context-types.ts`：仅包含侧边对话所用的宿主契约。

## 构建与安装

需要 Node.js 20+、pnpm 和兼容的 DSH 0.2.1-rc.1+。

```powershell
pnpm install --frozen-lockfile --registry https://registry.npmmirror.com
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm pack
$pluginPath = (Resolve-Path './dsh-side-chat-0.1.10.tgz').Path.Replace('\', '/')
dsh plugin --profile desktop add "file:$pluginPath"
```

把 `desktop` 换成实际使用的 profile。安装不会自动停用旧版同功能插件；应在目标 profile 停用旧的 `/side` 提供者，避免两个入口同时处理同一命令。

包名为 `dsh-side-chat`，原生标签 kind 为 `dsh-side-chat`，路由使用 `/side-chat/api/*` 与 `/side-chat/ws`。挂载只通过自己的 `cordis.patch.yml`，无需修改 DSH 源码。

构建后 `lib/index.js` 是完整服务端文件，`lib/client.js` 是完整客户端文件，`lib/client-registry.js` 供市场通道使用。DSH 的服务端与浏览器运行在不同环境，因此保留两个运行入口；源码另提供单个 ZIP 文件，便于整体保存。

## 验证

`pnpm test:browser` 使用已构建客户端、模拟宿主和确定性回复验证完整交互，并生成亮暗及窄屏截图。需要 Playwright Chromium，或设置 `SIDE_BROWSER_PATH` 指向本机浏览器。

`pnpm test:mount` 使用真实 DSH；运行前设置 `DSH_E2E_URL` 为隔离测试 profile 打印的带 token 地址，避免使用现有用户 profile 做冒烟测试。

输入框使用 DSH 原版的圆角、阴影、间距及发送按钮设计变量。模型和权限控件从宿主公开的 Slot 注册表复用原生组件，`1017` 等版本标识也由原版模型标签组件渲染。上下文继承冻结于打开时，模型与推理等级仅影响当前侧边对话。

“＋”菜单支持添加文件、图片和文件夹。DSH 桌面版可提供的本地文件与文件夹路径作为引用发送；图片及浏览器文件由宿主附件服务验证并接纳。最多 10 项，单个上传 8 MB、总计 16 MB。文件读取和消息只进入当前侧边对话。

侧边权限默认继承主对话。权限菜单与原版一致，完全权限和自动审查选项沿用原版风险确认，切换不会改动主对话。需要人工审批的侧边操作显示“允许一次／拒绝”，批准仅适用于该次请求，取消或关闭会撤销等待。选择原生自动审查模式时继续使用宿主的审查流程。

侧边对话是临时对话，每次关闭都会提示永久删除。确认后调用当前 DSH 已启用的 `dsh-delete-session` 永久删除事务，停止该侧边任务并清理其会话文件、索引及独占数据；共享的主对话数据不删除。清理成功才关闭标签，失败保留面板并提示重试。此存储适配需要 `dsh-delete-session` 插件；未启用时会明确报错，不会假装已删除。取消关闭保留内容。

来源与版权说明见 [NOTICE.md](NOTICE.md) 和 [LICENSE](LICENSE)。

侧边“＋”菜单包含文件、文件夹、目标、计划、模型、权限、压缩和下载日志，沿用原版图标、命令别名和右侧说明。目标支持查看、创建、编辑、暂停、继续和清除，全部通过当前侧边 agent 的原生目标服务操作。计划模式通过当前侧边的原生 `/plan` 命令进入或退出，计划审核与追问在该侧边单独显示并等待用户回答；切换不会修改主对话或其他侧边对话。

模型和权限打开当前侧边的原生控件；压缩只调用当前侧边 agent 的 `/compact`。日志 ZIP 包含 `conversation.md`、`session.jsonl` 和当前侧边新增消息引用的附件，排除主对话继承历史、边界快照和模型请求／压缩快照；不导出其他侧边会话。ZIP 为诊断与阅读用途，不是会话恢复包。关闭确认使用 DSH 原生模态窗口，默认聚焦取消，红色“删除并关闭”执行清理；会先取消侧边操作、停用目标的自动继续并撤回未回答的问题，再删除临时会话。
