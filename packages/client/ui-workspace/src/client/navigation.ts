/** Workspace archive and directory UI capability. */

import { Service, type Context } from '@ahel/cordis'
import type { ClientRemote, DirectoryListing, RemoteFailure } from '@ahel/dsh-api-remotes/client'
import type {
  ISessions,
  SessionCreateError,
  SessionBinding,
  SessionReference,
  SessionTarget,
  SessionListState,
} from '@ahel/dsh-api-session-controller/client'
import { createSnapshotStore, notifySubscribers, type ObservableSnapshot } from '@ahel/dsh-client-store'
import type { SubagentAddress } from '@ahel/dsh-subagent/client'
import type {
  IWorkspaces, WorkspaceId, WorkspaceSnapshot, WorkspaceView,
} from '@ahel/dsh-api-workspace-controller/client'
import type { SessionId } from '@ahel/dsh-session/types'
import type { MainPanelId } from '@ahel/dsh-client-ui-layout/client'
import type { DraftInitializationOptions } from '@ahel/dsh-client-ui-conversation/client'
import type { RowToast } from './contract/slots.ts'
import { pinOrderAccounts, pinOrderSource } from './pin-order.ts'
import type { SessionFilter } from './tree.ts'
import type { WorkspaceViewStoreActions } from './stores.ts'

interface MainSelection {
  readonly sessionId?: SessionId
  readonly subagentAddress?: SubagentAddress
}

/** Optional content preparation for the resolved target Session. */
export type StartSessionOptions = DraftInitializationOptions

/** Workspace archive and directory operations consumed by Client UI domains. */
export interface UiWorkspace {
  /**
   * Select a Session and show its Conversation as one UI navigation action.
   * @param target - known Session identity or durable direct-parent subagent address to display.
   */
  openSession(target: SessionTarget): void
  /**
   * Connect a Workspace and open its Session unless a later navigation supersedes it.
   * @param workspaceId - target Workspace.
   * @param beforeOpen - optional synchronous preparation for the selected Session,
   * skipped after supersession; a throw aborts the open and releases the retained reference.
   * @returns completion; a superseded request may create a Session but does not open it.
   * @throws on failure; a refused creation is also shown through the Workspace
   * notice unless a later navigation or disposal superseded the request.
   */
  openWorkspace(workspaceId: WorkspaceId, beforeOpen?: (sessionId: SessionId) => void): Promise<void>
  /**
   * Fork a Session without changing the current selection.
   * @param sessionId - source Session.
   * @param onCreated - observer before the optional child-title update.
   * @returns the child SessionId after creation and inherited-title increment.
   */
  forkSession(sessionId: SessionId, onCreated?: (childId: SessionId) => void): Promise<SessionId>
  /**
   * Resolve the reusable or newly created blank Session for a Workspace.
   * @param workspaceId - target Workspace.
   * @returns a Session already addressable through the Session Controller.
   */
  connectWorkspace(workspaceId: WorkspaceId): Promise<SessionId>
  /**
   * Start a New Session flow and navigate to its Session; a creation the Host
   * refuses is shown through the Workspace notice and leaves the selection as it was.
   * A request that names no Workspace before the first selection restoration
   * has finished waits for it and then runs, so a click during page load is
   * never dropped.
   * @param workspaceId - explicit target; absent inherits the current or most recent Workspace.
   * @param options - initial content; existing text or attachments are preserved unless clearPreviousDraft is true.
   */
  startSession(workspaceId?: WorkspaceId, options?: StartSessionOptions): void
  /**
   * Archive a Session and clear it when it is the current selection.
   * @param sessionId - Session to archive.
   * @param options - `stopActivity` asks the Host to stop the Session's running work instead of refusing.
   */
  archiveSession(sessionId: SessionId, options?: { readonly stopActivity?: boolean }): Promise<void>
  /**
   * Unarchive a Session, restoring it to its recorded Workspace position.
   * @param sessionId - Session to unarchive.
   */
  unarchiveSession(sessionId: SessionId): Promise<void>
  /**
   * Pin a Session on the Host, then lead it in its accounts' saved orders
   * (its Workspace group or Ungrouped, and the flat list). The order write
   * reads the memberships current at completion, so reorders that landed
   * while the Host call was pending keep their positions.
   * @param sessionId - Session to pin.
   */
  pinSession(sessionId: SessionId): Promise<void>
  /**
   * Unpin a Session on the Host; saved positions stay as they are.
   * @param sessionId - Session to unpin.
   */
  unpinSession(sessionId: SessionId): Promise<void>
  /**
   * Open the Host-native directory picker.
   * @returns the selected directory, or null when cancelled.
   */
  pickDirectory(): Promise<string | null>
  /**
   * List one Host directory level.
   * @param path - directory path; absent selects the Host home.
   * @param signal - cancellation for a superseded scan.
   * @returns directory entries and breadcrumb ancestry.
   */
  listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing>
  /**
   * Create a child directory.
   * @param path - existing parent directory.
   * @param name - child directory name.
   * @returns created absolute path.
   */
  createDirectory(path: string, name: string): Promise<string>
  /**
   * List only the Sessions a filter accepts in the Session browser (list and
   * search) until the returned disposer runs; with several filters a row must
   * pass each. Navigation and other Session surfaces keep every Session.
   * @param filter - true for a Session the browser lists.
   * @returns the disposer.
   */
  scopeSessions(filter: SessionFilter): () => void
  /**
   * Every filter registered through `scopeSessions` combined into one, or
   * null while none is registered. Surfaces that list chats beside the
   * browser (the command palette, `@` mentions) apply it and re-read on change.
   */
  readonly sessionScope: ObservableSnapshot<SessionFilter | null>
}

