---
description: "Ahel Desktop 的 ahel.ai 账户：一次浏览器登录，其授权由 Ahel MCP 服务器与 Ahel 模型共用，另提供 Discover 目录与团队 Remote 命名空间。"
kind: "package-reference"
---

# @ahel/dsh-ahel-account

[English](README.md) | 中文

## 概述

Ahel Desktop 的 ahel.ai 账户。一次浏览器登录在凭据引用 `AHEL_ACCOUNT` 下保存一份 OAuth 授权；Ahel MCP 服务器（`dsh-mcp-client`，`auth.credentialRef: AHEL_ACCOUNT`）与 Ahel 模型（`dsh-llm-ahel`）都使用它。

## 目录

- [使用本包](#use-this-package)
- [目录：ahelCatalog 命名空间](#catalog-the-ahelcatalog-namespace)
- [团队：ahelTeam 命名空间](#team-the-ahelteam-namespace)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

```yaml
- id: ahel-account
  name: '@ahel/dsh-ahel-account'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `appOrigin` | `https://ahel.ai` | 授权服务器与 API 源 |
| `resource` | `https://mcp.ahel.ai/mcp` | 令牌绑定的 RFC 8707 资源 |
| `credentialRef` | `AHEL_ACCOUNT` | 保存授权的凭据引用 |
| `clientName` | `Ahel Desktop` | 注册的客户端名称；会追加 ` on <host name>` |
| `signInTimeoutMs` | `300000` | 等待浏览器回调的时间 |
| `requestTimeoutMs` | `30000` | 每次 ahel.ai 请求的截止时间 |
| `refreshSkewMs` | `60000` | 令牌在此时间窗内过期时刷新 |
| `healthPath` | `/api/health/live` | 在 `appOrigin` 上读取，用于判断 ahel.ai 是否可达（视图中的 `reachable`） |
| `reachableIntervalMs` | `60000` | ahel.ai 有响应时两次可达性读取的间隔 |
| `unreachableIntervalMs` | `5000` | ahel.ai 无响应时两次可达性读取的间隔 |
| `launchTokenEnv` | `AHEL_LAUNCH_TOKEN` | 保存 ahel.ai 网页对话启动授权的环境变量；为空则停用 |
| `hostedSignInPath` | `/chat/` | 由网页对话启动的 Host 点击登录时重新加载的 `appOrigin` 路径 |
| `hostedSignOutPath` | `/app/settings` | 由网页对话启动的 Host 点击退出时打开的 `appOrigin` 路径 |

服务为 `ctx.ahelAccount`；Remote 命名空间 `ahelAccount` 公开 `state()`、`signIn()`、`cancelSignIn(id)`、`signOut()`、`profile()` 与 `watch` 流。Host 代码还可使用 `accessToken()`（按需刷新）、`revalidate()`（401 后强制刷新一次）、`setOpener(fn)` 与 `reportBilling(billing)`。`dsh-llm-ahel` 用每次计量请求的冻结与结算调用 `reportBilling`；视图的 `billing` 随后把最近一次（阶段、会话、模型、冻结、扣费与余额的美分数）送给 `watch` 订阅者，不触发 `ahel-account/changed`。退出登录或选择其他工作区会清除它。

登录沿用 `ahel` CLI 的流程：发现、在 `127.0.0.1:<随机端口>/callback` 上的回环监听、每次登录重新进行动态客户端注册（固定的客户端 id 一旦被撤销会永远保持撤销）、PKCE S256、作用域 `openid profile email offline_access`，然后 `GET /api/mcp/profile`。`signIn()` 在授权 URL 生成后即返回，URL 位于 `attempt.authorizeUrl`；由 `setOpener` 设置的打开器打开它，否则记录到日志。退出登录调用 `POST /api/mcp/revoke`，即使撤销失败也会删除凭据。

### 启动授权（网页对话）

ahel.ai 的网页对话为每个人启动一个 Host，并通过 `AHEL_LAUNCH_TOKEN` 交付此人的登录：ahel.ai 为第一方客户端签发的 JSON `{"client_id": "...", "refresh_token": "..."}`。加载时插件从 `process.env` 中移除该变量，在发现的令牌端点（带 `resource`）兑换一次刷新令牌，读取 profile，并把结果保存在 `AHEL_ACCOUNT` 下，替换先前 pod 留在卷上的授权。ahel.ai 会轮换刷新令牌，因此进程环境中的副本在首次刷新后即失效。`state()` 与每次 bearer 读取都会等待这一步。格式错误或被拒绝的令牌会在不记录其值的情况下写入日志，账户保持未登录。

以这种方式启动的 Host 在视图中报告 `hosted: { signInUrl, signOutUrl }`。`signIn()` 与 `signOut()` 会拒绝，因为授权归此人的 ahel.ai 会话所有；客户端把登录发送到 `signInUrl`（重新启动），把退出发送到 `signOutUrl`。未带该变量启动的 Host 报告 `hosted: null`。

### 对话所属工作区

每个对话都会记录它开始时所在的 ahel.ai 工作区。顶层对话在任何提示写入日志之前走第一步时，Host 会追加仅写入日志的会话事件 `ahel-account/chat-workspace`（`{ workspace }`），记录所选工作区；未选择工作区时，记录 ahel.ai 团队摘要为该账号指定的工作区；第一个轮次若在该步之前被取消，标记留给下一个轮次。该事件带有信封的 `ignorable: true`，不认识它的构建仍能打开该对话。`ahelWorkspace` 会话投影在每一行会话列表上携带该 id 或 null，分叉会继承它。在有此标记之前已有提示的对话，或开始时两种工作区都无法读取（未登录、ahel.ai 不可达）的对话，不带标记。网页对话只列出所选工作区的对话。

该标记绑定对话：它的 Ahel MCP 工具调用（经 `mcp-client/workspace` 应答）、卡片按键、Ahel 模型请求和 Ahel 网页搜索调用（`chatWorkspace(sessionId)`，仅 Host）都在标记的工作区中进行，不论之后选择了哪个工作区；子代理在其父对话的工作区中进行。选择另一个工作区只改变列出哪些对话以及新对话从哪里开始；不带标记的对话跟随当前选择。Remote 方法 `pinChat(sessionId, workspace)` 用此人有席位的工作区（实时从 ahel.ai 读取，否则用已保存的资料）标记一个尚未走过任何一步的对话，排队的议题运行就这样使用其议题的工作区；否则以 `ahel-account/workspace-unavailable` 失败。`ahelIssues.list` 返回它读取时所在的工作区，`get`、`comment` 和 `run` 接受运行的工作区；未提供时 `run` 报告到该运行对话所在的工作区。

<a id="catalog-the-ahelcatalog-namespace"></a>
## 目录：`ahelCatalog` 命名空间

子服务 `ctx.ahelCatalog` 为桌面端提供 ahel.ai 的 Discover 目录与此人的安装。其 Remote 命名空间 `ahelCatalog` 公开六个方法。
- `browse(query)` 与 `browsePart(query, groupKey, offset)` 读取 ahel.ai/discover 使用的匿名 `GET /api/public/catalog-search?view=listing`。未登录也可使用。行链接与标记以绝对 ahel.ai URL 返回。
- `browse` 接受 `concept`（`apps`、`mcp-servers`、`skills`、`packs`），对应 ahel.ai 的 Discover 分区；没有列表 `concept` 过滤的 ahel.ai 改由 `?concept=` 目录搜索应答。
- `installed()`、`add(id)` 与 `setEnabled(key, on)` 调用 Ahel MCP 网关工具 `installed`、`install` 与 `switch`。它们使用此账户的 bearer 与所选的 `?workspace=`，并在 401 后刷新一次。因此桌面端与 ahel.ai 共用同一份服务端状态。
- 失败为 `RemoteError` 代码：`ahel-catalog/busy`（HTTP 429）、`ahel-catalog/unreachable`、`ahel-catalog/signed-out` 与 `ahel-catalog/refused`，后者的消息是 ahel.ai 的原句。
- 网关没有卸载工具，因此移除应用需在 ahel.ai 的 `/app/apps` 完成。

<a id="team-the-ahelteam-namespace"></a>
## 团队：`ahelTeam` 命名空间

子服务 `ctx.ahelTeam` 使用此账户的 bearer 与所选的 `?workspace=` 调用 ahel.ai 的 `/api/desktop/*` 路由；401 后刷新一次。
- 方法：`summary()`（审批、未读交接、余额、`defaultModel`）、`models()`（`GET /api/llm/v1/models`，附带 ahel.ai 对每个模型的信息：简称、厂商、“适合”说明、典型消息价格、工作区最近一次的大致扣费）、`workspaceModel()` 与 `setWorkspaceModel(model)`（`GET`/`PUT /api/desktop/workspace/model`；仅所有者或团队负责人）、`decideApproval(id, decision, note)`、`signIns()`、`connectPanel(app)`、`connect(app, values)`、`disconnect(app)`、`inbox()`、`openHandoff(id)`、`prepareHandoff(draft)`、`shareHandoff(share)` 与 `markHandoffDone(id)`。
- 错误：`ahel-team/signed-out`、`ahel-team/outdated`（ahel.ai 尚无 `/api/desktop`：显示“更新 ahel.ai”）、`ahel-team/forbidden`、`ahel-team/refused`、`ahel-team/busy` 与 `ahel-team/unreachable`；拒绝消息是 ahel.ai 的原句。
- `connect` 只把密钥值发送到 `POST /api/desktop/connect`，从不记录它们，也从不放入错误中。
- 每次读取工作区默认模型（`summary()`、`workspaceModel()`、`setWorkspaceModel()`）都会发出 `ahel-account/default-model`。`default-model.ts` 让 Host 保存的默认模型（`agentDefaultModel`）保持为工作区默认模型；未设置时为 Ahel 路由列出的第一个模型；未设置默认模型时保留已列出的本人密钥模型。它在登录、路由变化和设置变化时重新检查。因此 Host 自行开始的对话（它接手的议题运行、webhook）与界面中的新对话从同一处开始。对话自己的选择仍属于该对话。

<a id="model-experience"></a>
## 模型体验

无。本包不添加工具或提示词文本。它唯一的会话事件 `ahel-account/chat-workspace` 只写入日志，从不进入模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 授权由所用的凭据提供方保存（`credentials-local`：`$DSH_HOME/.credentials.yaml`，模式 600）。基于 Keychain 的提供方属于第 3 阶段。
- 没有工作区选择器：ahel.ai 把令牌固定到此人唯一的席位或最早的成员资格。

<a id="dev-note"></a>
### 开发备注

维护者随 ahel.ai API 一起修改本包：`/api/mcp/*`、`/api/public/catalog-search` 与 `/api/desktop/*` 的结构位于 `src/types.ts`，目录生成器在 `scripts/gen-cordis-catalog.ts` 中列出它们。
