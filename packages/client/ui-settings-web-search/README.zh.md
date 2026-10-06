---
description: "dsh Web 客户端的 设置 > 通用 > 网页搜索：显示所选 ahel.ai 工作区中 Ahel 网页搜索的状态，未开启时提供开启按钮。"
kind: "package-reference"
---

# @ahel/dsh-client-ui-settings-web-search

[English](README.md) | 中文

## 概述

Ahel Desktop 的网页搜索通过 Ahel 账户使用 Ahel 网页搜索（[`dsh-web-search-ahel`](../../web/web-search-ahel/README.zh.md)）。**设置 > 通用** 中的这一行在所选工作区已开启时显示“Ahel 网页搜索（已开启）”，否则显示“此工作区未开启”和 **开启** 按钮，未登录时显示登录提示。没有提供方选择器。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在 `@ahel/dsh-client-ui-ahel-account` 之后挂载；它挂载本行读取的 `ahelAccount` 与 `ahelCatalog` Remote 命名空间。web-app bundle 会同时挂载两者。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

浏览器半部跟随 `ahelAccount.watch`；登录或切换工作区时读取 `ahelCatalog.installed()` 并查找键 `ahel-services-web-search`。**开启** 在工作区没有该应用时调用 `ahelCatalog.add('ahel.services/web-search')`，否则调用 `ahelCatalog.setEnabled(key, true)`，然后重新读取。只有用户本人的点击会写入。Host 半部不注册任何内容。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [web-search-ahel](../../web/web-search-ahel/README.zh.md) — 提供方以及 `web_search`/`web_fetch` 工具。

-----

<a id="model-experience"></a>
## 模型体验

无，本包不注册任何模型界面。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **应用内不能关闭** — 关闭网页搜索需在“你的应用”或 ahel.ai 上完成。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
