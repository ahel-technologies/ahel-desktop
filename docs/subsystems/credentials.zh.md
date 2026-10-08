# 用户凭据

[English](credentials.md) | 中文

[dsh-credentials](../../packages/credentials/credentials) 的凭据 seam 把机密挡在配置之外：settings 分节与 `cordis.yml` 条目携带的是*引用*（环境变量名），值归 [dsh-credentials-local](../../packages/credentials/credentials-local) 这类提供方所有，消费方每个操作解析一次引用——LLM（大语言模型）适配器每次模型请求解析一次，因此轮换后的凭据无需任何重启即可作用于紧随其后的下一次请求。一条 seam 级规则约束每个提供方：空的存储值在任何地方都视为不存在。

来源：[`packages/credentials/credentials/src/index.ts`](../../packages/credentials/credentials/src/index.ts)

## 标识

引用以 POSIX 风格环境变量名命名一条凭据。brand 防止调用方将凭据引用与在包或进程之间传递的其他字符串混用；构造时校验 shell 标识符语法。

```ts type-equiv
/** Nominal reference to one credential: a POSIX-style environment-variable name. */
type CredentialRef = Branded<'CredentialRef'>
```

## 解析

`resolve(ref)` 返回值及提供该值的来源层（由提供方定义）；未配置期间返回 `undefined`。消费方在每个操作中重新解析，绝不跨操作缓存——这种按操作进行的读取正是热更新机制。

```ts type-equiv
/** One resolved credential value and the source layer that supplied it. */
interface ResolvedCredential {
  /** The non-empty secret value. */
  value: string
  /** Provider-defined source layer id (the local provider uses `env`, `file`, `project-env`, and `user-env`). */
  source: string
}
```

## 描述

`describe(ref)` 在绝不暴露值的前提下回应配置界面：引用当前是否可解析、来自哪一层、`set` 当前能否成功。本地提供方把由当前进程环境供值的引用报告为 `writable: false`——那样的写入会表面成功而解析持续返回遮蔽值，因此 seam 直接拒绝，界面也得以提前把该引用渲染为只读。

```ts type-equiv
/**
 * Source and writability facts for one reference, safe for configuration UIs —
 * never the value. The view has no slot a value could ride in, which is what
 * lets the whole read half cross the Remote wire.
 */
interface CredentialInfo {
  /** Whether resolving the reference would currently return a value. */
  configured: boolean
  /** Source layer currently supplying the value; absent while unconfigured. */
  source?: string
  /** Whether the active provider can write this reference. */
  writable: boolean
}
```

## 已提交的变更

`credentials/reference-updated (ref)` 在提供方管理的来源发生已提交变更后发出——`set`、`unset` 或在存储中观察到的外部编辑。进程环境自身的变化不可观测，永不发出事件。消费方不需要该事件（它们按操作重新解析）；它服务于配置界面刷新「已配置」徽标。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxahelaccount--ahelaccount"></a>

### `ctx.ahelAccount` — `AhelAccount`

Account service; the default export loads it as a plugin.

