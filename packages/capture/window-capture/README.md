---
description: "Front-window capture for Ahel Desktop: the window's PNG, app name, title and visible text, and the composer attachment files built from them."
kind: "package-reference"
---

# @ahel/dsh-window-capture

## Summary

Captures the front window that is not Ahel Desktop's own: its PNG, the owning app's name, the window title and, when it can be read without a prompt, the window's visible text. The Electron shell (`apps/desktop/src/window-capture.ts`) calls it when the global shortcut fires (default Cmd+Shift+2, macOS only) or the composer's capture button is clicked. The composer plugin [`dsh-client-ui-window-capture`](../../client/ui-window-capture/README.md) turns the result into draft attachments through `windowCaptureFiles`.

## Table of Contents

- [Use this package](#use-this-package)
- [Permissions](#permissions)
- [Third-party code](#third-party-code)
- [Dev Note](#dev-note)

## Use this package

| Export | Meaning |
|---|---|
| `captureFrontWindow(capturer, request)` | Picks the front window, skipping `request.excludeProcessIds`, and returns `WindowCaptureResult` |
| `macWindowCapturer(timeouts)` | macOS backend: CoreGraphics window list through `osascript`, `screencapture -l <id> -o -x`, Accessibility text |
| `./protocol` | Environment-neutral types, the preload bridge contract, `windowCaption` and `windowCaptureFiles` |

`windowCaptureFiles` returns the PNG and, when text was read, a `.txt` file holding the caption line and the text. The caption line is `Window: {app} – {title}`.

## Permissions

- **Screen Recording (macOS).** `screencapture` and window titles need it. The first capture raises the system dialog; after a refusal the shell opens System Settings > Privacy & Security > Screen Recording. It never opens a Keychain or password prompt. Until it is granted the capture reports `permission`.
- **Accessibility (macOS).** The text read runs only when `AXIsProcessTrusted()` is already true, which never prompts. Otherwise the capture carries no text. Secure text fields are skipped.
- **Other platforms.** No backend; the shell leaves the shortcut unregistered and Settings shows "macOS only".

## Third-party code

`src/mac.ts` adapts the window lookup script and `screencapture` arguments of [T3 Code](https://github.com/pingdotgg/t3code) (`apps/desktop/src/snapShot/ActiveWindow.ts`, `MacSnapShot.ts`, revision `f21d6da51c9a`), Copyright (c) 2026 T3 Tools Inc., under the MIT License kept in [`LICENSE-t3code`](LICENSE-t3code).

## Dev Note

The macOS scripts run through `osascript -l JavaScript`; `ObjC.bindFunction` declares the Accessibility C functions because the JXA bridge has no metadata for their out-parameters. The single test drives `captureFrontWindow` with a fake `WindowCapturer`; the real backends need a desktop session.
