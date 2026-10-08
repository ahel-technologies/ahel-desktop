---
description: "Team issues in the Web client: the Issues board and list, issue detail, New Issue and Run with Ahel; for users and maintainers of the Ahel surfaces."
kind: "package-reference"
---

# @ahel/dsh-client-ui-issues

English | [中文](README.zh.md)

## Summary

The Issues panel of Ahel Desktop over the signed-in ahel.ai workspace: the board and list with filters, the issue detail drawer, New Issue, and Run with Ahel, which seeds a new chat with the issue and reports the chat's state as the issue's run. While signed in it also claims the runs this person queued on ahel.ai and opens each one's chat. A run acts in the workspace its issue was read in: its chat is pinned there before the first message, its reports and summary go there, and a workspace the person no longer has a seat in fails the run with the reason. A turn that ends on a card waiting for the person (a connector confirm, a held call or a connector question) reports `waiting_approval` or `waiting_input` until the card is pressed or the chat goes on.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount it after `dsh-ahel-account` on the Host; it reads the Host's `ahelIssues` Remote namespace. Other packages open one issue with the `ahel-issues/open` event and ask for a read with `ahel-issues/poll`. The board re-reads every 60 s while the window has focus and on window focus. A detail read that ahel.ai rate-limits or does not answer repeats by itself while the drawer is open, after ahel.ai's Retry-After or a wait that doubles from 2 s up to 30 s, and the drawer says it is waiting instead of showing an error.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`feed.ts` holds the shared issues state and every write; `IssueDetail.tsx` owns the detail reads and their repeat timer; `run.ts` starts and follows a run's chat; `pickup.ts` claims runs queued on ahel.ai.

</details>

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **A board read that fails keeps the last board** — only the detail drawer repeats failed reads by itself.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The `/api/desktop/issues*` shapes live in `dsh-ahel-account`'s `src/issues-types.ts`.

</details>