```ts cordis-catalog
/**
 * Read the stored-account presence, its profile and the latest attempt.
 * @returns a snapshot without tokens.
 */
@Remote async state(): Promise<AhelAccountView>

/**
 * Host-only: record one metered model request's hold or settle. Subscribers
 * of `watch` receive a new view; `ahel-account/changed` does not fire,
 * because the sign-in and the workspace are unchanged.
 * @param billing - the amounts the Ahel model route read from ahel.ai.
 */
reportBilling(billing: AhelBilling): void

/**
 * Choose the ahel.ai workspace the MCP server and Ahel models act in, and
 * save it in settings.
 * @param id - one of the profile's workspace ids, or null for the account default.
 * @returns the view after the choice is applied.
 */
@Remote async selectWorkspace(id: string | null): Promise<AhelAccountView>

/**
 * Host-only: the selected workspace id while it is one of the signed-in person's workspaces.
 * @returns the id, or undefined for the account default.
 */
async workspace(): Promise<string | undefined>

/**
 * Host-only: the workspace one chat acts in for its model requests and tool calls, whatever workspace is selected.
 * @param sessionId - the chat's Session id.
 * @returns the chat's stamp (a subagent's parent chat's) once the chat took a step or a tool call this Host run,
 *   or undefined for a chat that follows the selected workspace.
 */
chatWorkspace(sessionId: string): string | undefined

/**
 * Host-only: record the workspace one chat acts in; `./chat-workspace.ts` calls it from the chat's stamp.
 * @param sessionId - the chat's Session id.
 * @param workspace - the ahel.ai workspace id.
 */
bindChat(sessionId: string, workspace: string): void

/**
 * Start a chat that has taken no step yet in one workspace, for example a queued issue run in the
 * issue's workspace: the chat lists there and acts there whatever workspace is selected later.
 * The seat is checked against the profile ahel.ai answers now, else the stored one.
 * @param session - lookup parameter resolved from the Session identity.
 * @param workspace - the ahel.ai workspace id.
 * @throws RemoteError `ahel-account/workspace-unavailable` when the account has no seat there,
 *   or the chat already acts in another workspace.
 */
@Remote async pinChat(session: Session, workspace: string): Promise<void>

/**
 * Join the running attempt or start a browser sign-in. Resolves once the
 * authorize URL exists (or the attempt failed), without waiting for the
 * person to approve; the opener, when set, has been asked to open it.
 * @returns the view with `attempt.authorizeUrl` for a shell that opens the browser itself.
 */
@Remote async signIn(): Promise<AhelAccountView>

/**
 * Cancel only the named attempt.
 * @param id - attempt to cancel.
 * @returns the view after the attempt settled.
 */
@Remote async cancelSignIn(id: AhelSignInAttemptId): Promise<AhelAccountView>

/**
 * Revoke the grant on ahel.ai, then delete the stored credential. A failed
 * revoke is logged and never keeps the local grant.
 * @returns the signed-out view.
 */
@Remote async signOut(): Promise<AhelAccountView>

/**
 * Read name, email and workspaces live from ahel.ai.
 * @returns the profile, or null while signed out.
 */
@Remote async profile(): Promise<AhelProfile | null>

/**
 * Subscribe to complete views, starting with the current one.
 * @param signal - subscription lifetime; ending it never cancels a sign-in.
 * @returns views as account state changes.
 */
@Remote({ mode: 'stream' }) async *watch(signal: AbortSignal): AsyncIterable<AhelAccountView>

/**
 * Host-only: a bearer valid for at least `refreshSkewMs`, refreshed and
 * written back first when needed. A refresh ahel.ai rejects signs the
 * account out.
 * @returns the access token, or undefined while signed out.
 */
async accessToken(): Promise<string | undefined>

/**
 * Host-only: the Ahel MCP gateway URL this grant's bearer is bound to; Host
 * callers send the bearer to this URL and nowhere else.
 * @returns the configured `resource`.
 */
gateway(): string

/**
 * Host-only: after ahel.ai refused the current bearer, refresh it once. A
 * refresh ahel.ai rejects signs the account out, like `accessToken()`. A
 * launched Host keeps the stored record on a rejection (keepRejected): its
 * replacement may already have written a fresh grant to the shared volume.
 */
async revalidate(): Promise<void>

/**
 * Host-only: set the browser opener used by later sign-ins. Without one,
 * the authorize URL is logged and returned in the view.
 * @param opener - the shell's external opener.
 * @returns a disposer that restores the previous opener.
 */
setOpener(opener: ExternalOpener): () => void
```

Types: [Session](session.zh.md)

Source: [`packages/credentials/ahel-account/src/index.ts`](../../packages/credentials/ahel-account/src/index.ts)

<a id="ctxahelcatalog--ahelcatalog"></a>

### `ctx.ahelCatalog` — `AhelCatalog`

Child service of `AhelAccount`; the Remote namespace `ahelCatalog`.

