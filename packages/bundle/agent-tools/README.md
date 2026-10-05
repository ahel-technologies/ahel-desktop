---
description: "The local agent tool plane for headless, SDK, and ACP profiles: shell, files, skills, subagents, workflows, jobs, goals, plan mode, web fetch, and opt-in telemetry, for users composing or customizing a profile."
kind: "package-bundle"
---

# @deepseek-ai/dsh-agent-tools

English | [中文](README.zh.md)

## Summary

`dsh-agent-tools` turns the chat core into a local coding agent: shell commands, file reading and editing, file search, skills, subagents, programmatic tool calls, workflows, background jobs, goals, todo lists, plan mode, and web fetch. The `headless`, `sdk`, and `acp` profiles list it between `dsh-base` and their mode bundle. The `web` profile and the desktop app do not load it. Telemetry rows ship disabled with no collector URL, and web search has no shipped provider. The package is private and resolves from a source checkout.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The shipped `headless`, `sdk`, and `acp` profiles already list this bundle, so a source checkout gives those profiles the full tool set with no further configuration.

### Add it to a profile

List the bundle after `@deepseek-ai/dsh-base` and before the mode bundle in the profile `package.json`. The shipped `headless` profile uses this order:

```json
{
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-agent-tools", "@deepseek-ai/dsh-headless"]
    }
  }
}
```

The `dsh` CLI lists this package as a development dependency, not a runtime dependency. Outside a source checkout the launcher cannot resolve it, reports it as a skipped bundle at startup, and loads the remaining layers. The profile contract is documented in the [app-boot profile section](../../boot/app-boot/README.md).

### What you get

The bundle adds the following behavior on top of the chat core:

- **Shell commands** through the sandboxed bash tool on macOS and Linux, or the PowerShell twin on Windows.
- **File tools**: read, write, edit, and search inside the workspace, plus `AGENTS.md` instructions loaded into the prompt.
- **Skills** from the filesystem, loaded through the skill tool.
- **Subagents**: fresh (`subagent`) and history-seeded (`subagent_fork`) in-process children, with follow-up messaging and child listing.
- **Programmatic tool calls and workflows** on the Node PTC runtime, plus background jobs.
- **Planning aids**: todo lists, persisted session goals with `/goal`, and plan mode.
- **Context compaction** with `/compact` and tool-result pruning.
- **Web fetch** of public HTTP(S) pages without per-call approval; the fetch provider rejects non-public destinations.
- **Permission presets** `read-only`, `workspace-write`, and `danger-full-access` over the core's sandbox policy and approvals.

### Shell tools per platform

On macOS and Linux you get the bash shell tools; on Windows you get the PowerShell twins instead, so exactly one shell stack is available per machine. The safety behavior is identical on every platform. A Windows host that prefers the unconfined PowerShell executor can switch the shell rows in its profile patch — the switch must disable both PowerShell rows and re-enable both bash rows, otherwise the profile fails to load.

### Optional tools

Default file editing uses `read`, `write`, and `edit`. The `str_replace_editor` tool remains available as an explicit opt-in. To add it to a profile with this bundle, put this entry in the profile, home, or invocation patch:

```yaml
- insert:
    - id: tool-str-replace-editor
      name: '@deepseek-ai/dsh-tool-str-replace-editor'
      config:
        maxOutputChars: 16000
```

The `ralph` iteration tool ships disabled; a later patch layer restores it with `- id: tool-ralph` and `disabled: false`. Web search needs a provider: mount one, such as `@deepseek-ai/dsh-web-search-exa`, and name it in the `web` row's `searchProvider`.

### Telemetry opt-in

The `otel` and `session-telemetry-otel` rows ship with `disabled: true`, and the exporter URL defaults to an empty string, so no session record leaves the process. To export, set `DSH_TELEMETRY_OTLP_URL` to a full OTLP logs endpoint and enable both rows in a later patch layer:

```yaml
- id: otel
  disabled: false
- id: session-telemetry-otel
  disabled: false
```

`DSH_TELEMETRY_MODE` selects `FEEDBACK_ONLY` (the default) or `DISABLED`; the [OTel session-telemetry backend](../../session/session-telemetry-otel/README.md) documents what each mode sends.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The bundle is a static patch document: one `insert` list applied after the `dsh-base` layer. It mounts no service of its own; each inserted row's package owns that row's behavior and invariants. The rows consume services that the core provides, such as the sandbox policy, approvals, the tool registry, and the sandboxed filesystem.

### Composition mechanics

A patch replaces the targeted row's whole `config` rather than merging into it. Later bundle layers and the user's profile `cordis.patch.yml` override rows by id, with the last write winning per row. The full row set and its rationale are documented inline in [`cordis.patch.yml`](cordis.patch.yml); the [generated composition graph](../../../apps/cli/composition.md) renders it.

### Platform gating

The patch gates the two shell stacks by platform on its own rows: `bash-sandbox` and `tool-bash` carry `disabled: !!js process.platform === 'win32'`, and their twins `pwsh-sandbox` and `tool-pwsh` mount on win32 only with the inverted expression. The permission surface stays identical to POSIX: the sandbox policy executes the same file-effect policy through the Windows ACL restricted-token runner (`dsh-sandbox-local` → `@deepseek-ai/dsh-sandbox-windows-acl`), and the core's `fs-sandbox` keeps fencing `ctx.fs` writes.

### Source map

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | The bundle substance: the tool-plane and telemetry rows, with per-row rationale as inline comments |
| [`src/index.ts`](src/index.ts) | Package entry; carries no runtime API |
| [`tests/agent-tools.spec.ts`](tests/agent-tools.spec.ts) | Manifest declaration, disabled telemetry without a collector, web fetch rows, and symmetric platform gating |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when you want to go deeper into profiles, the core under this layer, or the exact composition.

- [dsh-base](../base/README.md) — the chat core this layer builds on.
- [Bundle package map](../README.md) — the profiles that list this layer.
- [app-boot profile section](../../boot/app-boot/README.md) — how profiles are resolved, layered, and customized.
- [Generated composition graph](../../../apps/cli/composition.md) — the exact plugin set each shipped profile uses.
- [Codex provider bundle](../../subagent/subagent-codex/README.md) — an optional subagent provider you can install on top.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through each inserted row's package, which owns that row's model-facing behavior.

#### KV Cache effect

The bundle itself adds no request prefix; each inserted row's package owns any cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits tell you where the tool plane needs extra care or where an override must go. They are current package constraints, not a general comparison or a task backlog.

- **Not shipped in the dsh runtime** — the package is private and a development dependency of the CLI, so only a source checkout resolves it.
- **No web composition** — the `web` profile does not list this bundle, and no shipped test covers that combination.
- **Overrides replace whole settings blocks** — a patch entry replaces the target's entire configuration, so your override must restate every setting you want to keep; nothing merges automatically.
- **Windows temp grants are private per-session subdirectories** — `workspace-write` confines writes to the workspace plus the session's own temp subdirectory (`<temp>\dsh-<hash>`, TMP/TEMP rewritten for confined children); `read-only` grants nothing. See `@deepseek-ai/dsh-sandbox-windows-acl`.
- **Web search has no default provider** — the `web_search` tool has no backend until a profile mounts a search provider and names it in `searchProvider`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
