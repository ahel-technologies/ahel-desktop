/**
 * The Ahel account as the model picker's metering source: ahel.ai's facts per
 * metered model (`ahelTeam.models()`), the workspace default model, the
 * balance from the shared summary poll, and each request's hold and settle
 * from the account view's `billing`. Registered on `ctx.modelDirectories`
 * once ui-model-selection is loaded; it also feeds the Default model row in
 * Settings > Models.
 */
import type { Context } from '@ahel/cordis'
import type { AhelAccountView, AhelBilling, AhelMeteredModel, DesktopSummary } from '@ahel/dsh-ahel-account/types'
import type {} from '@ahel/dsh-ahel-account'
import type {} from '@ahel/dsh-api-remotes/client'
import type { HostObservable } from '@ahel/dsh-client-ui-slots'
import type { MeteredModelFacts, ModelBillingFrame, ModelBillingState } from '@ahel/dsh-client-ui-model-selection/client'
import type { TeamSummary } from '../team/contract.ts'

/** Route key of the Ahel models (`dsh-llm-ahel`'s default `provider`). */
export const AHEL_PROVIDER = 'ahel'

/** Account name inside "ahel · billed to the workspace". */
const BILLING_NAME = 'ahel'

/** What the Default model row reads. */
export interface DefaultModelView {
  readonly signedIn: boolean
  /** Metered models in ahel.ai's order. */
  readonly models: readonly AhelMeteredModel[]
  /** null when not set, undefined while unknown (an older ahel.ai). */
  readonly defaultModel: string | null | undefined
  /** Whether this seat may change it (owner or team lead). */
  readonly canSet: boolean
  /** Whether a save is in flight. */
  readonly saving: boolean
  /** The last failed save's message. */
  readonly error: string | null
}

/** The live source and the row's operations. */
export interface AhelModelSource {
  /** The picker's metering state. */
  readonly billing: HostObservable<ModelBillingState>
  /** The Default model row's state. */
  readonly view: HostObservable<DefaultModelView>
  /** Re-read the balance. */
  refreshBalance(): void
  /**
   * Store the workspace default.
   * @param model - a metered model id, or null to clear it.
   */
  setDefault(model: string | null): Promise<void>
}

/** Roles that may change the workspace default: owner and team lead (ahel.ai's ADMIN). */
const SETTERS = /^(owner|admin|lead|team[ _-]?lead)$/i

function observable<T>(initial: T): HostObservable<T> & { set(next: T): void } {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: (next) => {
      value = next
      for (const listener of listeners) listener()
    },
  }
}

function factsOf(model: AhelMeteredModel): MeteredModelFacts {
  const facts = model.ahel
  if (facts === null) return {}
  return {
    ...facts.shortName === null ? {} : { shortName: facts.shortName },
    ...facts.maker === null ? {} : { maker: facts.maker },
    ...facts.bestFor === null ? {} : { bestFor: facts.bestFor },
    ...facts.typicalMessageCents === null ? {} : { typicalMessageCents: facts.typicalMessageCents },
    ...facts.lastChargeCents === null ? {} : { lastChargeCents: facts.lastChargeCents },
  }
}

function frameOf(billing: AhelBilling): ModelBillingFrame {
  return {
    phase: billing.phase,
    sessionId: billing.sessionId,
    heldCents: billing.heldCents,
    chargedCents: billing.chargedCents,
    balanceCents: billing.balanceCents,
  }
}

/**
 * Start the source over the account view and the summary poll.
 * @param ctx - Client context with `remote.ahelTeam`.
 * @param account - the live account view.
 * @param team - the shared summary poll.
 * @returns the source.
 */
export function createAhelModelSource(ctx: Context, account: HostObservable<AhelAccountView | null>, team: TeamSummary): AhelModelSource {
  let models: readonly AhelMeteredModel[] = []
  // Last arrival wins: a summary, a GET or a PUT of the default; a summary or a frame for the balance.
  let defaultModel: string | null | undefined
  let balanceCents: number | null = null
  let lastSummary: DesktopSummary | null = null
  let lastBilling: AhelBilling | null | undefined
  let frame: ModelBillingFrame | null = null
  let saving = false
  let error: string | null = null

  const billing = observable<ModelBillingState>({
    signedIn: false, name: BILLING_NAME, models: {}, defaultModel: undefined, balanceCents: null, frame: null,
  })
  const view = observable<DefaultModelView>({
    signedIn: false, models: [], defaultModel: undefined, canSet: false, saving: false, error: null,
  })

  const publish = (): void => {
    const signedIn = account.getSnapshot()?.status === 'signed-in'
    const role = team.state.getSnapshot().summary?.workspace.role ?? ''
    billing.set({
      signedIn,
      name: BILLING_NAME,
      models: Object.fromEntries(models.map(model => [model.id, factsOf(model)])),
      defaultModel,
      balanceCents,
      frame,
    })
    view.set({ signedIn, models, defaultModel, canSet: SETTERS.test(role), saving, error })
  }

  let generation = 0
  const readModels = async (): Promise<void> => {
    const mine = ++generation
    if (account.getSnapshot()?.status !== 'signed-in') {
      models = []
      defaultModel = undefined
      balanceCents = null
      frame = null
      publish()
      return
    }
    const [listed, stored] = await Promise.all([ctx.remote.ahelTeam.models(), ctx.remote.ahelTeam.workspaceModel()])
    if (mine !== generation) return
    if (listed.ok) models = listed.value
    // An ahel.ai without the route leaves the default unknown.
    if (stored.ok) defaultModel = stored.value.defaultModel
    publish()
  }
  const refreshModels = (): void => { void readModels().catch(() => undefined) }

  const onSummary = (): void => {
    const summary = team.state.getSnapshot().summary
    if (summary === lastSummary) return
    lastSummary = summary
    if (summary !== null) {
      if (summary.defaultModel !== undefined) defaultModel = summary.defaultModel
      if (summary.credits?.visible === true) balanceCents = summary.credits.balanceCents
    }
    publish()
  }

  const onAccount = (): void => {
    const next = account.getSnapshot()?.billing ?? null
    if (next === lastBilling) return
    lastBilling = next
    if (next === null) return
    frame = frameOf(next)
    if (next.balanceCents !== null) balanceCents = next.balanceCents
    publish()
    // The settle changes the workspace's last charge for this model.
    if (next.phase === 'settled') refreshModels()
  }

  ctx.effect(() => team.state.subscribe(onSummary), 'ui-ahel-account: model source follows the summary')
  ctx.effect(() => {
    let previous = account.getSnapshot()
    return account.subscribe(() => {
      const next = account.getSnapshot()
      const moved = next?.status !== previous?.status || next?.workspace !== previous?.workspace
      previous = next
      if (moved) {
        defaultModel = undefined
        balanceCents = null
        frame = null
        refreshModels()
      }
      onAccount()
    })
  }, 'ui-ahel-account: model source follows the account')
  onSummary()
  refreshModels()

  return {
    billing,
    view,
    refreshBalance: () => { team.refresh() },
    setDefault: async (model) => {
      saving = true
      error = null
      publish()
      const result = await ctx.remote.ahelTeam.setWorkspaceModel(model)
      saving = false
      if (result.ok) defaultModel = result.value.defaultModel
      else error = result.error.message
      publish()
    },
  }
}