declare module '@ahel/cordis' {
  interface Context {
    /** Cross-Controller Workspace navigation and directory UI capability. */
    uiWorkspace: UiWorkspace
  }
}

/** Structured directory failure exposed to directory UI consumers. */
export class DirectoryBrowseError extends Error {
  override readonly name = 'DirectoryBrowseError'

  /** @param rpcError - Host directory business failure. */
  constructor(readonly rpcError: RemoteFailure) {
    super(`directory browse failed: ${rpcError.code}: ${rpcError.message}`)
  }
}

/** Implements Workspace archive and directory UI operations. */
class UiWorkspaceService extends Service implements UiWorkspace {
  private readonly connecting = new Map<WorkspaceId, Promise<SessionId>>()
  private readonly lifetime = new AbortController()
  private readonly selection = createSnapshotStore<MainSelection>(
    {}, { persist: { name: 'dsh.sessions.current' } },
  )
  private mainReference: SessionReference | undefined
  /** The page load's first selection restoration: waiting for both lists, running, or finished. */
  private initialNavigation: 'waiting' | 'connecting' | 'done' = 'waiting'
  /**
   * A New Session request made before {@link initialNavigation} finished with
   * no Workspace to target yet, and the main panel shown when it was made.
   */
  private pendingStart: { readonly options: StartSessionOptions | undefined; readonly panel: MainPanelId | null } | undefined
  private readonly sessionFilters = new Set<SessionFilter>()
  private combinedFilter: SessionFilter | null = null
  private readonly scopeListeners = new Set<() => void>()
  // A plain observable: a snapshot store would run a function value as a state updater.
  readonly sessionScope: ObservableSnapshot<SessionFilter | null> = {
    getSnapshot: () => this.combinedFilter,
    subscribe: (listener) => {
      this.scopeListeners.add(listener)
      return () => { this.scopeListeners.delete(listener) }
    },
  }

  /**
   * @param ctx - Client root Context.
   * @param directoryPicker - the directory-picking Remote namespace.
   * @param workspaces - pure Workspace Controller.
   * @param sessions - pure Session Controller.
   * @param view - the browser's viewing-store write set (one instance shared with its registration).
   * @param notify - show one notice through the Workspace notice channel.
   */
  constructor(
    ctx: Context,
    private readonly directoryPicker: ClientRemote['directoryPicker'],
    private readonly workspaces: IWorkspaces,
    private readonly sessions: ISessions,
    private readonly view: Pick<WorkspaceViewStoreActions, 'pinSessionOrder'>,
    private readonly notify: (toast: RowToast) => void,
  ) {
    super(ctx, 'uiWorkspace')
    ctx.effect(() => {
      const stop = this.watchNavigation()
      return () => {
        stop()
        this.lifetime.abort()
        const reference = this.mainReference
        this.mainReference = undefined
        reference?.release()
      }
    }, 'ui-workspace: Workspace navigation policy')
  }

  async connectWorkspace(workspaceId: WorkspaceId): Promise<SessionId> {
    const workspace = this.workspaces.list.getSnapshot().items
      .find(item => item.workspaceId === workspaceId)
    if (workspace === undefined) {
      throw new Error(`uiWorkspace.connectWorkspace: unknown workspace ${workspaceId}`)
    }
    const inflight = this.connecting.get(workspaceId)
    if (inflight !== undefined) return inflight

    const attempt = this.reuseOrCreateBlank(workspace)
      .finally(() => { this.connecting.delete(workspaceId) })
    this.connecting.set(workspaceId, attempt)
    return attempt
  }

