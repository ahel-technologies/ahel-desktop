---
description: "Ahel Desktop 的 Ahel 计量模型路由，通过 pi-ai 适配器并使用已登录 ahel.ai 账户的 bearer 提供服务。"
kind: "package-reference"
---

# @ahel/dsh-llm-ahel

[English](README.md) | 中文

## 概述

Ahel Desktop 的 Ahel 计量模型。注册一条兼容 OpenAI 的路由 `ahel`（“Ahel”），由 `dsh-llm-pi-ai` 适配器针对 `https://ahel.ai/api/llm/v1` 提供服务。bearer 是 `ctx.ahelAccount`（`dsh-ahel-account`）中已登录 ahel.ai 账户的访问令牌，每次请求时读取并刷新；该路由不保存 API 密钥。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

```yaml
- id: llm-ahel
  name: '@ahel/dsh-llm-ahel'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `baseURL` | `https://ahel.ai/api/llm/v1` | 兼容 OpenAI 的代理 |
| `provider` | `ahel` | 路由键 |
| `displayName` | `Ahel` | 模型选择器中的名称 |
| `requestTimeoutMs` | `30000` | 模型列表请求的截止时间 |
| `retryIntervalMs` | `30000` | 模型列表不可读时两次读取之间的最长等待（从 2 秒开始退避） |
| `connectingLabel` | `Ahel (connecting…)` | 列表读取前显示的停用菜单行 |
| `defaultModels` | `anthropic/claude-sonnet`、`anthropic/claude`、`openai/gpt-5`、`google/gemini` | 登录后选择默认模型时按顺序使用的 id 前缀 |

模型列表来自 `GET <baseURL>/models`，保留服务器的顺序，并在每次账户变化时重新读取。退出登录会移除已保存的 Ahel 默认模型。拒绝会变为带代码的失败：402（余额或每日上限）代码为 `ACCOUNT_QUOTA`，403（功能未开启、没有席位）为 `AHEL_NOT_ENABLED`，强制刷新一次令牌后的 401 为 `AHEL_SESSION_ENDED`（刷新被拒绝即退出登录）；消息中保留服务器的原句，`ui-ahel-account` 按代码显示自己的文案。未登录时请求以 `MISSING_CREDENTIAL` 失败，并提示登录。`dsh-llm-pi-ai` 中自带密钥的路由不受影响。

每次对话请求的金额都会送到 `ctx.ahelAccount.reportBilling`，composer 的余额标签读取它：先是 `x-ahel-held-cents` 与 `x-ahel-balance-cents` 响应头中的冻结金额，然后是回答最后一个 SSE 事件（`{"object":"ahel.billing","choices":[],"chargedCents":n,"heldCents":n,"balanceCents":n}`）或 JSON 回答的 `ahel_billing` 成员中的结算。该路由会在 pi-ai 解析回答前移除这个事件或成员。ahel.ai 无法读取账本时会省略它们；此时客户端在轮次结束时重新读取余额。

<a id="model-experience"></a>
## 模型体验

除所选模型本身外没有影响：请求就是普通的 pi-ai chat-completions 请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 该路由直接注册到 LLM 运行时，因此不在可配置提供方目录中：“设置 > 模型”会列出它的模型，但不提供密钥字段。
- 在 ahel.ai 代理（`desktop-metered-models`）上线前，后备模型 id 只是推测。

<a id="dev-note"></a>
### 开发备注

该路由的 profile 通过 `dsh-llm-pi-ai` 的 `resolveProfiles` 解析；模型列表在登录后携带账户 bearer 从 `GET <baseURL>/models` 读取。
