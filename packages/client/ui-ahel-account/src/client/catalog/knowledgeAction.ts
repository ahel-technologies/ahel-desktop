/**
 * The Knowledge product button: one press adds, turns on or finishes setup
 * for every source the product sells, through the same `install` and
 * `setEnabled` calls the Discover rows use.
 */
import { useState } from 'react'
import type {
  CatalogCapability, CatalogInstalled, CatalogRow, KnowledgeProduct, KnowledgeSource,
} from '@ahel/dsh-ahel-account/types'
import type { AhelAccountKey } from '../locales.ts'
import { capabilityOf, failureOf, setupUrl } from './AppRow.tsx'
import type { CatalogFaceProps } from './contract.ts'

/** Where "Open on ahel.ai" sends the person. */
export const KNOWLEDGE_URL = 'https://ahel.ai/knowledge'

/** Whole cents per query as ahel.ai prints it. */
export function formatPrice(cents: number): string {
  return `${cents}¢ per query`
}

/**
 * A source as a Discover row, so the detail sheet reuses `AppRow` and its state button.
 * The product carries the price, so the row has no facts.
 * @param source - the Knowledge source.
 * @returns the row.
 */
export function sourceRow(source: KnowledgeSource): CatalogRow {
  return {
    id: source.id,
    name: source.name,
    kind: 'app',
    kindLabel: 'App',
    tile: { text: source.name.slice(0, 1).toUpperCase(), tone: 'ahel', mark: null },
    facts: [],
    chips: [],
    description: source.description === '' ? null : source.description,
    href: source.href,
    state: source.servable ? 'add' : 'unavailable',
    vendor: null,
    official: true,
  }
}

/** What the product button shows and does. */
export type ProductAction =
  | { readonly kind: 'signIn' | 'on' | 'none' }
  | { readonly kind: 'setup'; readonly capability: CatalogCapability }
  | { readonly kind: 'enable'; readonly keys: readonly string[] }
  | { readonly kind: 'add'; readonly ids: readonly string[] }

/**
 * Work out the product button from the person's installs.
 * @param product - the product.
 * @param installed - the person's installs, if read.
 * @param signedIn - whether an Ahel account is signed in.
 * @returns the button's action.
 */
export function productAction(product: KnowledgeProduct, installed: CatalogInstalled | null, signedIn: boolean): ProductAction {
  const servable = product.sources.filter(source => source.servable)
  if (servable.length === 0) return { kind: 'none' }
  if (!signedIn) return { kind: 'signIn' }
  const pairs = servable.map(source => ({ source, capability: capabilityOf(sourceRow(source), installed) }))
  const setup = pairs.find(pair => pair.capability?.state === 'needs_setup')?.capability
  if (setup !== undefined) return { kind: 'setup', capability: setup }
  const missing = pairs.filter(pair => pair.capability === undefined || pair.capability.state === 'available').map(pair => pair.source.id)
  if (missing.length > 0) return { kind: 'add', ids: missing }
  const off = pairs.flatMap(pair => pair.capability?.state === 'off' ? [pair.capability.key] : [])
  if (off.length > 0) return { kind: 'enable', keys: off }
  return { kind: 'on' }
}

/** The button label key per action. */
const LABEL: Record<ProductAction['kind'], AhelAccountKey> = {
  signIn: 'signInToAdd', on: 'stateOn', none: 'stateUnavailable', setup: 'stateNeedsSetup', enable: 'stateTurnOn', add: 'stateAdd',
}

/** The product button's live state: label, whether it can be pressed, the last outcome, and the press. */
export interface ProductButton {
  readonly label: string
  readonly disabled: boolean
  readonly outcome: { readonly text: string; readonly error: boolean; readonly prompt: string | null } | null
  readonly press: () => void
}

/**
 * Drive one product button.
 * @param product - the product.
 * @param props - the person's installs and the catalog actions.
 * @returns the button state.
 */
export function useProductButton(product: KnowledgeProduct, props: Pick<CatalogFaceProps, 'install' | 'setEnabled' | 'signIn' | 'openLink' | 't'> & {
  readonly installed: CatalogInstalled | null
  readonly signedIn: boolean
}): ProductButton {
  const { installed, signedIn, install, setEnabled, signIn, openLink, t } = props
  const [progress, setProgress] = useState<{ done: number; of: number } | null>(null)
  const [outcome, setOutcome] = useState<ProductButton['outcome']>(null)
  const action = productAction(product, installed, signedIn)
  const origin = new URL(product.sources[0]?.href ?? 'https://ahel.ai').origin

  const run = async (): Promise<void> => {
    switch (action.kind) {
      case 'signIn': await signIn(); return
      case 'setup': openLink(setupUrl(origin, action.capability)); return
      case 'enable': {
        setProgress({ done: 0, of: action.keys.length })
        for (const [index, key] of action.keys.entries()) {
          await setEnabled(key, true)
          setProgress({ done: index + 1, of: action.keys.length })
        }
        setOutcome({ text: t('knowledgeAdded', { prompt: product.ask }), error: false, prompt: product.ask })
        return
      }
      case 'add': {
        setProgress({ done: 0, of: action.ids.length })
        let setupAt: string | null = null
        for (const [index, id] of action.ids.entries()) {
          const result = await install(id)
          if (result.state === 'needs_setup' && setupAt === null) setupAt = result.signInUrl ?? result.connectUrl ?? null
          setProgress({ done: index + 1, of: action.ids.length })
        }
        if (setupAt !== null) openLink(setupAt)
        else setOutcome({ text: t('knowledgeAdded', { prompt: product.ask }), error: false, prompt: product.ask })
        return
      }
      default:
    }
  }

  return {
    label: progress === null ? t(LABEL[action.kind]) : t('knowledgeAdding', { done: progress.done, of: progress.of }),
    disabled: progress !== null || action.kind === 'on' || action.kind === 'none',
    outcome,
    press: () => {
      setOutcome(null)
      void run().catch((error: unknown) => {
        const failure = failureOf(error)
        setOutcome({ text: failure.code === 'ahel-catalog/refused' && failure.message !== '' ? failure.message : t('actionFailed'), error: true, prompt: null })
      }).finally(() => { setProgress(null) })
    },
  }
}