```ts cordis-catalog
/**
 * One page of the Discover listing; works signed out.
 * @param query - search words, kind, category and page.
 * @returns the page with every link and mark made absolute on ahel.ai.
 * @throws RemoteError `ahel-catalog/busy` or `ahel-catalog/unreachable`.
 */
@Remote async browse(query: CatalogBrowseQuery): Promise<CatalogBrowsePage>

/**
 * A further slice of one group's nested skills.
 * @param query - the query the group was listed under.
 * @param groupKey - `CatalogGroup.key`.
 * @param offset - rows of the nest already shown.
 * @returns the slice and how many rows remain.
 * @throws RemoteError `ahel-catalog/busy` or `ahel-catalog/unreachable`.
 */
@Remote async browsePart(query: CatalogBrowseQuery, groupKey: string, offset: number): Promise<CatalogPart>

/**
 * The signed-in person's capabilities in the selected workspace.
 * @returns the rows, or `signedIn: false` with none while signed out.
 * @throws RemoteError `ahel-catalog/signed-out`, `ahel-catalog/refused` or `ahel-catalog/unreachable`.
 */
@Remote async installed(): Promise<CatalogInstalled>

/**
 * Install one catalog item, or answer how to connect an "app:<service>" row.
 * Named `add` because the client's Remote namespace service keeps `install` for itself.
 * @param id - `CatalogRow.id`.
 * @returns the install outcome; `needs_setup` carries the URL to open in the browser.
 * @throws RemoteError `ahel-catalog/signed-out`, `ahel-catalog/refused` or `ahel-catalog/unreachable`.
 */
@Remote async add(id: string): Promise<CatalogInstallResult>

/**
 * Turn one installed capability on or off.
 * @param key - `CatalogCapability.key`.
 * @param on - the wanted state.
 * @returns the state ahel.ai stored.
 * @throws RemoteError `ahel-catalog/signed-out`, `ahel-catalog/refused` or `ahel-catalog/unreachable`.
 */
@Remote async setEnabled(key: string, on: boolean): Promise<CatalogSwitchResult>

/**
 * ahel.ai's four Knowledge products, as its /knowledge page draws them; works signed out.
 * @returns the products, or null while ahel.ai has no `/api/public/knowledge-products`.
 * @throws RemoteError `ahel-catalog/busy` or `ahel-catalog/unreachable`.
 */
@Remote async knowledgeProducts(): Promise<KnowledgeProduct[] | null>
```

Source: [`packages/credentials/ahel-account/src/catalog.ts`](../../packages/credentials/ahel-account/src/catalog.ts)

<a id="ctxahelissues--ahelissues"></a>

### `ctx.ahelIssues` — `AhelIssues`

Child service of `AhelAccount`; the Remote namespace `ahelIssues`.

```ts cordis-catalog
/**
 * One page of issues with per-status counts and the number of agents at work, read in the selected
 * workspace, else in the account default the team summary names, so the page names a real workspace id.
 * @param query - filters; `assigneeId: 'me'` is the signed-in person.
 * @returns the page.
 * @throws RemoteError `ahel-issues/*`.
 */
@Remote async list(query: IssueQuery): Promise<IssuePage>

/**
 * Create an issue.
 * @param draft - its fields.
 * @returns the stored issue.
 * @throws RemoteError `ahel-issues/refused` for invalid fields.
 */
@Remote async create(draft: IssueDraft): Promise<IssueWriteAnswer>

/**
 * Read one issue.
 * @param key - for example `AHEL-137`.
 * @param workspace - the workspace to read it in; the selected one when omitted.
 * @returns the issue.
 * @throws RemoteError `ahel-issues/refused` for an unknown key.
 */
@Remote async get(key: string, workspace?: string): Promise<IssueWriteAnswer>

/**
 * Change some fields of one issue.
 * @param key - the issue.
 * @param patch - only the fields to change.
 * @returns the issue after the change.
 * @throws RemoteError `ahel-issues/forbidden` with ahel.ai's reason when the role may not edit it.
 */
@Remote async update(key: string, patch: IssuePatch): Promise<IssueWriteAnswer>

/**
 * Delete one issue; ahel.ai allows it for owners only. (`remove` is reserved by the Remote namespace service.)
 * @param key - the issue.
 * @returns nothing.
 * @throws RemoteError `ahel-issues/forbidden` with ahel.ai's reason.
 */
@Remote async deleteIssue(key: string): Promise<IssueWriteAnswer>

