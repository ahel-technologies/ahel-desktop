# 电脑操作

[English](computer-use.md) | 中文

电脑操作让一次对话回合驱动用户自己的桌面。[动作门控](../../packages/computer-use/action-gate/README.zh.md)把每个调用归类为读或写，在出现任何卡片之前先按内置和个人屏蔽列表拦截，并把每个写操作保持到用户在[审批卡片](../../packages/client/ui-computer-use/README.zh.md)上按下批准为止。执行动作的驱动注册在 `computerUse` 开关下；没有它时，门控报告电脑操作为关闭。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcomputeruseapproval--computerusecontroller"></a>

### `ctx.computerUseApproval` — `ComputerUseController`

Remote namespace `computerUseApproval`.

```ts cordis-catalog
/**
 * The approval card for one pending write.
 * @param callId - the tool call waiting for approval.
 * @returns the card, or null when the call is no longer waiting.
 */
@Remote card(callId: string): ComputerUseCard | null

/**
 * Subscribe to the complete computer-use state, starting with the current one.
 * @param signal - subscription lifetime.
 * @returns views as the state changes.
 */
@Remote({ mode: 'stream' }) async *watch(signal: AbortSignal): AsyncIterable<ComputerUseView>

/** Kill switch: cancel every turn using computer use and turn it off. */
@Remote async stop(): Promise<void>

/**
 * Pause or resume computer use in one session.
 * @param sessionId - the session.
 * @param paused - the new state.
 */
@Remote setPaused(sessionId: string, paused: boolean): void

/**
 * Replace the user's own block list.
 * @param apps - app names or bundle ids.
 */
@Remote async setBlockedApps(apps: string[]): Promise<void>
```

Source: [`packages/client/ui-computer-use/src/index.ts`](../../packages/client/ui-computer-use/src/index.ts)

<a id="ctxcomputerusegate--computerusegate"></a>

### `ctx.computerUseGate` — `ComputerUseGate`

Computer-use gate service.

```ts cordis-catalog
/**
 * The app names and bundle ids this person added to the block list, on top of the built-in one.
 * @returns the user's own block list.
 */
blockedApps(): string[]

/**
 * The card for one pending write.
 * @param callId - the tool call.
 * @returns the card, or null when the call is not waiting.
 */
card(callId: string): ComputerUseCard | null

/**
 * Everything the card, the dock and the Settings row show: the switch, every session's run state and activity, and the block lists.
 * @returns the complete state for the UI.
 */
view(): ComputerUseView

/**
 * Observe state changes.
 * @param listener - called after every change.
 * @returns disposer.
 */
subscribe(listener: () => void): () => void

/**
 * Pause or resume computer use in one session. Paused calls are denied.
 * @param sessionId - the session.
 * @param paused - the new state.
 */
setPaused(sessionId: string, paused: boolean): void

/**
 * Replace the user's block list and save it.
 * @param apps - app names or bundle ids.
 */
async setBlockedApps(apps: readonly string[]): Promise<void>

/**
 * Kill switch: turn computer use off now, cancel every turn that is using
 * it, and save the switch as off.
 */
async stop(): Promise<void>
```

Source: [`packages/computer-use/action-gate/src/index.ts`](../../packages/computer-use/action-gate/src/index.ts)
<!-- END GENERATED cordis-surface -->
