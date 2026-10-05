---
description: "dsh Web 客户端已移除的网页搜索提供方设置页的占位包：两个半部都会加载，但不注册任何内容。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-web-search

[English](README.md) | 中文

## 概述

Ahel Desktop 不提供可由**插件**中的**网页搜索**页面编辑的搜索提供方，因此两个半部都会加载但不注册任何内容。仍引用本包的 profile 可以继续加载。

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

新的 profile 不要挂载本包。从 profile 中移除它的条目不会带来任何可见变化。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

Host 半部和浏览器半部都导出空的 `apply`；浏览器半部不注入任何服务。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-plugin-manager](../ui-plugin-manager/README.zh.md)——提供方设置页注册所在的插件页面。

-----

<a id="model-experience"></a>
## 模型体验

无，本包不注册任何面向模型的内容。

#### KV 缓存影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **没有搜索设置页**——以后提供的搜索提供方需要自己的设置页。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
