# @ahel/dsh-llm-ahel

Ahel-metered models for Ahel Desktop. Registers one OpenAI-compatible route, `ahel` ("Ahel"), served by the `dsh-llm-pi-ai` adapter against `https://ahel.ai/api/llm/v1`. The bearer is the signed-in ahel.ai account's access token from `ctx.ahelAccount` (`dsh-ahel-account`), read and refreshed per request; no API key is stored for this route.

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
| `fallbackModels` | Claude Sonnet 5.5, GPT-5.6, Gemini 2.5 Flash | Served while `GET /models` is missing or unreadable |

The model list comes from `GET <baseURL>/models` and is re-read on every account change. Refusals become readable failures: 402 (balance or daily cap) has code `QUOTA`, 403 (feature off, no seat) and 401 have code `AUTH`; the server's own sentence is kept. Signed out, a request fails with `MISSING_CREDENTIAL` and asks the person to sign in. Bring-your-own-key routes in `dsh-llm-pi-ai` are unaffected.

## Model Experience

None beyond the chosen model itself: requests are the ordinary pi-ai chat-completions requests.

## Known Limitations and Deferred Work

- The route is registered directly with the LLM runtime, so it is not in the configurable-provider directory: Settings > Models lists its models but offers no key field for it.
- The fallback model ids are guesses until the ahel.ai proxy (`desktop-metered-models`) ships.