/**
 * The comments on one issue, oldest first.
 * @param key - the issue.
 * @returns the comments.
 * @throws RemoteError `ahel-issues/*`.
 */
@Remote async comments(key: string): Promise<readonly IssueComment[]>

/**
 * Post a comment as the signed-in person, or for the Ahel agent (a run's summary).
 * @param key - the issue.
 * @param body - markdown.
 * @param authorType - `agent` shows the comment as Ahel's; the person still owns it.
 * @param issueWorkspace - the issue's workspace, for a run's summary.
 * @param sessionId - the run's chat; without `issueWorkspace` the comment goes to the workspace that chat acts in, else the selected one.
 * @returns the comments after the post.
 * @throws RemoteError `ahel-issues/forbidden` or `ahel-issues/refused`.
 */
@Remote async comment( key: string, body: string, authorType: IssueActorType, issueWorkspace?: string, sessionId?: string, ): Promise<readonly IssueComment[]>

/**
 * The activity log of one issue, oldest first.
 * @param key - the issue.
 * @returns the activity lines.
 * @throws RemoteError `ahel-issues/*`.
 */
@Remote async activity(key: string): Promise<readonly IssueActivity[]>

/**
 * Report the state of the desktop chat that works on one issue; ahel.ai moves the issue's status with it.
 * The first report on a queued run claims it; when another session holds the run, ahel.ai answers 409 `run_claimed`.
 * An ahel.ai that refuses `waiting_input` (400) gets the same report as `waiting_approval`.
 * @param key - the issue.
 * @param report - the session, its state and the steps so far.
 * @param runWorkspace - the run's workspace (the issue's); when omitted, the workspace the run's chat acts in, else the selected one.
 * @returns the issue after the report.
 * @throws RemoteError `ahel-issues/refused` with `details.error === 'run_claimed'` when another session holds the run,
 *   or another `ahel-issues/*`.
 */
@Remote async run(key: string, report: IssueRunReport, runWorkspace?: string): Promise<IssueWriteAnswer>

/**
 * Who issues can be assigned to: the workspace's seats and the Ahel agent with its model.
 * @returns the members and agents.
 * @throws RemoteError `ahel-issues/*`.
 */
@Remote async assignees(): Promise<IssueAssignees>

/**
 * The workspace's projects.
 * @returns the projects.
 * @throws RemoteError `ahel-issues/*`.
 */
@Remote async projects(): Promise<readonly IssueProject[]>

/**
 * Create a project.
 * @param name - its name.
 * @returns the projects after the create.
 * @throws RemoteError `ahel-issues/forbidden` or `ahel-issues/refused`.
 */
@Remote async createProject(name: string): Promise<readonly IssueProject[]>

/**
 * Mark one issue row of the Inbox read.
 * @param id - `IssueInboxItem.id`.
 * @returns how many rows changed.
 * @throws RemoteError `ahel-issues/*`.
 */
@Remote async readItem(id: string): Promise<number>
```

Source: [`packages/credentials/ahel-account/src/issues.ts`](../../packages/credentials/ahel-account/src/issues.ts)

<a id="ctxahelteam--ahelteam"></a>

### `ctx.ahelTeam` — `AhelTeam`

Child service of `AhelAccount`; the Remote namespace `ahelTeam`.

```ts cordis-catalog
/**
 * The sidebar and account-menu poll: pending approvals, unread handoffs and the balance.
 * @returns the summary; a part ahel.ai could not read is null.
 * @throws RemoteError `ahel-team/*`.
 */
@Remote async summary(): Promise<DesktopSummary>

/**
 * The workspace's metered models with ahel.ai's facts: short name, maker,
 * "best for" line, typical message price and the workspace's last charge.
 * @returns the rows in ahel.ai's order; `ahel` is null from an ahel.ai that sends no facts.
 * @throws RemoteError `ahel-team/*`.
 */
@Remote async models(): Promise<AhelMeteredModel[]>

/**
 * The workspace's default metered model, where new chats start.
 * @returns the default; `defaultModel` is null when the owner chose none.
 * @throws RemoteError `ahel-team/outdated` from an ahel.ai without the route.
 */
