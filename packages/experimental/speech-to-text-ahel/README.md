---
description: "Cloud dictation through the signed-in ahel.ai account."
kind: "package-reference"
---

# @ahel/dsh-experimental-speech-to-text-ahel

English | [中文](README.zh.md)

## Summary

A `cloud` speech provider for the voice input. It sends one finished recording (16 kHz mono PCM16 WAV, at most 60 seconds) to ahel.ai's metered route `POST https://ahel.ai/api/llm/v1/audio/transcriptions` with the signed-in Ahel account's bearer. `X-Ahel-Workspace` names the workspace of the chat whose composer recorded it (the chat's `ahelWorkspace` stamp), else the selected workspace for a chat not stamped yet. ahel.ai transcribes it with an audio-capable model and charges that workspace's balance. The recording is not stored. The UI labels it "Transcribed through ahel.ai".

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Ahel Desktop mounts it in `@ahel/dsh-web-app` as the default recognizer (`ahel-cloud`). Click the mic between the model picker and Send, or press the push-to-talk shortcut (Cmd+Shift+Space on macOS, Ctrl+Shift+Space on Windows; Settings > General > Dictation). The transcript goes into the message box; it is never sent on its own. The provider is ready only while signed in to Ahel.

| Config | Default | Meaning |
|---|---|---|
| `providerId` | `ahel-cloud` | id the speech registry selects |
| `baseURL` | `https://ahel.ai/api/llm/v1` | metered proxy base URL |
| `requestTimeoutMs` | `90000` | deadline for one transcription |

-----

<a id="model-experience"></a>
## Model Experience

None, as the transcript only fills the unsent draft; ordinary user submission owns any message.

#### KV Cache effect

No direct effect; ordinary submission owns the message content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- A refused bearer is refreshed once. A 402 (balance or daily cap), 403 (not on for the workspace) or 429 (rate limit) becomes one plain sentence in the composer. There is no fallback to another provider.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
