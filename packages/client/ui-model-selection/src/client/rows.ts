/**
 * The picker's rows: the Host catalog's provider groups regrouped by maker.
 * A model offered both on the metered route and on one of the person's own
 * keys is ONE row with two routes; every row carries a short name, never an id.
 */
import type { ModelProviderGroup, ModelReasoning, ModelSelection } from '@ahel/dsh-api-remotes/client'
import { rankByName } from '@ahel/dsh-client-ui-primitives'
import type { ActiveBilling } from './billing.ts'
import { modelIdentity, staticModelFacts, type BestForKey } from './names.ts'

/** One way to run a row's model. */
export interface PickerRoute {
  readonly provider: string
  readonly model: string
  /** Provider group name, e.g. "DeepSeek" for "billed by DeepSeek". */
  readonly providerName: string
  readonly metered: boolean
  readonly reasoning: ModelReasoning | undefined
}

/** One row of the picker. */
export interface PickerRow {
  /** Stable row key (model identity, plus the provider for a second own-key route). */
  readonly key: string
  readonly shortName: string
  readonly maker: string
  /** Server "best for" text, or a static locale key, or nothing. */
  readonly bestFor: { readonly text: string } | { readonly key: BestForKey } | undefined
  /** Typical message price on the metered route, in cents. */
  readonly typicalCents: number | undefined
  /** The workspace's last real charge on the metered route, in cents. */
  readonly lastChargeCents: number | undefined
  readonly metered: PickerRoute | undefined
  readonly own: PickerRoute | undefined
}

/** Rows of one maker, in catalog order. */
export interface PickerGroup {
  readonly maker: string
  readonly rows: readonly PickerRow[]
}

interface DraftRow {
  key: string
  shortName: string
  maker: string
  bestFor: PickerRow['bestFor']
  typicalCents: number | undefined
  lastChargeCents: number | undefined
  metered: PickerRoute | undefined
  own: PickerRoute | undefined
}

/**
 * Regroup the catalog by maker and merge each metered model with the same
 * model on an own key.
 * @param groups - the Host catalog's provider groups, in catalog order.
 * @param billing - the active metering source, or null when none is registered.
 * @returns maker groups in order of first appearance; metered groups lead because the catalog lists them first.
 */
export function pickerGroups(groups: readonly ModelProviderGroup[], billing: ActiveBilling | null): PickerGroup[] {
  const rows: DraftRow[] = []
  const byIdentity = new Map<string, DraftRow>()
  const ordered = billing === null
    ? groups
    : [...groups.filter(group => group.id === billing.provider), ...groups.filter(group => group.id !== billing.provider)]
  for (const group of ordered) {
    const metered = billing !== null && group.id === billing.provider
    for (const model of group.models) {
      const identity = modelIdentity(model.id)
      const known = staticModelFacts(model.id)
      const facts = metered ? billing.state.models[model.id] : undefined
      const route: PickerRoute = { provider: group.id, model: model.id, providerName: group.name, metered, reasoning: model.reasoning }
      const existing = byIdentity.get(identity)
      if (existing !== undefined && (metered ? existing.metered === undefined : existing.own === undefined)) {
        if (metered) {
          existing.metered = route
          existing.typicalCents = facts?.typicalMessageCents
          existing.lastChargeCents = facts?.lastChargeCents
        } else {
          existing.own = route
        }
        continue
      }
      const row: DraftRow = {
        key: existing === undefined ? identity : `${identity}@${group.id}`,
        shortName: facts?.shortName ?? known.shortName,
        maker: facts?.maker ?? known.maker ?? (metered ? makerOfPrefix(model.id) : group.name),
        bestFor: facts?.bestFor !== undefined ? { text: facts.bestFor } : known.bestFor === undefined ? undefined : { key: known.bestFor },
        typicalCents: facts?.typicalMessageCents,
        lastChargeCents: facts?.lastChargeCents,
        metered: metered ? route : undefined,
        own: metered ? undefined : route,
      }
      rows.push(row)
      if (existing === undefined) byIdentity.set(identity, row)
    }
  }
  const out: { maker: string; rows: PickerRow[] }[] = []
  for (const row of rows) {
    const group = out.find(candidate => candidate.maker === row.maker)
    if (group === undefined) out.push({ maker: row.maker, rows: [row] })
    else group.rows.push(row)
  }
  return out
}

/** A metered id's routing prefix as a maker name ("mistralai/x" → "Mistralai"); "Other" without one. */
function makerOfPrefix(id: string): string {
  const prefix = id.includes('/') ? id.slice(0, id.indexOf('/')) : ''
  return prefix === '' ? 'Other' : prefix.charAt(0).toUpperCase() + prefix.slice(1)
}

/**
 * Filter maker groups by a query over short names; empty groups drop out.
 * @param groups - maker groups.
 * @param query - search text; blank keeps everything.
 * @returns ranked rows per group.
 */
export function searchGroups(groups: readonly PickerGroup[], query: string): PickerGroup[] {
  const trimmed = query.trim()
  return groups.map(group => ({
    maker: group.maker,
    rows: rankByName(group.rows.map(row => ({ ...row, name: row.shortName, label: group.maker })), trimmed),
  })).filter(group => group.rows.length > 0)
}

/**
 * The route a selection uses on a row.
 * @param row - picker row.
 * @param selection - the Session's selection.
 * @returns the matching route, or undefined when the selection is another row's.
 */
export function routeOf(row: PickerRow, selection: ModelSelection | null): PickerRoute | undefined {
  if (selection === null) return undefined
  return [row.metered, row.own].find(route => route?.provider === selection.provider && route.model === selection.model)
}

/**
 * The route a click on a row takes: the route already in use on this row,
 * else the metered route (billed to the workspace), else the own key.
 * @param row - picker row.
 * @param selection - the Session's selection.
 * @returns the route to select.
 */
export function preferredRoute(row: PickerRow, selection: ModelSelection | null): PickerRoute {
  // A row always has at least one route.
  return routeOf(row, selection) ?? row.metered ?? (row.own as PickerRoute)
}

/**
 * Find the row and route of a selection.
 * @param groups - maker groups.
 * @param selection - the Session's selection.
 * @returns the row and route, or undefined when the catalog lacks the selection.
 */
export function rowOf(
  groups: readonly PickerGroup[], selection: ModelSelection | null,
): { row: PickerRow; route: PickerRoute } | undefined {
  for (const group of groups) {
    for (const row of group.rows) {
      const route = routeOf(row, selection)
      if (route !== undefined) return { row, route }
    }
  }
  return undefined
}