@Remote async workspaceModel(): Promise<AhelWorkspaceModel>

/**
 * Set the workspace's default metered model. Only the owner or an admin may.
 * @param model - a model id from `models()`, or null to clear the default.
 * @returns the stored default.
 * @throws RemoteError `ahel-team/forbidden` for a Member, `ahel-team/refused` for an unknown model.
 */
@Remote async setWorkspaceModel(model: string | null): Promise<AhelWorkspaceModel>

/**
 * Approve or decline one held call. Nothing runs here: approve opens a one-hour
 * window in which the requester's AI repeats the exact call.
 * @param id - `ApprovalRow.id`.
 * @param decision - the answer.
 * @param note - an optional note for the requester, up to 500 characters.
 * @returns the stored decision.
 * @throws RemoteError `ahel-team/forbidden` for a Member, `ahel-team/refused` when it expired or was answered.
 */
@Remote async decideApproval(id: string, decision: 'approved' | 'declined', note: string | null): Promise<ApprovalDecision>

/**
 * The workspace's managed sign-ins and whether this seat may change them.
 * @returns status only, never a token.
 * @throws RemoteError `ahel-team/*`.
 */
@Remote async signIns(): Promise<VaultSignInList>

/**
 * One app's Connect state: the key form for a key app, its sign-in for a sign-in app.
 * @param app - a catalog item id, stack key, vendor slug or `app:<service>`.
 * @returns the panel, the sign-in and the app's ahel.ai vault page.
 * @throws RemoteError `ahel-team/*`.
 */
@Remote async connectPanel(app: string): Promise<KeyConnectAnswer>

/**
 * Seal a key app's values in the workspace vault, install it and switch it on.
 * The values go to `POST /api/desktop/connect` only and are never logged or put in an error.
 * @param app - `KeyConnectView.app`.
 * @param values - `KeyConnectField.id` to the typed value.
 * @returns the panel after the save.
 * @throws RemoteError `ahel-team/forbidden` for a Member, `ahel-team/refused` for invalid fields.
 */
@Remote async connect(app: string, values: Record<string, string>): Promise<KeyConnectSaved>

/**
 * Forget an app's sign-in or stored key; the installed row stays.
 * @param app - the name `connectPanel` took.
 * @returns whether anything was removed.
 * @throws RemoteError `ahel-team/refused` with `webUrl` when the app has several accounts.
 */
@Remote async disconnect(app: string): Promise<VaultDisconnected>

/**
 * Handoffs received and sent.
 * @returns the Inbox.
 * @throws RemoteError `ahel-team/*`.
 */
@Remote async inbox(): Promise<HandoffList>

/**
 * Read one handoff and mark it read.
 * @param id - a handoff id from the Inbox.
 * @returns the handoff with its reader-safe text.
 * @throws RemoteError `ahel-team/refused` when it is not available to this person.
 */
@Remote async openHandoff(id: string): Promise<HandoffRead>

/**
 * The editable preview of a handoff with the teammate list; stores nothing.
 * @param draft - title and sections.
 * @returns the preview with the `requestKey` Share needs.
 * @throws RemoteError `ahel-team/refused` for invalid text or a plan without handoffs.
 */
@Remote async prepareHandoff(draft: HandoffDraft): Promise<HandoffReview>

/**
 * Deliver a reviewed handoff. Only the dialog's Share button calls this; that press is the person's confirmation.
 * @param share - the reviewed draft, the chosen teammates and the preview's `requestKey`.
 * @returns the delivery; a retry with the same `requestKey` answers `repeated: true`.
 * @throws RemoteError `ahel-team/refused` for an unknown teammate or invalid text.
 */
@Remote async shareHandoff(share: HandoffShare): Promise<HandoffSent>

/**
 * Mark a handoff done; it stays readable.
 * @param id - a handoff id.
 * @returns the handoff with `status: 'done'`.
 * @throws RemoteError `ahel-team/refused` when it is not available to this person.
 */
@Remote async markHandoffDone(id: string): Promise<HandoffSent>

