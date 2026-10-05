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

## Known Limitations and Deferred Work

- Detection only; the model routes that run these CLIs come in a later package change.
- Windows paths (`%USERPROFILE%\.local\bin\claude.exe`, `%APPDATA%\npm\*.cmd` through `cmd.exe /c`) are untested.
