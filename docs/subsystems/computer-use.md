# Computer use

English | [中文](computer-use.zh.md)

Computer use lets a chat turn drive the person's own desktop. The [action gate](../../packages/computer-use/action-gate/README.md) classifies every call as a read or a write, blocks the built-in and personal block lists before any card, and holds each write until the person presses Approve on the [approval card](../../packages/client/ui-computer-use/README.md). The driver that performs the actions registers under the `computerUse` switch; without it the gate reports computer use as off.

## The switch and the driver

[`dsh-computer-use`](../../packages/computer-use/computer-use/README.md) owns `computerUse.enabled` (off by default) and the single provider slot. Settings > General > Computer use (beta) writes the switch through the Settings service; `computer-use/enabled` fires after the new value is live. While it is on, [`dsh-computer-use-cua-driver`](../../packages/computer-use/cua-driver/README.md) runs the pinned Cua Driver as a separate executable and mounts it as MCP server `ahel-computer`, so its tools reach the gate as `mcp__ahel-computer__<tool>`. The gate's Stop control saves the switch as off, which stops the driver.

## Driver release and permissions

The driver release is pinned by version, URL and sha256 in `cua-driver.release.json`. Packaged macOS builds carry the verified executable in `Resources/cua-driver/`; a build without it downloads the pinned archive once and checks both hashes before the first run. On macOS, switching on reads Accessibility and Screen Recording for Ahel Desktop and opens the matching System Settings pane when one is missing. It raises no other prompt and never touches the Keychain.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcomputeruse--computeruseregistry"></a>

### `ctx.computerUse` — `ComputerUseRegistry`

Owns one optional provider registration and the person's on switch.

```ts cordis-catalog
/**
 * Persist the person's on switch into this plugin's profile entry. The
 * Loader applies it live and `computer-use/enabled` follows.
 * @param enabled - the requested value.
 * @returns after the profile write.
 */
async setEnabled(enabled: boolean): Promise<void>

/**
 * Reserve the sole provider slot until the contribution is disposed.
 * A second registration fails even when it repeats the current name. Providers
 * must stop their tools and await owned work before releasing this registration.
 * @param name - provider-owned name used in registration diagnostics.
 * @returns the effect disposer for this exact registration.
 */
register(name: ComputerUseProviderName): () => Promise<void>
```

Source: [`packages/computer-use/computer-use/src/index.ts`](../../packages/computer-use/computer-use/src/index.ts)

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

<a id="ctxcomputerusedriver--cuadrivercomputeruse"></a>

### `ctx.computerUseDriver` — `CuaDriverComputerUse`

Owns the driver's lifetime, its permission status, and the Settings Remote.

```ts cordis-catalog
/**
 * Read the current status.
 * @returns the switch, driver phase and macOS permissions.
 */
@Remote current(): ComputerUseDriverStatus

/**
 * Stream the status now and after every change.
 * @param signal - subscriber lifetime.
 * @returns status snapshots until cancellation or service disposal.
 */
@Remote({ mode: 'stream' }) async *watch(signal: AbortSignal): AsyncIterable<ComputerUseDriverStatus>

/**
 * Turn computer use on or off for this profile (the `computerUse.enabled`
 * setting). Turning it on reads the macOS grants and, when one is missing,
 * opens System Settings at that pane. It raises no macOS prompt.
 * @param enabled - the requested value.
 * @returns the status after the write.
 */
@Remote async setEnabled(enabled: boolean): Promise<ComputerUseDriverStatus>

/**
 * Re-read the macOS grants. A grant that changed while the driver runs
 * restarts the driver, because macOS caches grants per process.
 * @returns the status after the check.
 */
@Remote async recheck(): Promise<ComputerUseDriverStatus>

/**
 * Open System Settings at the Privacy & Security pane for one permission.
 * @param pane - the permission to show.
 */
@Remote async openSystemSettings(pane: ComputerUseSettingsPane): Promise<void>
```

Source: [`packages/computer-use/cua-driver/src/index.ts`](../../packages/computer-use/cua-driver/src/index.ts)

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

<a id="computer-use-events"></a>

### `computer-use/*` events

<a id="computer-useenabled--emit"></a>

#### `computer-use/enabled` — emit

The person turned computer use on or off. Emitted after the new value is live.

```ts cordis-catalog
/**
 * The person turned computer use on or off. Emitted after the new value is live.
 * @param enabled - the value `ctx.computerUse.enabled` now reads.
 * @mode emit
 */
'computer-use/enabled'(enabled: boolean): void
```

Source: [`packages/computer-use/computer-use/src/index.ts`](../../packages/computer-use/computer-use/src/index.ts)
<!-- END GENERATED cordis-surface -->
