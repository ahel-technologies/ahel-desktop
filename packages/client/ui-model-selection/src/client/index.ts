/**
 * Model selection plugin, browser half — TWO entries over ONE per-session
 * directory owned by ModelDirectoryResolver (`ctx.modelDirectories`). The /model popupSelect
 * contribution and the composer's named `conversation.input.model` seat share
 * one Host-generation `session/modelCatalog` catalog, combine it with the Session's
 * durable model-selection projection, and submit through `session.selectModel`.
 * A switch made in either entry is what the other shows next. Failures
 * ride each entry's own retry surface (popup shell error/retry; seat menu
 * inline error) without forking the state. Addressed subagent sessions expose
 * neither entry because those Agent-bound RPCs would activate persisted
 * history outside the direct-parent continuation path.
 */
// Type-only: the carrier types, the forwarded Host-event face and the ctx.remote merge.
import type { ModelSelection } from '@ahel/dsh-api-session-controller/types'
import type {} from '@ahel/dsh-api-session-controller/client'
import type { Context as ClientContext } from '@ahel/cordis'
import type { CommandUiContract, SelectOption } from '@ahel/dsh-client-ui-commands/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.model seat).
import type {} from '@ahel/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@ahel/dsh-client-locale/client'
import type {} from '@ahel/dsh-client-ui-renderer/client'
import type {} from '@ahel/dsh-client-ui-session/client'
import type { TranslateNS } from '@ahel/dsh-client-ui-slots'
import type { ShortcutCommandId } from '@ahel/dsh-client-shortcuts/client'
import { IconDataOutlineRegular } from '@ahel/dsh-client-ui-primitives'
import type { ActiveBilling } from './billing.ts'
import { formatPrice } from './billing.ts'
import type { ModelDirectoryState } from './directory.ts'
import { pickerGroups, preferredRoute } from './rows.ts'
import { ModelDirectoryResolver } from './service.ts'
import type { ModelSelectInjected } from './slots.ts'
import { ModelSelect } from './ModelSelect.tsx'
import { en, zh, type ModelKey } from './locales.ts'

export { ModelDirectory } from './directory.ts'
export type { ModelDirectoryState } from './directory.ts'
export { ModelDirectoryResolver } from './service.ts'
export type { ModelSelectInjected } from './slots.ts'
export type { ModelKey } from './locales.ts'
export { balanceChip, formatCents, formatPrice } from './billing.ts'
export type {
  ActiveBilling, BalanceChip, MeteredModelFacts, ModelBillingFrame, ModelBillingSource, ModelBillingState,
} from './billing.ts'
export { pickerGroups, preferredRoute, rowOf, searchGroups } from './rows.ts'
export type { PickerGroup, PickerRoute, PickerRow } from './rows.ts'
export { modelIdentity, readableModelName, staticModelFacts } from './names.ts'

/** Shortcut command id of the composer picker. */
const OPEN_PICKER = 'model.open' as ShortcutCommandId

declare module '@ahel/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The model selection surfaces' copy (/model popup + composer seat). */
    model: ModelKey
  }
}