  private reuseOrCreateBlank(workspace: WorkspaceView): Promise<SessionId> {
    const archived = this.workspaces.list.getSnapshot().archivedSessionIds
    const sessions = this.sessions.list.getSnapshot()
    for (const id of sessions.ids) {
      const summary = sessions.byId[id]
      if (summary === undefined || !summary.blank || summary.cwd !== workspace.path
        || !workspace.sessionIds.includes(id) || archived.includes(id)) continue
      return this.reuseBlank(workspace.workspaceId, id)
    }
    return this.sessions.create({ workspaceId: workspace.workspaceId })
  }

  private async reuseBlank(workspaceId: WorkspaceId, sessionId: SessionId): Promise<SessionId> {
    try {
      return await this.sessions.create({ workspaceId, sessionId })
    } catch (error: unknown) {
      if (sessionCreateErrorOf(error)?.rpcError.code !== 'session/writer-held') throw error
      return this.sessions.create({ workspaceId })
    }
  }

  openSession(target: SessionTarget): void {
    this.pendingStart = undefined
    this.replaceMain(target, this.lifetime.signal, 'reveal')
  }

  async openWorkspace(workspaceId: WorkspaceId, beforeOpen?: (sessionId: SessionId) => void): Promise<void> {
    this.pendingStart = undefined
    const navigation = AbortSignal.any([this.ctx.layout.beginNavigation(), this.lifetime.signal])
    let sessionId: SessionId
    try {
      sessionId = await this.connectWorkspace(workspaceId)
    } catch (error: unknown) {
      // Reported here, not in connectWorkspace: startup restoration calls that
      // directly and stays console-only.
      if (!navigation.aborted) this.notify({ kind: 'createFailed', message: creationFailureMessage(error) })
      throw error
    }
    if (navigation.aborted) return
    this.replaceMain(sessionId, navigation, 'reveal', beforeOpen)
  }

  async forkSession(sessionId: SessionId, onCreated?: (childId: SessionId) => void): Promise<SessionId> {
    return this.sessions.fork({ sessionId, increaseTitle: true, ...onCreated === undefined ? {} : { onCreated } })
  }

  startSession(workspaceId?: WorkspaceId, options?: StartSessionOptions): void {
    const draftOptions = options === undefined ? undefined : { ...options }
    const initializeDraft = draftOptions !== undefined
      && (draftOptions.prompt !== undefined || draftOptions.clearPreviousDraft === true)
    const workspace = this.workspaces.list.getSnapshot()
    const sessions = this.sessions.list.getSnapshot()
    const current = this.mainReference?.sessionId
    const currentWorkspaceId = current === undefined
      ? undefined
      : workspace.items.find(item => item.sessionIds.includes(current))?.workspaceId
    const recent = workspace.phase === 'ready' && sessions.phase === 'ready'
      ? recentWorkspace(workspace.items, sessions.byId)
      : undefined
    const target = workspaceId ?? currentWorkspaceId ?? recent
    if (target === undefined && this.initialNavigation !== 'done') {
      // Clearing now would abort the restoration that prepares the first
      // Workspace and Session; run this request once it has finished.
      this.pendingStart = { options: draftOptions, panel: this.ctx.layout.panelInfo.getSnapshot().activePanelId }
      return
    }
    if (target === undefined) {
      if (initializeDraft) {
        this.notify({ kind: 'createFailed', message: this.ctx.locale.bind('workspace')('draft.workspaceRequired') })
        return
      }
      this.clearMain()
      return
    }
    void this.openWorkspace(target, initializeDraft ? (id) => {
      const binding = this.sessions.binding(id)
      if (binding === undefined) this.draftPreparationFailed()
      this.prepareDraft(binding, draftOptions)
    } : undefined).catch(
      (reason: unknown) => { console.warn('new session failed:', reason) },
    )
  }

  private prepareDraft(binding: SessionBinding, options: DraftInitializationOptions): void {
    const conversation = this.ctx.get('conversation')
    if (conversation === undefined) this.draftPreparationFailed()
    if (conversation.input.requestDraftInitialization(binding, options) === 'blocked') this.draftPreparationFailed()
  }

  private draftPreparationFailed(): never {
    const message = this.ctx.locale.bind('workspace')('draft.initializationFailed')
    this.notify({ kind: 'createFailed', message })
    throw new Error(message)
  }

