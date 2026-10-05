# Use what you already have (local CLIs)

Ahel Desktop finds the Claude Code, Codex and Gemini CLIs the person installed and signed into. Settings > Models lists them under "Detected on this Mac". One click on Enable turns the tool on and makes it the default model. Each turn runs the unmodified binary in headless mode under the person's own sign-in: `claude -p` (stream-json), `codex exec --json` or `gemini -p` (stream-json).

- Host: `packages/llm/llm-local-cli` (detection, enable state, the `claude-code`, `codex-cli` and `gemini-cli` routes).
- Client: `packages/client/ui-local-cli` (the rows, Refresh, a new detection on window focus at most every 10 s, a toast).

## Vendor terms

- Anthropic: spawning the unmodified `claude` binary with the person's own login is allowed. Reusing Claude.ai OAuth tokens in our own client is forbidden.
- OpenAI: spawning the installed `codex` CLI is allowed. The route is never behind an Ahel paid tier (SIWC "No charge").
- Google: spawning `gemini` headless is allowed. Using Gemini CLI OAuth from our own code is forbidden.

## No-token rule

We never read, copy or store a vendor credential. No `~/.claude`, `~/.codex` or `~/.gemini` file, no keychain and no env values. Login state comes only from the exit code of `claude auth status` or `codex login status`. The person signs in in Terminal themselves.

## v1 limits

- Tools run inside the CLI as its own agent. Ahel MCP is passed to the CLI, and tool use shows as plain "Using ahel: <tool>" text.
- No MCP Apps cards on these routes. The harness tool loop stays on the Ahel and own-key routes.
- Codex has no token streaming. Each reply arrives as a whole message.
- Gemini: no Ahel MCP (it would need a settings file), no resume (every turn resends the transcript), login state is always unknown, so a missing sign-in shows on the first turn.

## Gemini argv (checked against `gemini --help`, 0.62.0)

`gemini -p '' --output-format stream-json [-m pro|flash]`, prompt on stdin (`# Instructions` then `# Conversation`), cwd `$DSH_HOME/local-cli/gemini`, env adds `GEMINI_CLI_TRUST_WORKSPACE=true` (headless refuses an untrusted folder) and `NO_BROWSER=true` (signed out exits 41 at once instead of opening a browser). No `--yolo`, no `--sandbox`. Minimum version 0.11.0, the first with stream-json.
