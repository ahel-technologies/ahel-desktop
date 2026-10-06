---
description: "MCP Apps 卡片宿主：在每个已结束的工具调用下方，于沙箱框架中渲染 MCP 服务器的 ui:// 卡片，并实现 MCP Apps postMessage 桥接。"
kind: "package-reference"
---

# @ahel/dsh-client-ui-mcp-app

[English](README.md) | 中文

## 概述

本包渲染 MCP Apps 卡片（`io.modelcontextprotocol/ui`，协议 2026-01-26）。当一个已结束的 MCP 工具调用在持久化结果元数据中带有 `mcpApp` 记录时，卡片会从同一服务器读取该工具的 `ui://` 资源，把它挂载到一个在该调用的可折叠行旁始终展开的沙箱框架中，并运行 MCP Apps JSON-RPC 桥接的宿主端：`ui/initialize` 握手、工具输入与结果通知、由宿主代理的 `tools/call` 和 `resources/read`、`ui/open-link`、尺寸变化以及主题更新。无法加载的卡片改为显示该调用的文本结果和结构化结果。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在同时挂载 `@ahel/dsh-mcp-client`、`@ahel/dsh-mcp-resources` 和 `@ahel/dsh-client-ui-tool` 的 Web 或 Desktop 组合中挂载一行。该行会加载 Host 控制器和浏览器卡片。

```yaml
- id: ui-mcp-app
  name: '@ahel/dsh-client-ui-mcp-app'
  config:
    maxHeight: 640
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxHeight` | `640` | 卡片最大高度（CSS 像素），且不超过窗口高度的 70%；更高的应用内容在卡片内部滚动。等待用户决定的确认卡片不受此上限限制 |

服务器在 `tools/list` 中把工具的 `_meta.ui.resourceUri` 设为一个 `ui://` URI，并以 MIME 类型 `text/html;profile=mcp-app` 提供该 URI，即声明了一张卡片。`@ahel/dsh-mcp-client` 负责持久化记录；本包不需要按服务器配置。

卡片发起的 `tools/call` 通过 Session Agent 的工具注册表运行卡片所属服务器上的指定工具，因此 pre-execute 策略、守卫、审批和 post-execute 策略与模型调用完全一致。该工具的 `_meta.ui.visibility` 必须包含 `app`；调用其他服务器会被拒绝。`ui/open-link` 通过窗口打开路径打开 `http:` 和 `https:` URL，桌面壳会把它交给系统浏览器。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

Host 插件提供 `ctx.mcpApps` 以及包含两个方法的 Remote 命名空间 `mcpApps`。`readResource(agent, server, uri)` 通过 `ctx.mcpResources.readAppResource` 读取，后者按服务器连接代次和 URI 缓存 `ui://` 读取结果。`callTool(agent, server, tool, args)` 解析工具在注册表中的公开名称，检查其 MCP 描述符和可见性，并携带 Agent 调用 `ctx.tools.execute`；结果的 `_meta` 来自该调用的展示记录，从不来自规范值。Client 自行挂载生成的 Remote 贡献。

Client 注册由 `@ahel/dsh-client-ui-tool` 声明的 `tool.call.app` 占位组件。卡片校验记录、读取资源，并把依据资源声明的域构建的 MCP Apps 内容安全策略作为文档 head 的第一个元素插入。框架使用 `sandbox="allow-scripts allow-forms"` 且不带 `allow-same-origin`，因此应用运行在不透明源中，无法访问宿主页面、其存储或 Cookie，也无法打开弹窗或导航顶层窗口。页面的消息监听器只接受来源为该卡片自身框架窗口且源为 `null` 的消息。框架第二次触发 `load` 事件表示它发生了导航；此时桥接停止，卡片显示回退内容。

Chat 过程分组（`[data-step-process]`）内的调用行可能被折叠、限制高度，或随整个 Turn 过程一起收起。因此分组会渲染一个始终可见的同级停靠区（`[data-step-process-cards]`）；卡片通过 portal 把自身放入该停靠区并默认展开，同时在调用行中留下“显示卡片”链接，点击后滚动到卡片并聚焦。分组之外，卡片仍位于调用行下方。当调用的实时结果 `_meta` 带有 `ai.ahel/pressToken` 且尚无卡片操作成功时，卡片处于等待决定状态：显示 Ahel 红色左边线，并按其报告的高度增长、不设上限。

桥接会暂存工具输入和结果通知，直到应用发送 `ui/notifications/initialized`，再按该顺序发送。宿主上下文包含主题的配色方案、内联显示模式、高度上限、语言区域、时区、平台，以及从当前设计令牌映射的样式变量；主题变化时只发送变化的字段。

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | Host 控制器：`readResource` 和 `callTool` Remote 方法 |
| [`src/call-result.ts`](src/call-result.ts) | 把注册表结果转换为 MCP `CallToolResult` 字段 |
| [`src/types.ts`](src/types.ts) | 浏览器安全的线路类型 |
| [`src/client/bridge.ts`](src/client/bridge.ts) | MCP Apps JSON-RPC 桥接的宿主端 |
| [`src/client/document.ts`](src/client/document.ts) | 内容安全策略与框架沙箱 |
| [`src/client/record.ts`](src/client/record.ts) | 卡片记录与资源校验 |
| [`src/client/McpAppCard.tsx`](src/client/McpAppCard.tsx) | 卡片组件：放置、加载、框架、回退 |
| [`src/client/register.ts`](src/client/register.ts) | 插槽注册以及注入的、绑定 Session 的服务器访问 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [MCP client](../../mcp/mcp-client/README.zh.md) —— 工具 `_meta` 与持久化的 `mcpApp` 记录。
- [MCP resources](../../mcp/mcp-resources/README.zh.md) —— 带缓存的 `ui://` 读取。
- [Tool UI](../ui-tool/README.zh.md) —— `tool.call.app` 插槽。
- [MCP Apps 规范](https://modelcontextprotocol.io/extensions/apps) —— 桥接方法与宿主安全规则。

-----

<a id="model-experience"></a>
## 模型体验

### 卡片与卡片发起的调用

#### 模型看到什么

本包不向模型提供任何内容。模型看到的是 MCP 工具的普通文本结果。卡片自身的工具调用、资源读取以及 `ui/update-model-context` 内容都不会写入 Session 日志，也不会进入任何模型请求。

#### Token 影响

无；卡片不增加模型输入。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **轮次之外的审批按拒绝处理** —— `ask` 决定需要一个打开的轮次，因此当 Agent 空闲时，若策略要求对卡片发起的调用进行询问，该调用会被拒绝。
- **卡片调用不记录日志** —— 卡片 `tools/call` 的结果只返回给卡片；模型不会得知，回放也不会显示。
- **卡片的模型上下文只保存不发送** —— 每张卡片保留最新的 `ui/update-model-context` 内容，但尚未加入下一次请求；`ui/message` 会被拒绝。
- **单层沙箱框架** —— 卡片运行在一个不透明源框架中，而不是规范为 Web 宿主描述的双层沙箱代理框架，因此不支持 `_meta.ui.domain` 以及依赖 `allow-same-origin` 的应用（存储、Cookie）。
- **仅内联显示** —— `ui/request-display-mode` 返回 `inline`；不提供全屏和画中画。
- **仅限应用的工具** —— 可见性不含 `model` 的工具不会被桥接，因此卡片无法调用它们。
- **没有部分输入** —— 卡片在调用结束后才挂载，因此从不发送 `ui/notifications/tool-input-partial`，`tool-input` 与结果一同到达。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
