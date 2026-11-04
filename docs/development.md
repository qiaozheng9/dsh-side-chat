# 开发与验证

[返回项目首页](../README.md) · [English overview](../README.en.md)

## 环境与构建

需要 Node.js 22+、pnpm。完整运行环境为 Windows DSH Desktop 0.2.1-rc.5；关闭后的永久清理还需要安装并启用 [dsh-delete-session](https://github.com/qiaozheng9/dsh-delete-session#安装)。

```powershell
git clone https://github.com/qiaozheng9/dsh-side-chat.git
cd dsh-side-chat
pnpm install --frozen-lockfile --registry https://registry.npmmirror.com
pnpm build
pnpm pack
```

安装自行构建的包：

```powershell
$pluginPath = (Resolve-Path './dsh-side-chat-0.2.3.tgz').Path.Replace('\', '/')
dsh plugin --profile desktop add "file:$pluginPath"
```

重启 DSH。使用其他 profile 时替换 `desktop`，但当前完整运行范围仍以首页声明为准。

## 检查

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm check:consumer-types
pnpm test:browser
```

`test:browser` 验证构建产物的原生工厂挂载契约：独立 SessionProvider、原生输入机、多标签、划词和关闭清理。模拟宿主不冒充 DSH UI；原生界面、时间/用量、增量流式、菜单和删除隔离另用真实安装验证。需要 Playwright Chromium，也可以设置 `SIDE_BROWSER_PATH` 指向本机浏览器。

`pnpm test:mount` 使用真实 DSH。运行前将 `DSH_E2E_URL` 设置为隔离测试 profile 打印的带 token 地址，使用专用测试数据。`scripts/verify-*-installed.mjs` 是维护者本机的专用安装验证脚本，含本机路径及测试会话配置，使用前须检查和调整。

## 代码入口

| 文件 | 职责 |
| --- | --- |
| `src/index.ts` | 服务端入口，仅临时会话生命周期 HTTP 路由，无自建流式通道。 |
| `src/client/index.tsx` | 客户端入口、原生标签、命令与划词入口。 |
| `src/client/NativeSideChatPanel.tsx` | 保留独立原生 Session 引用，使用 SessionProvider 和 conversation.content 工厂。 |
| `src/client/display-boundary.tsx` | 仅在侧边 Provider 中过滤继承的显示记录；复用原生 View 的组件、注入、状态和授权渲染入口。 |
| `src/client/api.ts`、`store.ts` | 请求与侧边对话生命周期。 |
| `src/native-sidechat.ts` | 调用 DSH 原生 Session fork，登记临时身份并限制关闭操作范围。 |
| `src/temporary-sessions.ts` | 只登记临时会话 ID 和窗口身份，支持刷新/重启后的遗留回收，最后一个副本删除后移除登记文件。 |
| `src/client/temporary-visibility.tsx` | 对原生左侧浏览器的列表选择器做局部过滤，不改聊天组件使用的完整原生 Session catalog。 |
| `scripts/verify-temporary-installed.mjs` | 专用实测：列表无闪现、上下文、完整清理、刷新回收，以及主对话文件不变。 |
| `scripts/verify-empty-state-installed.mjs` | 专用实测：空主对话禁用命令、原生标志欢迎页、空白/草稿直接清理、有消息才确认及两种关闭入口。 |
| `scripts/verify-native-fork-installed.mjs` | 专用真实聊天：指令继承、时间/用量、菜单、流式、主对话隔离与永久删除。 |
| `scripts/verify-native-fork-controls.mjs` | 专用真实聊天：模型/权限、原生附件、计划审核与导出。 |
| `scripts/verify-native-boundary-installed.mjs`、`verify-native-boundary-controls.mjs` | 0.2.1 专用验收：空白开场、继承暗号、原生显示与工具、主会话文件不变及关闭删除。 |

0.1.x 的手绘面板、事件轮询、推送与审批桥接源文件保留作历史回归参考，不进入 0.2.0 的运行入口。新运行路径不向模型注入侧边边界提示，不自行重画消息或输入框。

0.2.1 的显示起点取自原生分支创建完成后的最后事件序号，不截断 Session 数据，也不改写模型提示。DSH rc.5 没有公开的消息显示偏移参数，因此通过公开 slot ledger 的可写组件入口，为原生 chat/trajectory View 添加会话局部的选择器适配；保留原 entry 的 inject、store、locale 和 renderSlot 授权，卸载时还原。主对话不在侧边 Provider 中，收到原始 props。该适配依赖已验证的 rc.5 原生快照结构，升级宿主后需要重新验证。

## 发行结构

包名为 `dsh-side-chat`，通过 `package.json` 的 `dsh.bundle.patch` 加载 `cordis.patch.yml`。官方 profile 通道使用 `lib/index.js` 和 `lib/client.js`；`lib/client-registry.js` 供第三方 registry 通道使用。

源码、构建、测试和声明均在本仓库内，不依赖 Better Sidebar 源码目录。保留的上游版权与提取来源见 [NOTICE.md](../NOTICE.md)。
