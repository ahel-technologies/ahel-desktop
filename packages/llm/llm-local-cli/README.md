# @ahel/dsh-llm-local-cli

"Use what you already have" for Ahel Desktop. Finds the Claude Code (`claude`), Codex (`codex`) and Gemini CLI (`gemini`) binaries the person installed and signed into themselves, and stores which of them they turned on. Remote namespace `localCli`: `list`, `detect`, `enable`, `disable`, `watch`; every change is emitted as `local-cli/changed`.

## Use this package

```yaml
- id: llm-local-cli
  name: '@ahel/dsh-llm-local-cli'
```

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `{}` | Per-CLI on/off, keyed `claude-code`, `codex-cli`, `gemini-cli`; written by `enable` / `disable` |
| `probeTimeoutMs` | `5000` | Deadline for each `--version` or login-status probe |

Lookup order per CLI: `AHEL_CLAUDE_PATH` / `AHEL_CODEX_PATH` / `AHEL_GEMINI_PATH`, then PATH, then known install locations (`~/.claude/local/claude`; Codex inside `ChatGPT.app` or `Codex.app`). Minimum versions: claude 2.0.0, codex 0.100.0, gemini 0.1.0. Login state comes from the exit code of `claude auth status` and `codex login status`; Gemini reports `unknown`.

The package never reads CLI credential files or the keychain and never logs the environment. Probes run through `ctx.subprocess` (scrubbed environment) in the OS temp directory. Usage on these CLIs is billed by the vendor to the person's own plan.

## Model routes

Each CLI that is installed, recent enough and turned on is served as a model route under its id. Turning one on also saves it as the default model (`default` model); turning it off clears a saved default that names it. Only `claude-code` is served so far.

`claude-code` runs the person's own `claude` binary per turn: `claude -p --output-format stream-json --input-format stream-json --include-partial-messages --verbose --tools "" --permission-mode dontAsk --strict-mcp-config --system-prompt-file <tmp> [--model opus|sonnet|haiku] [--resume <id>] [--mcp-config <tmp> --allowedTools mcp__ahel__*]`, cwd `$DSH_HOME/local-cli/claude`. HOME and CLAUDE_CONFIG_DIR pass through so the CLI finds its own sign-in; `--bare` is not used because it ignores subscription sign-ins. While signed in to ahel.ai, Ahel's MCP server is passed in a mode-600 temporary config whose bearer is `${AHEL_MCP_TOKEN}`, which the CLI expands from its environment; temporary files are deleted after each run. A first turn sends the rendered transcript; follow-up turns resume the CLI's own session (kept in memory per conversation) and send only the new user message. A CLI that says it is not signed in fails with code `LOCAL_CLI_SIGNED_OUT` and the message to run `claude` in Terminal.

## Model Experience

The harness system prompt is sent as the CLI's system prompt. Harness tools are not forwarded: the CLI runs the turn as its own agent with only Ahel's MCP tools, which appear as `Using ahel: <tool>` reasoning lines. Token usage is the CLI's reported usage for the turn; the CLI bills it to the person's own plan.

## Known Limitations and Deferred Work

- The harness's own tools, MCP Apps cards and confirm cards do not run on these routes.
- `codex-cli` and `gemini-cli` are detected but not yet served as routes.
- Resume ids live in memory, so the first turn after a restart sends the full transcript again.
- Windows paths (`%USERPROFILE%\.local\bin\claude.exe`, `%APPDATA%\npm\*.cmd` through `cmd.exe /c`) are untested.
