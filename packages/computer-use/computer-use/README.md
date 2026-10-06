---
description: "Exclusive computer-use provider registration and the computerUse.enabled switch for Ahel Desktop."
kind: "package-reference"
---

# @ahel/dsh-computer-use

English | [中文](README.zh.md)

## Summary

`ctx.computerUse` holds the person's `computerUse.enabled` switch (volatile `enabled`, default `false`) and the single computer-use provider slot. Settings > General > Computer use (beta) writes the switch; the Cua Driver provider starts and stops the driver from it, and the approval gate denies every computer call while it is off.

## Table of Contents

- [Use this package](#use-this-package)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

```yaml
- id: computer-use
  name: '@ahel/dsh-computer-use'
```

- `ctx.computerUse.enabled` reads the switch; `await ctx.computerUse.setEnabled(on)` saves it into this entry through the Settings service.
- `computer-use/enabled` fires with the new value after it is live.
- `register(name)` reserves the single provider slot until its disposer runs; a second registration throws.

The [computer use subsystem page](../../../docs/subsystems/computer-use.md) and [docs/phase4/COMPUTER-USE.md](../../../docs/phase4/COMPUTER-USE.md) describe the whole feature.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
