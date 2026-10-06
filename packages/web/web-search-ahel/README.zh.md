---
description: "web seam 的 Ahel 网页搜索：web_search 与 web_fetch 通过已登录的 Ahel 账户在 ahel.ai 的只读网页搜索应用上运行，且仅在登录时存在。"
kind: "package-reference"
---

# @ahel/dsh-web-search-ahel

[English](README.md) | 中文

## 概述

通过 ahel.ai 的第一方网页搜索应用（`ahel.services/web-search`，网关键 `ahel-services-web-search`）进行搜索和页面读取。每次调用都是对 Ahel 网关 `use` 动词的 MCP `tools/call`，携带 `AHEL_ACCOUNT` bearer 与所选 `?workspace=`。`web_search` 对应网页搜索的 `web_search`；`web_fetch` 对应其 `read_page`。两者都是只读的。本插件仅在已登录 Ahel 账户时以子插件形式挂载 [`dsh-tool-web`](../tool-web/README.zh.md)，因此未登录时模型没有这两个工具。

## 目录

- [使用本包](#use-this-package)
- [限制与失败](#limits-and-failures)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

```yaml
- id: web
  name: '@ahel/dsh-web'
  config: { searchProvider: ahel, fetchProvider: ahel }
- id: web-search-ahel
  name: '@ahel/dsh-web-search-ahel'
  config:
    requestTimeoutMs: 45000
    tools: { searchMaxQueries: 3 }
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `requestTimeoutMs` | `45000` | 单次网关调用的截止时间 |
| `tools` | tool-web 默认值 | 传给 `dsh-tool-web` 子插件的配置 |

它注入 `web` 与 `ahelAccount`；bearer 只发送到 `ahelAccount.gateway()`，即授权绑定的 URL，并拒绝重定向。

<a id="limits-and-failures"></a>
## 限制与失败

- ahel.ai 对每次调用计费：每个搜索查询或页面读取从工作区余额扣除 1 美分。一次包含三个查询的 `web_search` 调用计为三次。
- ahel.ai 按分钟（套餐速率；Ahel Desktop 客户端至少 120）和按天限制工作区；网页搜索自身也限制负载。HTTP 429 以 `AHEL_RATE_LIMITED` 失败。
- 网页搜索每个查询最多返回 10 条结果，页面文本最多 40 KB；本包还将页面文本限制在 100,000 字符。只发送 `http:` 与 `https:` URL；ahel.ai 拒绝私有和回环地址。
- 工作区未开启网页搜索时以 `AHEL_WEB_SEARCH_OFF` 失败，并提示前往 设置 > 通用 > 网页搜索。未登录或授权被拒时以 `AHEL_SIGNED_OUT` 失败。

<a id="model-experience"></a>
## 模型体验

模型看到 `dsh-tool-web` 的 `web_search` 与 `web_fetch` 工具及其输出格式；本包不添加提示文本。抓取的页面以文本（`body.kind: 'text'`）返回，开头是网页搜索的 `# 标题` 和 `Source:` 行。

#### KV Cache 影响

登录或退出会增加或移除两个工具定义，从而改变下一次请求的工具列表。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 网页搜索能读取的每个页面，`web_fetch` 都报告 HTTP 200；网页搜索不传递源站状态码。
- 未暴露网页搜索的 `screenshot` 工具；它仍可通过 Ahel MCP 服务器使用。