  async archiveSession(sessionId: SessionId, options: { readonly stopActivity?: boolean } = {}): Promise<void> {
    await this.workspaces.archiveSession(sessionId, options)
    if (this.mainReference?.sessionId === sessionId) this.clearMain()
  }

  async unarchiveSession(sessionId: SessionId): Promise<void> {
    await this.workspaces.unarchiveSession(sessionId)
  }

  async pinSession(sessionId: SessionId): Promise<void> {
    await this.workspaces.pinSession(sessionId)
    const { items, pinnedSessionIds, archivedSessionIds } = this.workspaces.list.getSnapshot()
    this.view.pinSessionOrder(
      sessionId,
      pinOrderAccounts(items, sessionId),
      pinOrderSource(items, this.sessions.list.getSnapshot(), { pinnedSessionIds, archivedSessionIds }),
    )
  }

  async unpinSession(sessionId: SessionId): Promise<void> {
    await this.workspaces.unpinSession(sessionId)
  }

  async pickDirectory(): Promise<string | null> {
    const result = await this.directoryPicker.pick()
    if (!result.ok) throw new Error(`directory picker failed: ${result.error.message}`)
    return result.value
  }

  async listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing> {
    const result = await this.directoryPicker.list(path, signal)
    if (!result.ok) throw new DirectoryBrowseError(result.error)
    return result.value
  }

  async createDirectory(path: string, name: string): Promise<string> {
    const result = await this.directoryPicker.createDirectory(path, name)
    if (!result.ok) throw new DirectoryBrowseError(result.error)
    return result.value
  }

  scopeSessions(filter: SessionFilter): () => void {
    this.sessionFilters.add(filter)
    this.publishScope()
    return () => { if (this.sessionFilters.delete(filter)) this.publishScope() }
  }

  private publishScope(): void {
    const filters = [...this.sessionFilters]
    this.combinedFilter = filters.length === 0 ? null : session => filters.every(accepts => accepts(session))
    notifySubscribers(this.scopeListeners, 'ui-workspace: sessionScope')
  }

  private watchNavigation(): () => void {
    const reconcile = (): void => {
      if (this.lifetime.signal.aborted) return
      if (this.clearArchivedCurrent()) return
      if (this.initialNavigation !== 'waiting') return
      const workspace = this.workspaces.list.getSnapshot()
      const sessions = this.sessions.list.getSnapshot()
      if (workspace.phase !== 'ready' || sessions.phase !== 'ready') return
      if (this.mainReference !== undefined) {
        this.finishInitialNavigation(false)
        return
      }
      this.initialNavigation = 'connecting'
      void this.restoreSelection(workspace, sessions).then(
        (openedBlank) => { this.finishInitialNavigation(openedBlank) },
        (reason: unknown) => {
          if (this.lifetime.signal.aborted) return
          this.initialNavigation = 'waiting'
          console.warn('initial Session restoration failed:', reason)
        },
      )
    }

    const disposeWorkspaces = this.workspaces.list.subscribe(reconcile)
    const disposeSessions = this.sessions.list.subscribe(reconcile)
    reconcile()
    return () => {
      this.lifetime.abort()
      disposeSessions()
      disposeWorkspaces()
    }
  }

  /**
   * Mark the first restoration finished and run a New Session request made while it was pending.
   * @param openedBlank - whether the restoration opened a blank Session, which already is the new chat.
   */
  private finishInitialNavigation(openedBlank: boolean): void {
    this.initialNavigation = 'done'
    const pending = this.pendingStart
    this.pendingStart = undefined
    if (pending === undefined || this.lifetime.signal.aborted) return
    // Opening a panel since the request supersedes it.
    if (this.ctx.layout.panelInfo.getSnapshot().activePanelId !== pending.panel) return
    // Only draft content still needs the request once a blank Session is open.
    if (openedBlank && pending.options === undefined) return
    this.startSession(undefined, pending.options)
  }

