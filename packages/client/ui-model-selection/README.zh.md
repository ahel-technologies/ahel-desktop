---
description: "Web GUI 的模型选择：按厂商分组、带价格与实时余额标签的 composer 模型选择器、/model 弹窗与打开选择器的快捷键，共用一份会话级目录；供模型路由的用户与维护者阅读。"
kind: "package-reference"
---

# @ahel/dsh-client-ui-model-selection

[English](README.md) | 中文

桌面端产品事件使用可选的[产品埋点服务](../product-analytics/README.zh.md)，不包含普通 Web 交互。

## 概述

composer 的模型选择器切换会话的模型与推理（reasoning）强度，Ahel Desktop 与网页对话中都一样。一份按厂商分组的列表显示简称、“适合”说明、典型消息价格和每个模型的计费方。触发按钮旁的余额标签：计量模型显示工作区余额，请求进行中显示“冻结中”，本人密钥显示“你的密钥”。`/model` 与 Cmd+K 的模型分组提供同样的模型。选择从下一次请求开始生效。

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

将本插件与 `ui-conversation` 及命令包一同挂载后，composer 显示触发按钮与余额标签，`/model` 以弹窗形式打开同样的模型。Cmd+Alt+/（其他平台为 Ctrl+Alt+/）打开当前对话的选择器；Cmd+/ 仍是键盘快捷键参考，Linux Web 将该组合留给浏览器。尚未配置提供方时，触发按钮显示“添加模型”，列表提示前往“设置 → 模型”。

### 列表

列表立即打开并聚焦搜索。搜索不区分大小写地匹配简称与厂商，也匹配按顺序出现的非连续字符。`↑`/`↓` 在不离开搜索的情况下移动高亮；Enter 与 Tab 选中高亮项；Escape 与 `Shift+Tab` 关闭并回到触发按钮。分组为厂商，仅用文字标注，按目录顺序排列，计量模型在前。

每行显示简称、“适合”说明、典型消息价格（“3.3¢”，输入 8,000 个 token、输出 1,000 个 token，含服务费）以及计费方：“ahel · 计入工作区余额”或“由 DeepSeek 计费”。工作区对计量模型最近一次的实际扣费显示为该行的提示（“上次约 4.1¢”）。同时以计量方式和本人密钥提供的模型只占一行，并带计费切换（“ahel · 计入工作区余额”/“你的密钥”）；点击该行时保留正在使用的路由，否则使用计量路由。工作区默认模型带“默认”标记。

计量模型的简称、厂商与“适合”说明来自计量账户。其他模型由静态表识别常见系列（Claude、GPT、o 系列、Gemini、DeepSeek、Grok、Mistral、Kimi、Qwen、GLM、Llama）；其余 id 退回为可读化的最后一段路径（“deepseek-v4.1-flash”显示为“DeepSeek V4.1 Flash”）。

### 底部

底部包含“在此对话中记住”与当前模型的推理等级。工作区设有默认模型时，新对话从它开始。选择其他模型会让该对话保持使用它，并开启“在此对话中记住”；关闭后对话回到工作区默认模型。该选择按对话保存在本浏览器中。推理等级列出确切模型由适配器公布的等级；没有等级的模型显示“该模型没有推理等级。”

### 余额标签

计量模型的标签显示工作区余额（“$12.40”）。从发送开始显示“冻结中”，直到该请求的结算报告不再有冻结金额，然后显示结算报告的余额。轮次结束而没有结算时会重新读取余额。使用本人密钥的模型显示“你的密钥”，不显示金额。未登录计量账户时隐藏标签。

### 不可路由的会话与失败

目录可用性不会阻止以已保存的选择发送；缺失凭据或模型不可用由请求执行报告。刷新与刷新失败保留上次显示的选择与行。被移除的提供方会离开列表，已保存的提供方／模型 id 与推理强度保持不变；此时触发按钮显示已保存的 `provider/model` id。被拒绝的选择通过锚定在 composer 卡片上的临时 Toast 提示。另一写入方占用会话时，提示用户退出其他正在运行的 Ahel Desktop 后重试。

-----

<a id="understand-the-implementation"></a>
## 理解实现

列表使用共享的 `MenuSurface` 材质与 `MenuGroup` 吸顶标题；自定义内容遵循[菜单规则](../../../docs/web-styling.zh.md#component-rules)。

<details>
<summary>实现内部细节——点击展开</summary>

`ModelDirectoryResolver`（`ctx.modelDirectories`）为每个会话持有一个 `ModelDirectory`。composer 模型位、`/model` popupSelect 贡献项与命令面板的模型分组读取同一目录，并通过 `session.selectModel` 提交，因此在一个入口中的切换就是其他入口接下来显示的内容。目录加载与选择共用一个代次计数器，较旧的响应不会覆盖较新的响应；连接重置会丢弃所有常驻投影，并重新拉取 Host 恢复的选择。

`rows.ts` 将 Host 目录的提供方分组按厂商重新分组，并按模型身份（最后一段路径、小写、点号改为连字符、去掉发布日期）把计量模型与本人密钥上的同一模型合并。`names.ts` 保存静态名称表。

计量账户通过 `ctx.modelDirectories.registerBilling(source)` 注册一个 `ModelBillingSource`：计量路由的提供方键、可观察的 `ModelBillingState`（是否登录、各模型信息、工作区默认模型、余额、最近一次冻结或结算帧）以及 `refreshBalance()`。同一时间只有一个来源生效。没有来源时，所有路由都按本人密钥显示，余额标签保持隐藏。`ui-ahel-account` 注册 Ahel 账户。解析器还会让空白对话从来源的工作区默认模型开始，除非该对话记住了自己的选择；每个默认值只尝试一次。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当仅了解模型界面还不够时，请阅读以下页面。这些页面从浏览器界面逐步深入到命令弹窗外壳与选择约定。

- [ui-commands](../ui-commands/README.zh.md)——`/model` 贡献项注册进的 popupSelect 外壳。
- [ui-conversation](../ui-conversation/README.zh.md)——声明 composer 的 `conversation.input.model` 位。
- [dsh-agent-default-model](../../core/agent-default-model/README.zh.md)——为从未选择的会话提供默认模型的默认模型服务。
- [客户端包映射](../README.zh.md)——相邻的浏览器 UI 包。

-----

<a id="model-experience"></a>
## 模型体验

各入口提交的 `session.selectModel` 选择会间接影响模型：Host 会在下一次提示词组装边界为完整的 `ModelSelection` 创建快照，并负责使其对模型生效；运行中的步骤则保留已组装的选择。

#### KV Cache 影响

切换路由可能减少提供方侧后续请求的缓存复用，或使其失效；提示词前缀本身不受影响。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了当前模型选择界面。它们是当前包约束，不是通用模型路由器对比或任务积压。

- **无创建期或已寻址 subagent 选择**——各入口都要求既有普通会话的 agent（智能体）；subagent 继续执行有意不公开独立的模型选择约定。
- **“在此对话中记住”按浏览器保存**——该选择保存在本浏览器的存储中，其他设备能看到对话所选的模型，但看不到它是否跟随默认模型。
- **不能任意输入推理强度**——选择器仅提供确切模型由适配器公布的等级。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

已批准的设计是 `ahel-technologies/ahel` 中的 `design/explorations/2026-10-08-model-picker/option-a.html`。服务端部分（`GET /api/llm/v1/models` 上的模型信息、计费事件、`GET/PUT /api/desktop/workspace/model`）是 ahel PR #468。

</details>
