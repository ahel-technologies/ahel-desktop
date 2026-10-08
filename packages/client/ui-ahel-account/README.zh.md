---
description: "Web 客户端中的 Ahel 账户：账户菜单、设置 > 模型中的行、模型选择器的计量来源、Discover 与团队面板；供 Ahel 界面的用户与维护者阅读。"
kind: "package-reference"
---

# @ahel/dsh-client-ui-ahel-account

[English](README.md) | 中文

## 概述

ahel.ai 账户在浏览器中的界面，用于 Ahel Desktop 与 ahel.ai/chat 的网页对话。它填充侧边栏账户菜单、“设置 > 模型”中的 Ahel 行、空白对话的问候语与入门提示、Ahel 模型拒绝的提示、Discover 与“你的应用”，以及团队界面（审批、收件箱、团队标题与横条、交接）。它也是模型选择器的计量来源：价格、工作区默认模型、余额以及每次请求的冻结与结算。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

在 Host 上的 `dsh-ahel-account` 之后挂载。它挂载 Host 的 `ahelAccount`、`ahelCatalog` 与 `ahelTeam` Remote 命名空间，并通过 `watch` 流保持一份实时账户视图。

“设置 > 模型”新增两行。顶部的“此工作区的默认模型”按厂商分组列出计量模型及其典型消息价格。所有者或团队负责人选择默认模型，ahel 网页对话与 Ahel Desktop 中的新对话从它开始；其他人只能查看。ahel.ai 已不再列出的默认模型显示由 id 推出的名称并标注“（不在列表中）”。保存被拒绝时，在该行下方显示 ahel.ai 的原句。未登录或 ahel.ai 尚未报告该设置时隐藏该行。在提供方各行之下，Ahel 行显示账户及其登录按钮。

加载 `ui-model-selection` 后，本包把 Ahel 账户注册为 `ahel` 路由的选择器计量来源：来自 `ahelTeam.models()` 的各模型信息、工作区默认模型、最新余额（取摘要轮询与最近一次结算中较晚到达者）以及视图的 `billing` 帧。每次结算都会重新读取模型信息，使“上次约”提示保持最新。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

`team/summary.ts` 运行唯一共享的 `ahelTeam.summary()` 轮询。每次读取收件箱都会把轮询的 `inbox.unread` 设为该次收件箱读取的计数：未完成的未读交接，加上 ahel.ai 对整个收件箱未读议题行的计数，可能多于列表显示的行（`adoptInbox`），使侧边栏徽标与网页对话侧栏与列表一致；之后的轮询计数不同时，已打开的收件箱会重新读取。`models/source.ts` 把它与账户视图以及 `ahelTeam.models()` / `workspaceModel()` 合并为选择器的 `ModelBillingState` 和默认模型行的视图；来自摘要、GET 与 PUT 的值按到达顺序生效。`models/DefaultModelRow.tsx` 在 `settings.models.header` 位中渲染该行。来源通过 `ctx.inject(['modelDirectories'], …)` 注册，因此没有选择器时本包也能加载。

</details>

<a id="model-experience"></a>
## 模型体验

无；此包是浏览器侧 UI 插件，不注册面向模型的内容。

#### KV Cache 影响

无；此包不组装或发送模型提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **“设置 > 模型”中没有工作区选择**——默认模型作用于账户菜单所选的工作区。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

`/api/desktop/*` 与 `/api/llm/v1/models` 的结构位于 `dsh-ahel-account` 的 `src/types.ts`。

</details>