/**
 * Prefill for "Share with teammate" from one local chat; no network.
 * @param sessionId - the chat's session id.
 * @returns its title, the first message the person typed and the last assistant reply;
 * empty strings for what the session store could not give.
 */
@Remote async sessionDraft(sessionId: string): Promise<HandoffSessionDraft>
```

Source: [`packages/credentials/ahel-account/src/team.ts`](../../packages/credentials/ahel-account/src/team.ts)

<a id="ctxauthorization--authorizationservice"></a>

### `ctx.authorization` — `AuthorizationService`

`ctx.authorization`: a registry of credential-obtaining flows, one attempt at a time per key.

```ts cordis-catalog
/**
 * Offer a way to obtain one credential. One flow per key: two plugins
 * claiming the same key would each write a record in their own format, and
 * whichever ran last would leave the other reading a payload it cannot parse.
 *
 * @param flow - the key it writes, its label, its methods, and its runner.
 * @returns Disposer that withdraws this flow.
 * @throws {AuthorizationError} code `DUPLICATE_FLOW` when the key is already claimed.
 */
registerFlow(flow: AuthorizationFlow): () => void

/**
 * Every registered flow, for a surface listing what can be authorized.
 * @returns one entry per flow, in registration order.
 */
list(): readonly AuthorizationEntry[]

/**
 * One registered flow.
 * @param key - the credential record to ask about.
 * @returns the entry, or undefined when no flow claims that key.
 */
describe(key: CredentialKey): AuthorizationEntry | undefined

/**
 * Withdraw the attempt running for a key, if any. Separate from the
 * request's own signal because a request/response transport answers a Cancel
 * button on a second call, with no handle on the first one's signal.
 * @param key - the credential record whose attempt should stop.
 */
cancel(key: CredentialKey): void

/**
 * Run one attempt to authorize a key, and report how it ended.
 *
 * One attempt per key at a time. A second caller is refused rather than
 * joined: the two would be prompting different humans through the same flow,
 * and the second would answer questions the first was asked.
 *
 * @param request - the key, the method, the surface, and the cancel signal.
 * @returns `authorized` once the flow's record is committed during this
 *   attempt and observed, or `cancelled` when the human declined or the
 *   caller withdrew.
 * @throws {AuthorizationError} code `NO_FLOW` when nothing claims the key,
 *   `UNKNOWN_METHOD` when the named method is not one the flow offers,
 *   `ALREADY_IN_FLIGHT` when an attempt is already running for the key, or
 *   `NOT_COMMITTED` when the flow resolved without committing a record
 *   during the attempt.
 */
async begin(request: AuthorizationRequest): Promise<AuthorizationOutcome>
```

Source: [`packages/credentials/authorization/src/index.ts`](../../packages/credentials/authorization/src/index.ts)

<a id="ctxcredentials--credentialprovider-abstract-seam"></a>

### `ctx.credentials` — `CredentialProvider` (abstract seam)

Abstract credential service over two key spaces that answer two questions.

A CredentialRef answers "what is behind this environment-variable name", layered over the process environment, the provider-managed store, and `.env` files. One seam-wide rule binds that half: an empty stored value is absent everywhere — `resolve` skips it, `describe` reports it unconfigured — so a blank never masquerades as a configured secret.

A CredentialKey answers "what credential does this plugin hold for this id". Nothing can layer here — an authorization grant has no environment to be read from — so presence of the record is the whole fact, and modifyRecord is the only write path because a correct write depends on the current value (a token refresh is read-decide-replace under one lock).

```ts cordis-catalog
/**
 * Resolve one reference to its current value. Resolution is per call:
 * consumers re-resolve at each operation and must not cache across
 * operations — that per-operation read is what makes a changed credential
 * reach the next operation without a restart.
 * @param ref - the reference to resolve.
 * @returns the value and its source, or `undefined` while unconfigured.
 */
abstract resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined>

/**
 * Describe one reference for configuration surfaces without exposing the
 * value.
 * @param ref - the reference to describe.
 * @returns configured state, supplying source, and writability.
 */
abstract describe(ref: CredentialRef): Promise<CredentialInfo>

