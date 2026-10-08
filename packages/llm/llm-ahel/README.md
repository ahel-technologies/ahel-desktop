---
description: "Ahel-metered model route for Ahel Desktop, served through the pi-ai adapter with the signed-in ahel.ai account's bearer."
kind: "package-reference"
---

# @ahel/dsh-llm-ahel

English | [中文](README.zh.md)

## Summary

Ahel-metered models for Ahel Desktop. Registers one OpenAI-compatible route, `ahel` ("Ahel"), served by the `dsh-llm-pi-ai` adapter against `https://ahel.ai/api/llm/v1`. The bearer is the signed-in ahel.ai account's access token from `ctx.ahelAccount` (`dsh-ahel-account`), read and refreshed per request; no API key is stored for this route. A request of a chat bound to a workspace (`ctx.ahelAccount.chatWorkspace`) carries that workspace in `X-Ahel-Workspace`, so it is metered there; other requests carry the selected one.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

```yaml
- id: llm-ahel
  name: '@ahel/dsh-llm-ahel'
```

| Field | Default | Meaning |
|---|---|---|
| `baseURL` | `https://ahel.ai/api/llm/v1` | OpenAI-compatible proxy |
| `provider` | `ahel` | Route key |
| `displayName` | `Ahel` | Name in model pickers |
| `requestTimeoutMs` | `30000` | Deadline for the model-list request |
| `retryIntervalMs` | `30000` | Longest wait between model-list reads while the list is unreadable (backs off from 2 s) |
| `connectingLabel` | `Ahel (connecting…)` | Disabled menu row until the list is read |
| `defaultModels` | `anthropic/claude-sonnet`, `anthropic/claude`, `openai/gpt-5`, `google/gemini` | Id prefixes, in order, for the default chosen after sign-in |

The model list comes from `GET <baseURL>/models`, keeps the server's order, and is re-read on every account change. Signing out removes a saved Ahel default. Refusals become coded failures: 402 (balance or daily cap) has code `ACCOUNT_QUOTA`, 403 (feature off, no seat) `AHEL_NOT_ENABLED`, 401 `AHEL_SESSION_ENDED` after one forced token refresh (a refused refresh signs out); the server's own sentence is kept in the message, and `ui-ahel-account` shows its own copy per code. Signed out, a request fails with `MISSING_CREDENTIAL` and asks the person to sign in. Bring-your-own-key routes in `dsh-llm-pi-ai` are unaffected.

Each chat request's money reaches `ctx.ahelAccount.reportBilling`, which the composer's balance chip reads: the hold from the `x-ahel-held-cents` and `x-ahel-balance-cents` response headers, then the settle from the answer's last SSE event (`{"object":"ahel.billing","choices":[],"chargedCents":n,"heldCents":n,"balanceCents":n}`) or the JSON answer's `ahel_billing` member. The route removes that event or member before pi-ai parses the answer. ahel.ai omits them when its ledger cannot be read; the client then re-reads the balance at turn end.

<a id="model-experience"></a>
## Model Experience

None beyond the chosen model itself: requests are the ordinary pi-ai chat-completions requests.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- The route is registered directly with the LLM runtime, so it is not in the configurable-provider directory: Settings > Models lists its models but offers no key field for it.
- The fallback model ids are guesses until the ahel.ai proxy (`desktop-metered-models`) ships.

<a id="dev-note"></a>
### Dev Note

The route's profiles are resolved through `resolveProfiles` from `dsh-llm-pi-ai`; the model list comes from `GET <baseURL>/models` with the account bearer after sign-in.
