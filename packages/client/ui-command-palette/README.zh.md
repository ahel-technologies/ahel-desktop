---
description: "Web 客户端的 Cmd+K 命令面板，涵盖对话、面板、应用、模型、设置与账户操作；供面板分组的用户与维护者阅读。"
kind: "package-reference"
---

# @ahel/dsh-client-ui-command-palette

[English](README.md) | 中文

## 概述

Cmd+K（Ctrl+K）打开一个统一搜索，涵盖对话、主面板、已安装的 Ahel 应用、模型、设置页面、主题以及登录或退出。其他包通过 `ctx.commandPalette` 添加分组。面板的按键、侧边栏对话按键（Desktop）以及审批与收件箱命令都通过 `ctx.shortcuts` 注册，因此会在快捷键参考中显示并可重新绑定。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

模型分组按 composer 模型选择器的方式列出当前对话的模型：只显示简称，从不显示模型 id，副标题为厂商。同时以计量方式和本人密钥提供的模型只占一项；执行时保留正在使用的路由，否则使用计量路由。该分组读取 `ui-model-selection` 的目录，没有该插件时保持为空。

<a id="model-experience"></a>
## 模型体验

无；此包是浏览器侧 UI 插件，不注册面向模型的内容。

#### KV Cache 影响

无；此包不组装或发送模型提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅限主视图中的对话**——主视图中没有打开的对话时，模型分组不列出任何内容。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
