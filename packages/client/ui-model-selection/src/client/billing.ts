/**
 * The metering seam of the model picker. A metering account (the Ahel account
 * in this product) registers one {@link ModelBillingSource} on
 * `ctx.modelDirectories`; the picker then shows its facts on the metered
 * route's rows, the workspace default, and the balance chip. Without a
 * source every route reads as the person's own key and the chip stays hidden.
 */
import type { ObservableSnapshot } from '@ahel/dsh-client-store'

/** The metering account's facts for one model on its route; absent fields are unknown. */
export interface MeteredModelFacts {
  readonly shortName?: string
  readonly maker?: string
  readonly bestFor?: string
  /** Price of a typical message in cents, fee included; may be fractional. */
  readonly typicalMessageCents?: number
  /** The workspace's approximate last charge for the model, in cents; shown as "about N¢ last time". */
  readonly lastChargeCents?: number
}

/** One metered request's money, as the Host read it; integer cents. */
export interface ModelBillingFrame {
  /** `held` at send; `settled` from the answer's billing event. */
  readonly phase: 'held' | 'settled'
  /** The Session the request belonged to; null when unknown. */
  readonly sessionId: string | null
  /** Amount on hold; a settle can still carry a hold when the provider cost is not known yet. */
  readonly heldCents: number | null
  readonly chargedCents: number | null
  readonly balanceCents: number | null
}

/** Live state of the metering account. */
export interface ModelBillingState {
  /** Whether the account is signed in; signed out hides the chip. */
  readonly signedIn: boolean
  /** Account name inside the billed-to line ("ahel"). */
  readonly name: string
  /** Facts by model id on the metered route. */
  readonly models: Readonly<Record<string, MeteredModelFacts>>
  /** The workspace default model id on the metered route; null when not set, undefined while unknown. */
  readonly defaultModel: string | null | undefined
  /** The newest balance the account read (a summary or a frame, whichever came last), in cents; null while unknown. */
  readonly balanceCents: number | null
  /** The latest request's hold or settle; null before any. */
  readonly frame: ModelBillingFrame | null
}

/** A metering account's registration. */
export interface ModelBillingSource {
  /** Route key of the metered models. */
  readonly provider: string
  /** Live state; must stay referentially stable while unchanged. */
  readonly state: ObservableSnapshot<ModelBillingState>
  /** Read the balance again; the chip calls it when a turn ends without a settle. */
  refreshBalance(): void
}

/** The registered source with its current state, as the picker reads it. */
export interface ActiveBilling {
  readonly provider: string
  readonly state: ModelBillingState
  refreshBalance(): void
}

/** What the composer's balance chip shows. */
export type BalanceChip =
  | { readonly kind: 'hidden' }
  | { readonly kind: 'key' }
  | { readonly kind: 'held'; readonly heldCents: number | null }
  | { readonly kind: 'balance'; readonly cents: number }

/**
 * Decide the chip for one Session.
 * @param billing - the active metering source, or null.
 * @param provider - route of the Session's current model; undefined when none is selected.
 * @param running - whether the Session's turn runs.
 * @param turnFrame - the frame for this Session observed since its turn started, or null.
 * @returns hidden signed out or without a model; "your key" off the metered route;
 * "held" while the turn runs and its latest frame holds money (or none arrived);
 * otherwise the newest balance known.
 */
export function balanceChip(
  billing: ActiveBilling | null, provider: string | undefined, running: boolean, turnFrame: ModelBillingFrame | null,
): BalanceChip {
  if (billing === null || !billing.state.signedIn || provider === undefined) return { kind: 'hidden' }
  if (provider !== billing.provider) return { kind: 'key' }
  if (running && (turnFrame === null || (turnFrame.heldCents ?? 0) > 0)) {
    return { kind: 'held', heldCents: turnFrame?.heldCents ?? null }
  }
  const cents = turnFrame?.balanceCents ?? billing.state.balanceCents
  return cents === null ? { kind: 'hidden' } : { kind: 'balance', cents }
}

/**
 * Format US cents as a balance: `$12.40`, `$3`, `-$0.50`.
 * @param cents - amount in cents.
 * @returns the dollar amount.
 */
export function formatCents(cents: number): string {
  const whole = cents % 100 === 0
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100)
}

/**
 * Format a per-message price: `3.3¢`, `0.2¢`, `<0.1¢`, or dollars from one dollar up.
 * @param cents - price in cents, possibly fractional.
 * @returns the price.
 */
export function formatPrice(cents: number): string {
  if (cents >= 100) return formatCents(Math.round(cents))
  if (cents > 0 && cents < 0.1) return '<0.1¢'
  return `${String(Math.round(cents * 10) / 10)}¢`
}
