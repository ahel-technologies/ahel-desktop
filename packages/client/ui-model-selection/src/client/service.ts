/**
 * ModelDirectoryResolver (`ctx.modelDirectories`): the root owner of per-session
 * {@link ModelDirectory} instances. Both selection entries (the /model popup
 * and the composer model seat) resolve their session's directory through
 * this service, which is what makes the dual entry one shared state.
 *
 * Per-session storage follows the client service pattern (InputTriggerService /
 * CommandUiRuntime): a lazy service-internal map whose entry is deleted by the
 * owning scope's disposer. The host `dsh-scope` ScopedLayers registry does
 * does not belong here: it derives scope from the host carrier mechanism
 * (object-keyed), while client scopes tag contexts with branded SessionId
 * strings, and it models global+shadow named registries — this is a
 * per-session singleton with no global layer to merge.
 */
import type {} from '@ahel/dsh-client-product-analytics/client'
import { Service } from '@ahel/cordis'
import type { Context } from '@ahel/cordis'
import type { SessionBinding } from '@ahel/dsh-api-session-controller/client'
import type { SessionId } from '@ahel/dsh-session/types'
import { WeakMapWithValues } from '@ahel/dsh-util-values'
import { createSnapshotStore, type ObservableSnapshot, type SnapshotStore } from '@ahel/dsh-client-store'
import type { ActiveBilling, ModelBillingSource } from './billing.ts'
import { ModelCatalogDirectory } from './catalog.ts'
import { connectingProvider, ModelDirectory } from './directory.ts'
import type { ModelDirectoryState } from './directory.ts'
import { pickerGroups, type PickerGroup } from './rows.ts'

/** localStorage key of the per-chat "Remember for this chat" choices. */
const REMEMBER_KEY = 'dsh.model-selection.remember'

/** Most chats whose choice is kept; older entries drop out first. */
const REMEMBER_LIMIT = 500

/** One composer picker that the open-picker shortcut can open. */
interface PickerOpener {
  readonly sessionId: SessionId
  readonly open: () => void
}

function readRemembered(): Readonly<Record<string, boolean>> {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(REMEMBER_KEY) ?? '{}')
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'))
  } catch (_unavailable) {
    // Storage is blocked or holds something else; every chat starts without a remembered choice.
    return {}
  }
}

function writeRemembered(value: Readonly<Record<string, boolean>>): void {
  try {
    window.localStorage.setItem(REMEMBER_KEY, JSON.stringify(value))
  } catch (_unavailable) {
    // Storage is blocked; the choice lasts for this page only.
  }
}

declare module '@ahel/cordis' {
  interface Context {
    modelDirectories: ModelDirectoryResolver
  }
}

/** Live mutable state in one holder (service methods run behind the caller-ctx tracker). */
interface LiveState {
  /** Directories keyed by Client binding, removed by their scope disposer. */
  readonly directories: WeakMapWithValues<SessionBinding, ModelDirectory>
}

/** The `ctx.modelDirectories` session model-selection service. */
export class ModelDirectoryResolver extends Service {
  static inject = ['sessions', 'remote', 'remote.session']

  private readonly live: LiveState = { directories: new WeakMapWithValues() }
  private readonly catalog: ModelCatalogDirectory
  private readonly billingStore: SnapshotStore<ActiveBilling | null> = createSnapshotStore<ActiveBilling | null>(null, { flush: 'sync' })
  private readonly rememberStore: SnapshotStore<Readonly<Record<string, boolean>>> = createSnapshotStore(readRemembered(), { flush: 'sync' })
  private readonly openers = new Set<PickerOpener>()

  /** The registered metering source with its current state; null without one. */
  get billing(): ObservableSnapshot<ActiveBilling | null> {
    return this.billingStore
  }

  /** Per-chat "Remember for this chat" choices; a chat without an entry has made none. */
  get remembered(): ObservableSnapshot<Readonly<Record<string, boolean>>> {
    return this.rememberStore
  }

