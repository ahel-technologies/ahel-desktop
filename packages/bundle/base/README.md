---
description: "The shared chat core for every base-backed dsh --profile surface: model routing, durable sessions, settings, credentials, approvals, and MCP resources, for users composing or customizing a profile."
kind: "package-bundle"
---

# @ahel/dsh-base

English | [中文](README.zh.md)

## Summary

Every base-backed `dsh --profile` surface runs on `dsh-base`, so those surfaces share model routing, durable session history, settings, stored credentials, approval prompts, and MCP resources. The core adds no local agent tools: shell, file, skill, subagent, and web tools come from [`dsh-agent-tools`](../agent-tools/README.md), which the `headless`, `sdk`, and `acp` profiles add. The `web` profile, which the desktop app runs, adds only the browser layer. You rarely touch this bundle directly; change defaults in your profile patch or a later bundle.

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

You get the chat core automatically: the shipped `web`, `headless`, `sdk`, and `acp` profiles list it first, and a custom base-backed profile names it as its first bundle. The shipped `sdk-minimal` profile uses a complete standalone tree instead.

### A minimal custom profile

The core carries no entry point of its own. Pair it with a mode bundle, and list `@ahel/dsh-agent-tools` between them when the agent needs local tools. This profile `package.json` matches the shipped `headless` profile:

```json
{
  "name": "my-profile",
  "private": true,
  "dsh": {
    "profile": {
      "bundles": ["@ahel/dsh-base", "@ahel/dsh-agent-tools", "@ahel/dsh-headless"]
    }
  }
}
```

Run `dsh --profile my-profile "your task"` for a one-shot task. The shipped `web`, `headless`, `sdk`, and `acp` profiles are created for you on first use. To add more bundles, run `dsh plugin --profile <name> add <package>`; in-box bundles resolve from the dsh installation. The profile contract is documented in the [app-boot profile section](../../boot/app-boot/README.md).

### What you get

Every profile built on this core provides the following behavior:

- **Model routing** through the multi-provider [pi-ai adapter](../../llm/llm-pi-ai/README.md). It registers no model route until you add a provider in **Settings → Models** or in a `llm-pi-ai:` settings section. No provider is pinned: a saved model selection wins, and otherwise the first configured route serves the request.
- **Credentials** resolved per request. The inherited environment wins over the managed `$DSH_HOME/.credentials.yaml`, with project and user `.env` files as fallbacks. The Models page writes only the managed file.
- **Durable sessions** under `$DSH_HOME/sessions`, with generated titles, image attachments, and session projections. Full-text session search is off; exact reads, titles, and lineage reads still work.
- **Settings and live configuration editing**, plus the plugin manager, when a profile backs the process.
- **The default permission policy**: `workspace-write` with approval prompts, overridden by `DSH_PERMISSION_MODE`. The sandboxed filesystem provider is the single file-write path.
- **Session services**: slash commands, `/feedback`, token metering, tool-call timeouts, output spill, image-budget retry, and repeated-tool reminders.

The bundle mounts [MCP resources](../../mcp/mcp-resources/README.md) once. Configure only [MCP client entries](../../mcp/mcp-client/README.md) for the servers you need. Clients mounted by another provider also count as configured in their scope. Callers with no configured server in scope receive no MCP tools or prompt text.

### Changing the defaults

To change what a profile built on this core provides — a stricter permission mode, content search, extra tools — edit your profile's `cordis.patch.yml` or add a later bundle. Each patch entry replaces the target's whole configuration, so restate every setting you want to keep. Keep the sandboxed filesystem provider as the single file-write path: adding the plain filesystem provider on top of it makes the profile fail to load.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The bundle is a static patch document: one `insert` list applied over the empty profile root. It mounts no service, emits no events, and holds no mutable state; each inserted row's package owns that row's behavior and invariants.

### Composition mechanics

A patch replaces the targeted row's whole `config` rather than merging into it. Later bundle layers and the user's profile `cordis.patch.yml` override rows by id, with the last write winning per row. Rows whose value differs by mode do not live here: each mode bundle restates its complete configuration, keeping any single row down to one bundle layer plus the user's. The full row set and its rationale are documented inline in [`cordis.patch.yml`](cordis.patch.yml); the [generated composition graph](../../../apps/cli/composition.md) renders it.

### Chat core and tool plane

The local tool plane and the telemetry rows live in [`dsh-agent-tools`](../agent-tools/README.md), a separate layer that profiles list after this one. The `web` profile does not list it, so the desktop runtime loads none of those packages. Its tool rows consume services that this core provides, such as the sandbox policy and approvals.

### Source map

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | The bundle substance: the chat-core plugin rows, with per-row rationale as inline comments |
| [`src/index.ts`](src/index.ts) | Package entry; carries no runtime API |
| [`tests/base.spec.ts`](tests/base.spec.ts) | Manifest declaration, the unpinned default model, and the absence of tool, telemetry, and DeepSeek service rows |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when you want to go deeper into profiles, the surfaces built on this core, or the exact composition.

- [app-boot profile section](../../boot/app-boot/README.md) — how profiles are resolved, layered, and customized.
- [Bundle package map](../README.md) — the surfaces built on this core.
- [dsh-agent-tools](../agent-tools/README.md) — the local tool plane that the `headless`, `sdk`, and `acp` profiles add.
- [Generated composition graph](../../../apps/cli/composition.md) — the exact plugin set each shipped profile uses.
- [Profile plugin bundles note](../../../.agents/notes/implemented/architecture/2026-08-05-profile-plugin-bundles.md) — the profile and bundle composition design.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through each inserted row's package, which owns that row's model-facing behavior.

#### KV Cache effect

The bundle itself adds no request prefix; each inserted row's package owns any cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits tell you when the core needs extra care or where an override must go. They are current package constraints, not a general comparison or a task backlog.

- **A fresh profile has no model** — the pi-ai adapter registers no route until you configure a provider, so the agent cannot answer until you add a model in **Settings → Models** or a `llm-pi-ai:` settings section.
- **Only the `web` profile's bundles ship in the dsh runtime** — `dsh-agent-tools` and the `headless`, `sdk`, and `acp` mode bundles are development dependencies of the CLI, so those profiles work from a source checkout only.
- **Overrides replace whole settings blocks** — a patch entry replaces the target's entire configuration, so your override must restate every setting you want to keep; nothing merges automatically.
- **Per-surface settings belong to the surface's bundle** — a default that differs between the web GUI and headless mode lives in that surface's bundle, not in the shared core.
- **Full-text session search is off** — the `session-query-sqlite` row keeps `openAt: never`; a later patch layer sets `openAt: first-search` or `startup` to enable content search.
- **Adding the plain filesystem provider on top of the sandboxed one fails the profile** — the two register the same service, so the profile refuses to load; use one or the other.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
