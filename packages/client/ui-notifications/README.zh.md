---
description: "对话需要你且窗口未获得焦点时发送系统通知：回复已就绪、有批准或问题在等待，或队友转交了对话。"
kind: "package-reference"
---

# @ahel/dsh-client-ui-notifications

[English](README.md) | 中文

## 概述

当对话需要你且窗口未获得焦点时，本包发送系统通知。Ahel Desktop 通过 Electron 主进程的 `Notification` 显示；浏览器使用 Web Notification API。点击会唤起窗口并打开该对话，转交则打开收件箱。设置 > 通用中有一个开关，默认开启。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 Web 组合中挂载这一行，无需配置。标题是对话标题。以下情况会通知：

- **回复已就绪：**轮次完成；正文为最终回复，或"回复已就绪"。
- **已停止：**轮次失败；正文为"已停止：{原因}"。
- **等待中：**批准卡片（"需要你的批准：{摘要}"）或问题卡片（"需要你的回答：{问题}"）。
- **转交：**队友把对话转交给你（"{发送者} 转交给你一个对话"）；点击打开收件箱。

### 预期行为

窗口获得焦点且可见时不显示任何通知。子代理对话从不通知。macOS 首次会请求通知权限；勿扰模式和专注模式与其他应用一样生效。偏好按设备保存在 `localStorage` 键 `dsh.ui-notifications.settings` 中。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

[`SessionNotifications`](src/client/watcher.ts) 不依赖 React。它读取 `api-session/status` 和 `api-session/error` Remote Event 以及 `uiSession.sessionStatus` 的待处理交互。轮次停止后等待 400 ms，让其他流上的失败和 `turnOutline` 投影预览先到达。[`InboxNotifications`](src/client/inbox.ts) 以结构方式读取 `ahelTeam.inbox()`，且只在窗口位于后台时读取：失焦时读取一次作为基线，之后每 60 秒一次。[`notifier.ts`](src/client/notifier.ts) 在存在 Desktop preload 的 `window.dshDesktopNotifications` 时使用它，否则使用 Web 通知。Desktop 主进程（`apps/desktop/src/notifications.ts`）校验应用主框架、显示通知，点击时唤起窗口并把目标发回。插件随后调用 `uiWorkspace.openSession` 或 `layout.selectPanel`。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-session](../ui-session/README.zh.md) — Session 状态和待处理交互的来源。
- [ui-approval](../ui-approval/README.zh.md) 和 [ui-user-questions](../ui-user-questions/README.zh.md) — 其等待会触发通知的卡片。

-----

<a id="model-experience"></a>
## 模型体验

无，通知属于浏览器和桌面外壳；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **转交需要 Ahel 账户。** 没有 `ctx.remote.ahelTeam` 时收件箱监视关闭。
- **窗口在前台显示其他对话时保持安静。** 只有未获得焦点的窗口会通知。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作语境——点击展开</summary>

无。

</details>