  /**
   * Register the metering account the picker shows prices, the workspace default and the balance for.
   * One source is active; a later registration replaces an earlier one until it is disposed.
   * @param source - the metering account.
   * @returns the disposer withdrawing it.
   */
  registerBilling(source: ModelBillingSource): () => void {
    const sync = (): void => {
      this.billingStore.set({
        provider: source.provider, state: source.state.getSnapshot(), refreshBalance: () => { source.refreshBalance() },
      })
    }
    const stop = source.state.subscribe(sync)
    sync()
    return () => {
      stop()
      if (this.billingStore.getSnapshot()?.provider === source.provider) this.billingStore.set(null)
    }
  }

  /**
   * Store whether one chat keeps its own model or follows the workspace default.
   * @param sessionId - the chat.
   * @param on - true keeps the chat's choice.
   */
  setRemembered(sessionId: SessionId, on: boolean): void {
    const key = String(sessionId)
    const kept = Object.entries(this.rememberStore.getSnapshot()).filter(([other]) => other !== key)
    const next = Object.fromEntries([...kept.slice(-(REMEMBER_LIMIT - 1)), [key, on]])
    this.rememberStore.set(next)
    writeRemembered(next)
  }

  /**
   * Make one mounted composer picker reachable by the open-picker shortcut.
   * @param sessionId - the picker's chat.
   * @param open - opens the picker and focuses it.
   * @returns the disposer.
   */
  registerOpener(sessionId: SessionId, open: () => void): () => void {
    const entry = { sessionId, open }
    this.openers.add(entry)
    return () => { this.openers.delete(entry) }
  }

  /**
   * The picker's maker groups for one directory snapshot, under the active metering source.
   * @param state - a Session's directory snapshot.
   * @returns maker groups with short names and merged routes.
   */
  groupsFor(state: ModelDirectoryState): PickerGroup[] {
    return pickerGroups(state.groups, this.billingStore.getSnapshot())
  }

  /**
   * Whether the open-picker shortcut has a composer picker to open.
   * @returns true while at least one composer picker is mounted.
   */
  hasPicker(): boolean {
    return this.openers.size > 0
  }

  /**
   * Open the picker of the chat in the main view, else of the last mounted picker.
   * @returns whether a picker opened.
   */
  openPicker(): boolean {
    const rows = this.ctx.sessions.list.getSnapshot().byId
    const main = Object.values(rows).find(row => (row.retainedBy.mainView ?? 0) > 0)?.id
    const openers = [...this.openers]
    const target = openers.find(opener => opener.sessionId === main) ?? openers.at(-1)
    target?.open()
    return target !== undefined
  }

  /**
   * @param ctx - owning root context (the service registers itself as `models`).
   */
  constructor(ctx: Context) {
    super(ctx, 'modelDirectories')
    this.catalog = new ModelCatalogDirectory(ctx)
    void this.catalog.load().catch(() => { /* selectors expose the shared error */ })
    ctx.on('connection/reset', () => {
      this.catalog.resetGeneration()
      for (const directory of this.live.directories.values) directory.resetConnected()
    })
    ctx.remote.$on('llm/adapters-updated', () => { this.catalog.refresh() })
    ctx.remote.$on('settings/document-updated', () => { this.catalog.refresh() })
    ctx.remote.$on('credentials/record-updated', () => { this.catalog.refresh() })
    ctx.remote.$on('credentials/reference-updated', () => { this.catalog.refresh() })
  }

