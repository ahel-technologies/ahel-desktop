---
description: "Cloud dictation through the signed-in ahel.ai account."
kind: "package"
---

# @ahel/dsh-experimental-speech-to-text-ahel

English | [中文](README.zh.md)

## Summary

A `cloud` speech provider for the voice input. It sends one finished recording (16 kHz mono PCM16 WAV, at most 60 seconds) to ahel.ai's metered route `POST https://ahel.ai/api/llm/v1/audio/transcriptions` with the signed-in Ahel account's bearer and selected workspace. ahel.ai transcribes it with an audio-capable model and charges the workspace balance. The recording is not stored. The UI labels it "Transcribed through ahel.ai".

## Use this package

Ahel Desktop mounts it in `@ahel/dsh-web-app` as the default recognizer (`ahel-cloud`). Click the mic between the model picker and Send, or press the push-to-talk shortcut (Cmd+Shift+Space on macOS, Ctrl+Shift+Space on Windows; Settings > General > Dictation). The transcript goes into the message box; it is never sent on its own. The provider is ready only while signed in to Ahel.

| Config | Default | Meaning |
|---|---|---|
| `providerId` | `ahel-cloud` | id the speech registry selects |
| `baseURL` | `https://ahel.ai/api/llm/v1` | metered proxy base URL |
| `requestTimeoutMs` | `90000` | deadline for one transcription |

## Limits and failures

A refused bearer is refreshed once. A 402 (balance or daily cap), 403 (not on for the workspace) or 429 (rate limit) becomes one plain sentence in the composer. There is no fallback to another provider.

## Model Experience

None: the transcript only fills the draft; ordinary submission owns any message.