/**
 * Durably store one value in the provider-managed writable source. Rejects
 * while a read-only source shadows the reference — the write would appear
 * to succeed while resolution keeps returning the shadowing value — and
 * rejects an empty value (use {@link unset}).
 * @param ref - the reference to store.
 * @param value - the non-empty secret value.
 */
abstract set(ref: CredentialRef, value: string): Promise<void>

/**
 * Remove one reference from the provider-managed writable source; removing
 * an absent reference is a no-op. Rejects while a read-only source shadows
 * the reference, like {@link set}.
 * @param ref - the reference to remove.
 */
abstract unset(ref: CredentialRef): Promise<void>

/**
 * Read one stored record. The value is returned as its owner wrote it; a
 * {@link GrantRecord} payload is not interpreted on the way out.
 * @param key - the record to read.
 * @returns the record, or `undefined` while none is stored.
 */
abstract readRecord(key: CredentialKey): Promise<CredentialRecord | undefined>

/**
 * Describe one record for configuration surfaces without exposing its value.
 * @param key - the record to describe.
 * @returns presence, discriminant, and writability.
 */
abstract describeRecord(key: CredentialKey): Promise<CredentialRecordInfo>

/**
 * Enumerate every stored record's address and tag. Unlike the reference
 * half, which has no enumeration because configuration surfaces learn which
 * references exist from settings schemas, records have no such discovery
 * path: a surface that cannot list them cannot show what a user is
 * authorized for, nor find an orphan left by an uninstalled plugin.
 * @returns every stored record, values excluded.
 */
abstract listRecords(): Promise<readonly CredentialRecordEntry[]>

/**
 * Serialized read-modify-write over one record — the only write path.
 * `mutate` sees the record as it stands at the moment the write is
 * exclusive, and returning `undefined` leaves the entry untouched. Exclusion
 * holds across processes where the backing store supports it, which is what
 * makes a token refresh safe: two processes rotating one refresh token
 * concurrently would otherwise lose whichever wrote first.
 * @param key - the record to modify.
 * @param mutate - receives the current record and returns its replacement, or `undefined` to leave it.
 * @returns the record after the write, or the current one when `mutate` declined.
 */
abstract modifyRecord( key: CredentialKey, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>, ): Promise<CredentialRecord | undefined>

/**
 * Remove one record; removing an absent record is a no-op.
 * @param key - the record to remove.
 */
abstract deleteRecord(key: CredentialKey): Promise<void>
```

Source: [`packages/credentials/credentials/src/index.ts`](../../packages/credentials/credentials/src/index.ts)

<a id="ctxcredentialscontroller--credentialscontroller"></a>

### `ctx.credentialsController` — `CredentialsController`

Host service backing the generated `ctx.remote.credentials` namespace. It carries every wire obligation the credential seam itself does not: the batch fan-out bound, the field-by-field view projection, the reference-grammar guard, and the refusal mapping. Secret values cross in one direction only — no method here returns one.

```ts cordis-catalog
/**
 * Describe several references for one configuration surface. Batched because
 * a settings page describes every reference its rows name at once, and one
 * round trip keeps those rows from settling separately.
 * @param refs - reference names, at most {@link MAX_DESCRIBE_REFS}; a name outside the grammar
 *   rejects the whole call as `gateway/bad-request`.
 * @returns one view per requested name, keyed by that name.
 * @throws RemoteError when the request is invalid or no credential provider is mounted.
 */
@Remote async describe(refs: string[]): Promise<Record<string, CredentialInfo>>

/**
 * Store one value from a configuration surface. The value crosses the wire in
 * this direction only: no read path returns it.
 * @param ref - reference name to store under.
 * @param value - the non-empty secret value.
 * @throws RemoteError when the request is invalid, no provider is mounted, or the provider refuses the write.
 */
@Remote async set(ref: string, value: string): Promise<void>

/**
 * Remove one reference from a configuration surface.
 * @param ref - reference name to remove.
 * @throws RemoteError when the request is invalid, no provider is mounted, or the provider refuses the write.
 */