  /**
   * Resolve the per-session shared directory (lazy; the scope disposer
   * removes and disposes it). Unknown sessions fail loud.
   * @param sessionId - the owning session.
   * @returns the resident directory both entries share.
   */
  directoryFor(sessionId: SessionId): ModelDirectory {
    const { live } = this
    const sessions = this.ctx.sessions
    const actx = sessions.scope(sessionId)
    if (actx === undefined) throw new Error(`ui-model-selection: session "${String(sessionId)}" resolved no scope`)
    const binding = sessions.binding(sessionId)
    if (binding === undefined) throw new Error(`ui-model-selection: session "${String(sessionId)}" resolved no binding`)
    const existing = live.directories.get(binding)
    if (existing !== undefined) return existing
    const directory = new ModelDirectory(
      this.ctx.remote.session,
      sessionId,
      () => sessions.subagentAddress(sessionId) === undefined,
      this.catalog,
      binding.session.projections.faceOf('modelSelection'),
      () => binding.session.getSnapshot().blank,
      (name, attributes) => this.ctx.get('productAnalytics')?.track(name, attributes),
    )
    live.directories.set(binding, directory)
    actx.effect(() => () => {
      directory.dispose()
      live.directories.delete(binding)
    }, 'ui-model-selection: session directory')
    actx.effect(() => this.followDefault(sessionId, directory, binding), 'ui-model-selection: workspace default for new chats')
    const conversation = this.ctx.get('conversation')
    const locale = this.ctx.get('locale')
    if (conversation !== undefined && locale !== undefined) {
      // While a provider is still connecting and none offers a model, the composer waits with its reason instead of failing on send.
      const t = locale.bind('model')
      actx.effect(() => {
        let raised: string | undefined
        const sync = (): void => {
          const name = connectingProvider(directory.store.getSnapshot())
          const reason = name === undefined ? undefined : t('composer.connecting', { name })
          if (reason === raised) return
          if (reason === undefined && conversation.blocks.storeFor(sessionId).getSnapshot()?.reason !== raised) {
            raised = undefined
            return
          }
          raised = reason
          conversation.blocks.set(sessionId, reason === undefined ? undefined : { reason })
        }
        const stop = directory.store.subscribe(sync)
        sync()
        return () => {
          stop()
          if (raised !== undefined && conversation.blocks.storeFor(sessionId).getSnapshot()?.reason === raised) {
            conversation.blocks.set(sessionId, undefined)
          }
        }
      }, 'ui-model-selection: connecting composer block')
    }
    return directory
  }

  /**
   * Start a blank chat on the workspace default unless it remembers its own
   * choice: once per default, after the catalog lists that model. With no
   * workspace default the chat starts on the first metered model in the
   * account's order, not on the Host's last-used model; a listed own-key
   * model is kept.
   * @param sessionId - the chat.
   * @param directory - its directory.
   * @param binding - its Client binding.
   * @returns the disposer of the watch.
   */
  private followDefault(sessionId: SessionId, directory: ModelDirectory, binding: SessionBinding): () => void {
    let tried: string | undefined
    const sync = (): void => {
      const billing = this.billingStore.getSnapshot()
      const model = billing?.state.signedIn === true ? billing.state.defaultModel : undefined
      if (billing === null || model === undefined) return
      if (this.rememberStore.getSnapshot()[String(sessionId)] === true || !binding.session.getSnapshot().blank) return
      const state = directory.store.getSnapshot()
      if (state.status !== 'ready' || state.pending !== null) return
      const current = state.current
      const metered = state.groups.find(group => group.id === billing.provider)?.models ?? []
      const ownKey = current !== null && current.provider !== billing.provider
        && state.groups.some(group => group.id === current.provider && group.models.some(candidate => candidate.id === current.model))
      const entry = model === null
        ? ownKey ? undefined : metered[0]
        : metered.find(candidate => candidate.id === model)
      if (entry === undefined) return
      if (current?.provider === billing.provider && current.model === entry.id) return
      const key = `${billing.provider}/${entry.id}`
      if (tried === key) return
      tried = key
      const effort = entry.reasoning?.defaultEffort
      void directory.select({ provider: billing.provider, model: entry.id, ...effort === undefined ? {} : { reasoningEffort: effort } })
        .catch(() => { /* surfaced on the store */ })
    }
    const stops = [
      directory.store.subscribe(sync), this.billingStore.subscribe(sync),
      this.rememberStore.subscribe(sync), binding.session.subscribe(sync),
    ]
    sync()
    return () => { for (const stop of stops) stop() }
  }
}
