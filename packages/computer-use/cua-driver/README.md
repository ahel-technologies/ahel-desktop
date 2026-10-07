---
description: "Computer use through the bundled Cua Driver: embedded stdio MCP server ahel-computer and the Settings switch."
kind: "package-reference"
---

# @ahel/dsh-computer-use-cua-driver

English | [中文](README.zh.md)

## Summary

Runs the pinned [Cua Driver](https://github.com/trycua/cua) (MIT) as a separate executable while `computerUse.enabled` is on. The Host spawns `cua-driver serve --embedded` and `cua-driver mcp --embedded` as direct children and mounts them as MCP server `ahel-computer`, so the driver's tools reach the model as `mcp__ahel-computer__<tool>` and pass the approval gate. It also adds the Settings > General > Computer use (beta) row.

## Table of Contents

- [Use this package](#use-this-package)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

```yaml
- id: computer-use-cua-driver
  name: '@ahel/dsh-computer-use-cua-driver'
```

- Driver: `command` from the profile, then `AHEL_CUA_DRIVER_PATH`, then `Resources/cua-driver/cua-driver` in the packaged app (it must carry the pinned `VERSION`). Without any of them, macOS downloads the pinned archive once into the Harness home and checks both sha256 values from [`cua-driver.release.json`](cua-driver.release.json).
- Permissions: switching on reads macOS Accessibility and Screen Recording for Ahel Desktop and opens the System Settings pane of a missing one. No other prompt, no Keychain.
- Model text: each result's `structuredContent` is appended as JSON. `install_extension`, `install_ffmpeg` and `check_for_update` are refused before dispatch.
- Settings Remote `computerUseDriver`: `current()`, `watch()`, `setEnabled()`, `recheck()`, `openSystemSettings()`.
- Notices shipped with the app: [`licenses/`](licenses/).

Packaging, signing, tool classes and verification: [docs/phase4/COMPUTER-USE.md](../../../docs/phase4/COMPUTER-USE.md).

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`tests/real-driver.e2e.ts` runs the real driver (reads only) when `AHEL_CUA_DRIVER_E2E` names an executable. Unit tests use `tests/fixtures/fake-cua-driver.mjs` and never start the real driver.

</details>