@Remote async unset(ref: string): Promise<void>
```

Source: [`packages/api/settings-controller/src/credentials.ts`](../../packages/api/settings-controller/src/credentials.ts)

<a id="ahel-account-events"></a>

### `ahel-account/*` events

<a id="ahel-accountchanged--emit"></a>

#### `ahel-account/changed` — emit

The account view changed: a sign-in step, a completed sign-in or sign-out, or an external edit of the stored grant.

```ts cordis-catalog
/**
 * The account view changed: a sign-in step, a completed sign-in or sign-out, or an external edit of the stored grant.
 * @param view - the new complete view.
 * @mode emit
 */
'ahel-account/changed'(view: AhelAccountView): void
```

Source: [`packages/credentials/ahel-account/src/types.ts`](../../packages/credentials/ahel-account/src/types.ts)

<a id="ahel-accountdefault-model--emit"></a>

#### `ahel-account/default-model` — emit

ahel.ai reported the workspace's default model: a team summary, a read or a save.

```ts cordis-catalog
/**
 * ahel.ai reported the workspace's default model: a team summary, a read or a save.
 * @param defaultModel - the metered model id, or null when none is set.
 * @mode emit
 */
'ahel-account/default-model'(defaultModel: string | null): void
```

Source: [`packages/credentials/ahel-account/src/types.ts`](../../packages/credentials/ahel-account/src/types.ts)

<a id="authorization-events"></a>

### `authorization/*` events

<a id="authorizationsettled--emit"></a>

#### `authorization/settled` — emit

One authorization attempt has finished and released its key. Fires for every terminal outcome, failures included, so a surface watching a key it did not start (a second browser tab) learns the attempt is over.

```ts cordis-catalog
/**
 * One authorization attempt has finished and released its key. Fires for
 * every terminal outcome, failures included, so a surface watching a key it
 * did not start (a second browser tab) learns the attempt is over.
 * @mode emit
 * @param key - the credential record the finished attempt was authorizing.
 * @param settlement - how it ended, including the `failed` case its caller sees as a thrown error.
 */
'authorization/settled'(key: CredentialKey, settlement: AuthorizationSettlement): void
```

Source: [`packages/credentials/authorization/src/index.ts`](../../packages/credentials/authorization/src/index.ts)

<a id="credentials-events"></a>

### `credentials/*` events

<a id="credentialsrecord-updated--emit"></a>

#### `credentials/record-updated` — emit

Committed change to a stored credential record: a `modifyRecord` that wrote, a `deleteRecord` that removed, or an external edit observed in storage. Separate from `credentials/reference-updated` because the two key grammars are disjoint — a listener that received both on one event could not tell which space a subject belongs to. Listener failures are contained on the same terms as `credentials/reference-updated`.

```ts cordis-catalog
/**
 * Committed change to a stored credential record: a `modifyRecord` that
 * wrote, a `deleteRecord` that removed, or an external edit observed in
 * storage. Separate from `credentials/reference-updated` because the two key
 * grammars are disjoint — a listener that received both on one event could
 * not tell which space a subject belongs to. Listener failures are
 * contained on the same terms as `credentials/reference-updated`.
 * @param key - the record whose stored value changed.
 * @mode emit
 */
'credentials/record-updated'(key: CredentialKey): void
```

Source: [`packages/credentials/credentials/src/types.ts`](../../packages/credentials/credentials/src/types.ts)

<a id="credentialsreference-updated--emit"></a>

#### `credentials/reference-updated` — emit

Committed change to a provider-managed credential source: a `set`, an `unset`, or an external edit observed in storage. Ambient process-environment changes are not observable and never emit. Listener failures are contained and logged — a sync throw and an async rejection alike — without changing the committed operation's outcome.

```ts cordis-catalog
/**
 * Committed change to a provider-managed credential source: a `set`, an
 * `unset`, or an external edit observed in storage. Ambient
 * process-environment changes are not observable and never emit. Listener
 * failures are contained and logged — a sync throw and an async rejection
 * alike — without changing the committed operation's outcome.
 * @param ref - the reference whose stored value changed.
 * @mode emit
 */
'credentials/reference-updated'(ref: CredentialRef): void
```

Source: [`packages/credentials/credentials/src/types.ts`](../../packages/credentials/credentials/src/types.ts)
<!-- END GENERATED cordis-surface -->