  /** @returns whether a blank Session was opened. */
  private async restoreSelection(workspaces: WorkspaceSnapshot, sessions: SessionListState): Promise<boolean> {
    const saved = this.selection.getSnapshot()
    if (saved.subagentAddress !== undefined) {
      this.replaceMain(saved.subagentAddress, this.lifetime.signal, 'preserve')
      return false
    }
    const summary = saved.sessionId === undefined ? undefined : sessions.byId[saved.sessionId]
    const workspace = summary === undefined ? undefined
      : workspaces.items.find(item => item.sessionIds.includes(summary.id))
    if (summary !== undefined && (!summary.blank || workspace === undefined)) {
      this.replaceMain(summary.id, this.lifetime.signal, 'preserve')
      return summary.blank
    }
    const navigation = AbortSignal.any([this.ctx.layout.beginNavigation(), this.lifetime.signal])
    let sessionId: SessionId | undefined
    if (summary !== undefined && workspace !== undefined && summary.cwd === workspace.path
      && !workspaces.archivedSessionIds.includes(summary.id)) {
      sessionId = await this.reuseBlank(workspace.workspaceId, summary.id)
    }
    let target = workspace?.workspaceId ?? recentWorkspace(workspaces.items, sessions.byId)
    if (target === undefined && workspaces.items.length === 0 && sessions.ids.length === 0) {
      const prepared = await this.initializeDefaultWorkspace(navigation)
      if (navigation.aborted) return false
      target = prepared?.workspaceId
    }
    if (sessionId === undefined && target !== undefined) sessionId = await this.connectWorkspace(target)
    if (sessionId === undefined || navigation.aborted) return false
    this.replaceMain(sessionId, navigation, 'preserve')
    return true
  }

  private async initializeDefaultWorkspace(signal: AbortSignal): Promise<WorkspaceView | undefined> {
    try {
      return await this.workspaces.initializeDefault(signal)
    } catch (_error: unknown) {
      if (!signal.aborted) this.notify({ kind: 'defaultWorkspaceFailed' })
      return undefined
    }
  }

  /** @returns true when an archived current selection was cleared. */
  private clearArchivedCurrent(): boolean {
    const current = this.mainReference?.sessionId
    if (current === undefined
      || !this.workspaces.list.getSnapshot().archivedSessionIds.includes(current)) return false
    this.clearMain()
    return true
  }

  private clearMain(): void {
    const previous = this.mainReference
    this.mainReference = undefined
    this.selection.set({})
    previous?.release()
    this.ctx.layout.selectPanel(null)
  }

  private replaceMain(
    target: SessionTarget,
    signal: AbortSignal,
    panel: 'reveal' | 'preserve',
    beforeOpen?: (sessionId: SessionId) => void,
  ): void {
    signal.throwIfAborted()
    const reference = this.sessions.retain(target, { source: 'mainView' })
    try {
      signal.throwIfAborted()
      beforeOpen?.(reference.sessionId)
      if (signal.aborted) {
        reference.release()
        return
      }
      const subagentAddress = typeof target === 'string'
        ? this.sessions.subagentAddress(reference.sessionId)
        : target
      this.selection.set({
        sessionId: reference.sessionId,
        ...(subagentAddress === undefined ? {} : { subagentAddress }),
      })
    } catch (error: unknown) {
      reference.release()
      throw error
    }
    const previous = this.mainReference
    this.mainReference = reference
    previous?.release()
    if (panel === 'reveal') this.ctx.layout.selectPanel(null)
  }

}

/**
 * `error` as the Session Controller's creation failure, or undefined when it
 * is not one. Client plugin bundles do not share error-class identity, so the
 * name decides.
 */
function sessionCreateErrorOf(error: unknown): SessionCreateError | undefined {
  return error instanceof Error && error.name === 'SessionCreateError' ? error as SessionCreateError : undefined
}

/**
 * The words a failed Session creation is reported in: a Host refusal keeps its
 * stable code and message; any other failure keeps its own message.
 */
function creationFailureMessage(error: unknown): string {
  const refused = sessionCreateErrorOf(error)
  if (refused !== undefined) return `${refused.rpcError.code}: ${refused.rpcError.message}`
  return error instanceof Error ? error.message : String(error)
}

/** Stable tie-breaking follows Host Workspace order. */
function recentWorkspace(
  workspaces: readonly WorkspaceView[],
  sessions: SessionListState['byId'],
): WorkspaceId | undefined {
  let selected: WorkspaceId | undefined
  let selectedTime = Number.NEGATIVE_INFINITY
  for (const workspace of workspaces) {
    let latest = Number.NEGATIVE_INFINITY
    for (const sessionId of workspace.sessionIds) {
      const session = sessions[sessionId]
      if (session !== undefined) latest = Math.max(latest, session.updatedAt)
    }
    if (latest === Number.NEGATIVE_INFINITY) latest = Date.parse(workspace.createdAt)
    if (selected === undefined || latest > selectedTime) {
      selected = workspace.workspaceId
      selectedTime = latest
    }
  }
  return selected
}

export { UiWorkspaceService }
