---
description: "Web 客户端中的团队议题：议题看板与列表、议题详情、新建议题与“用 Ahel 运行”；供 Ahel 界面的用户与维护者阅读。"
kind: "package-reference"
---

# @ahel/dsh-client-ui-issues

[English](README.md) | 中文

## 概述

Ahel Desktop 中基于已登录 ahel.ai 工作区的议题面板：带筛选的看板与列表、议题详情抽屉、新建议题，以及“用 Ahel 运行”——它用议题开启一个新对话，并把该对话的状态报告为议题的运行。登录期间，它还会认领此人在 ahel.ai 上排队的运行，并打开每个运行的对话。运行在其议题被读取时所在的工作区中进行：它的对话在第一条消息之前固定到该工作区，报告和摘要发往那里；若此人在该工作区已没有席位，运行以该原因失败。以等待此人的卡片（连接器确认、被拦下的调用或连接器问题）结束的轮次会报告 `waiting_approval` 或 `waiting_input`，直到卡片被按下或对话继续。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

在 Host 上的 `dsh-ahel-account` 之后挂载；它读取 Host 的 `ahelIssues` Remote 命名空间。其他包通过 `ahel-issues/open` 事件打开某个议题，通过 `ahel-issues/poll` 请求读取。窗口获得焦点时看板每 60 秒重新读取一次，窗口重新获得焦点时也会读取。ahel.ai 限流或未应答的详情读取会在抽屉打开期间自动重试，等待 ahel.ai 的 Retry-After，否则从 2 秒起逐次加倍、最多 30 秒；抽屉显示正在等待，而不是错误。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

`feed.ts` 保存共享的议题状态与所有写操作；`IssueDetail.tsx` 负责详情读取及其重试计时器；`run.ts` 启动并跟踪运行的对话；`pickup.ts` 认领在 ahel.ai 上排队的运行。

</details>

<a id="model-experience"></a>
## 模型体验

无；此包是浏览器侧 UI 插件，不注册面向模型的内容。

#### KV Cache 影响

无；此包不组装或发送模型提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **看板读取失败时保留上一次的看板**——只有详情抽屉会自动重试失败的读取。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

`/api/desktop/issues*` 的结构位于 `dsh-ahel-account` 的 `src/issues-types.ts`。

</details>
