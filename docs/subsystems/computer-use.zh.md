# 电脑操作

[English](computer-use.md) | 中文

电脑操作让一次对话回合驱动用户自己的桌面。[动作门控](../../packages/computer-use/action-gate/README.zh.md)把每个调用归类为读或写，在出现任何卡片之前先按内置和个人屏蔽列表拦截，并把每个写操作保持到用户在[审批卡片](../../packages/client/ui-computer-use/README.zh.md)上按下批准为止。执行动作的驱动注册在 `computerUse` 开关下；没有它时，门控报告电脑操作为关闭。

## 开关与驱动

[`dsh-computer-use`](../../packages/computer-use/computer-use/README.zh.md) 持有 `computerUse.enabled`（默认关闭）和唯一的提供者槽位。设置 > 通用 > 电脑操作（测试版）通过 Settings 服务写入开关；新值生效后触发 `computer-use/enabled`。开关打开时，[`dsh-computer-use-cua-driver`](../../packages/computer-use/cua-driver/README.zh.md) 把固定版本的 Cua Driver 作为独立可执行文件运行，并挂载为 MCP 服务器 `ahel-computer`，因此其工具以 `mcp__ahel-computer__<tool>` 进入门控。门控的停止控件会把开关保存为关闭，从而停止驱动。

## 驱动版本与权限

驱动版本在 `cua-driver.release.json` 中按版本、URL 和 sha256 固定。打包的 macOS 版本在 `Resources/cua-driver/` 中携带已校验的可执行文件；不含它的构建会在首次运行前下载一次固定的压缩包，并校验两个哈希。在 macOS 上，打开开关会读取 Ahel Desktop 的辅助功能和屏幕录制权限，缺少时打开对应的系统设置面板。它不弹出其他提示，也不访问钥匙串。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