/** One selectable row's id: an opaque row key (resolved by lookup, never parsed). */
function rowId(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`
}

/**
 * Flatten the directory into popup rows grouped by maker, one row per model
 * on the route a pick takes; failure rows are listed for visibility but never selectable.
 */
function optionsOf(directory: ModelDirectoryState, billing: ActiveBilling | null, t: TranslateNS<'model'>): SelectOption[] {
  const rows: SelectOption[] = []
  for (const group of pickerGroups(directory.groups, billing)) {
    for (const row of group.rows) {
      const route = preferredRoute(row, directory.current)
      const detail = route.metered && billing !== null
        ? row.typicalCents === undefined ? undefined : t('option.metered', { price: formatPrice(row.typicalCents), name: billing.state.name })
        : t('option.own', { provider: route.providerName })
      rows.push({
        id: rowId(route.provider, route.model),
        label: row.shortName,
        group: { name: group.maker, label: group.maker },
        ...detail === undefined ? {} : { detail },
        ...(directory.current !== null
          && directory.current.provider === route.provider
          && directory.current.model === route.model
          ? { active: true } : {}),
      })
    }
  }
  for (const failure of directory.failures) {
    rows.push({
      id: `failure/${failure.id}`,
      label: failure.name,
      detail: t('option.loadError', { message: failure.message }),
    })
  }
  return rows
}

/**
 * Resolve a picked row back to its model selection by matching against the loaded
 * groups (the same data the rows were built from — ids stay opaque).
 * @param state - the session's directory snapshot.
 * @param id - the picked row id.
 * @returns the row's model selection, or undefined for failure rows / stale ids.
 */
function selectionOf(state: ModelDirectoryState, id: string): ModelSelection | undefined {
  for (const group of state.groups) {
    for (const model of group.models) {
      if (rowId(group.id, model.id) !== id) continue
      const sameRoute = state.current?.provider === group.id && state.current.model === model.id
      const reasoningEffort = sameRoute
        ? state.current?.reasoningEffort ?? model.reasoning?.defaultEffort
        : model.reasoning?.defaultEffort
      return {
        provider: group.id,
        model: model.id,
        ...reasoningEffort === undefined ? {} : { reasoningEffort },
      }
    }
  }
  return undefined
}

/** Dictionary namespace owned by this plugin. */
const NS = 'model'

/** Required services: the contribution registry, the seat's slot registry, locale, and the service's own faces. */
export const inject = ['commandUi', 'locale', 'sessions', 'slots', 'remote', 'remote.session']

/**
 * Client plugin body: mount ModelDirectoryResolver, register the `model` dictionaries,
 * then register the /model popup contribution and the composer model seat
 * over the service.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-model-selection: dictionaries')

  // Non-slot faces (the command description, the popup option builder) read
  // through the bound translate; the seat component reads the standard seat.
  const t = ctx.locale.bind(NS)

  ctx.plugin(ModelDirectoryResolver)

  // Entry 1: the /model popupSelect over the shared directory.
  ctx.inject(['commandUi', 'modelDirectories'], (scope: ClientContext) => {
    const command = scope.get('commandUi') as CommandUiContract
    const models = scope.modelDirectories
    const sessions = scope.sessions
    scope.effect(() => command.register({
      name: 'model',
      label: () => t('command.label'),
      description: () => t('command.description'),
      icon: IconDataOutlineRegular,
      available: session => sessions.subagentAddress(session.sessionId) === undefined,
      ui: {
        kind: 'popupSelect',
        searchMode: 'fuzzy-label',
        searchLabels: () => ({
          placeholder: t('search.placeholder'),
          empty: t('empty.models'),
          noResults: t('search.empty'),
        }),
        options: async (session) => {
          if (sessions.subagentAddress(session.sessionId) !== undefined) {
            throw new Error('model selection is unavailable for addressed subagent sessions')
          }
          return optionsOf(await models.directoryFor(session.sessionId).load(), models.billing.getSnapshot(), t)
        },
        onSelect: async (option, session) => {
          if (sessions.subagentAddress(session.sessionId) !== undefined) {
            throw new Error('model selection is unavailable for addressed subagent sessions')
          }
          const directory = models.directoryFor(session.sessionId)
          const selection = selectionOf(directory.store.getSnapshot(), option.id)
          if (selection === undefined) {
            throw new Error('this provider\'s catalog failed to load — pick a model from a loaded group')
          }
          const result = await directory.select(selection)
          if (!result.ok) {
            if (result.error.code === 'session/writer-held') throw new Error(t('error.sessionInUse'))
            throw result.error
          }
        },
      },
    }), 'ui-model-selection: /model contribution')
  })

  // Entry 2: the composer's named model seat over the SAME directory.
  ctx.inject(['slots', 'modelDirectories'], (scope: ClientContext) => {
    const models = scope.modelDirectories
    const sessions = scope.sessions
    scope.slots.inject('conversation.input.model', () => scope.slots.register({
      name: 'conversation.input.model',
      locale: NS,
      inject: (sessionId): ModelSelectInjected => {
        const directory = models.directoryFor(sessionId)
        const available = sessions.subagentAddress(sessionId) === undefined
        const binding = sessions.binding(sessionId)
        /* v8 ignore next -- directoryFor already failed loud for a Session without a binding. */
        if (binding === undefined) throw new Error(`ui-model-selection: session "${String(sessionId)}" resolved no binding`)
        return {
          available,
          directory: directory.store,
          load: () => {
            if (available) directory.load().catch(() => { /* surfaced on the store */ })
          },
          select: (selection: ModelSelection) => available
            ? directory.select(selection)
            : Promise.resolve(undefined),
          billing: models.billing,
          session: binding.session,
          remembered: models.remembered,
          sessionKey: String(sessionId),
          setRemembered: (on: boolean) => { models.setRemembered(sessionId, on) },
          registerOpener: open => models.registerOpener(sessionId, open),
          shortcutKeys: () => scope.get('shortcuts')?.catalog.getSnapshot().find(entry => entry.id === OPEN_PICKER)?.keys ?? [],
        }
      },
    }, ModelSelect))
  })

  // ⌥⌘/ (Ctrl+Alt+/) opens the picker of the chat in view; ⌘/ stays the shortcut reference. Linux Web keeps the browser's keys.
  ctx.inject(['shortcuts', 'modelDirectories'], (scope: ClientContext) => {
    const binding = { code: 'Slash', modifiers: ['primary', 'alt'] } as const
    scope.effect(() => scope.shortcuts.register({
      id: OPEN_PICKER,
      label: () => t('shortcut.open'),
      aliases: ['model', 'switch model', 'model picker'],
      defaults: {
        'desktop:macos': binding, 'desktop:windows': binding, 'desktop:linux': binding, 'web:macos': binding, 'web:windows': binding,
      },
      regions: ['page', 'editable'],
      modals: [],
      resolve: () => scope.modelDirectories.hasPicker()
        ? { status: 'handled', run: () => { scope.modelDirectories.openPicker() } }
        : { status: 'blocked', reason: t('shortcut.noPicker') },
    }), 'ui-model-selection: open-picker shortcut')
  })
}
