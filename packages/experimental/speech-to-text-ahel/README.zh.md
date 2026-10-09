---
description: "通过已登录的 ahel.ai 账户进行云端听写。"
kind: "package-reference"
---

# @ahel/dsh-experimental-speech-to-text-ahel

[English](README.md) | 中文

## 概述

语音输入的 `cloud` 识别服务。它把一段完成的录音（16 kHz 单声道 PCM16 WAV，最长 60 秒）连同已登录 Ahel 账户的令牌，发送到 ahel.ai 的计费接口 `POST https://ahel.ai/api/llm/v1/audio/transcriptions`。`X-Ahel-Workspace` 指明录音所在对话的工作区（该对话的 `ahelWorkspace` 标记）；尚未标记的对话使用所选工作区。ahel.ai 用支持音频的模型转写，并从该工作区余额扣费。录音不会被保存。界面标注“通过 ahel.ai 转写”。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

Ahel Desktop 在 `@ahel/dsh-web-app` 中挂载它作为默认识别服务（`ahel-cloud`）。点击模型选择器与发送按钮之间的麦克风，或按下按键说话快捷键（macOS 为 Cmd+Shift+Space，Windows 为 Ctrl+Shift+Space；设置 > 通用 > 听写）。转写文字进入输入框，不会自动发送。仅在登录 Ahel 时可用。

| 配置 | 默认值 | 含义 |
|---|---|---|
| `providerId` | `ahel-cloud` | 识别服务 id |
| `baseURL` | `https://ahel.ai/api/llm/v1` | 计费代理地址 |
| `requestTimeoutMs` | `90000` | 单次转写时限 |

-----

<a id="model-experience"></a>
## 模型体验

无，因为转写文字只填入未发送的草稿；之后的消息由普通用户提交拥有。

#### KV 缓存影响

没有直接影响；普通提交拥有消息内容。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 令牌被拒时刷新一次。402（余额或每日上限）、403（工作区未开启）或 429（限流）会在输入框中显示一句说明。不会回退到其他识别服务。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
