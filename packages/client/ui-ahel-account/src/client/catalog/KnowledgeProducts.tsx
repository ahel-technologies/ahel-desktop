/**
 * The Knowledge section's product directory, as ahel.ai/knowledge draws it
 * (KnowledgeDirectory): four products by job, one price each, each listing
 * its sources as Discover rows. "Add all" installs a product's sources in
 * one call with its `installId`.
 */
import { useState } from 'react'
import type { CatalogInstalled, CatalogRow, KnowledgeProduct, KnowledgeSource } from '@ahel/dsh-ahel-account/types'
import type { CatalogFaceProps } from './contract.ts'
import { AppRow, capabilityOf, failureOf, LOOK_CLASS } from './AppRow.tsx'
import { KnowledgeTile } from './KnowledgeTile.tsx'
import css from './Catalog.module.css'

/** Typed row facts AppRow translates itself; the literals are data, not copy. */
const KIND_APP: CatalogRow['kindLabel'] = 'App'
const PROVENANCE_OFFICIAL: Extract<CatalogRow['facts'][number], { key: 'provenance' }>['text'] = 'Official'

/** Where "Add money to your balance" goes. */
const BILLING_URL = 'https://ahel.ai/billing'

/**
 * A source as a Discover row, priced like ahel.ai's dataset rows.
 * @param source - the source.
 * @param price - its product's price line.
 * @param t - the directory's translator.
 * @returns the row.
 */
function sourceRow(source: KnowledgeSource, price: string, t: KnowledgeProductsProps['t']): CatalogRow {
  return {
    id: source.id,
    name: source.name,
    kind: 'app',
    kindLabel: KIND_APP,
    tile: { text: source.name.slice(0, 1).toUpperCase(), tone: 'ahel', mark: null },
    facts: [
      { key: 'provenance', text: PROVENANCE_OFFICIAL, official: true },
      { key: 'by', text: t('byAhel') },
      { key: 'runs', text: t('hostedByAhel') },
      { key: 'price', text: price, source: 'ahel' },
    ],
    chips: [],
    description: source.description === '' ? null : source.description,
    href: source.href,
    state: source.servable ? 'add' : 'unavailable',
    vendor: null,
    official: true,
  }
}

/** Props of the directory. */
export type KnowledgeProductsProps = Pick<CatalogFaceProps, 'install' | 'setEnabled' | 'signIn' | 'openLink' | 't'> & {
  readonly products: readonly KnowledgeProduct[]
  readonly installed: CatalogInstalled | null
  readonly signedIn: boolean
  readonly onOpen: (row: CatalogRow) => void
}

/**
 * Render the four products.
 * @param props - the products, the person's installs and the catalog actions.
 * @returns the directory section.
 */
export function KnowledgeProducts(props: KnowledgeProductsProps) {
  const { products, openLink, t } = props
  return (
    <section className={css.knowledge} aria-label={t('concept.knowledge')}>
      <header className={css.knowledgeHeading}>
        <div>
          <p className={css.knowledgeEyebrow}>{t('knowledgeEyebrow')}</p>
          <h2>{t('knowledgeHeading')}</h2>
        </div>
        <p>
          {t('knowledgeBody')}{' '}
          <button type="button" className={css.crumb} onClick={() => { openLink(BILLING_URL) }}>{t('knowledgeAddMoney')}</button>
        </p>
      </header>
      <div className={css.products}>
        {products.map(product => <ProductCard key={product.id} product={product} {...props} />)}
      </div>
    </section>
  )
}

/**
 * One product card: tile, name, promise, facts strip with the product button, what is inside, the ask, its sources.
 * @param props - the product and the directory's props.
 * @returns the card.
 */
function ProductCard(props: KnowledgeProductsProps & { readonly product: KnowledgeProduct }) {
  const { product, installed, signedIn, install, signIn, t } = props
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null)
  const rows = product.sources.map(source => sourceRow(source, product.price, t))
  const servable = rows.filter(row => row.state !== 'unavailable')
  const missing = servable.filter(row => capabilityOf(row, installed) === undefined)
  const allOn = servable.length > 0 && servable.every(row => capabilityOf(row, installed)?.state === 'on')

  const press = (): void => {
    setBusy(true)
    setNote(null)
    const run = signedIn
      ? install(product.installId).then((result) => { setNote({ text: t('addedTry', { prompt: result.try ?? product.ask }), error: false }) })
      : signIn()
    void run.catch((error: unknown) => {
      const failure = failureOf(error)
      setNote({ text: failure.code === 'ahel-catalog/refused' && failure.message !== '' ? failure.message : t('actionFailed'), error: true })
    }).finally(() => { setBusy(false) })
  }

  return (
    <article className={css.card} aria-labelledby={`knowledge-product-${product.id}`}>
      <KnowledgeTile glyph={product.glyph} />
      <h3 className={css.cardName} id={`knowledge-product-${product.id}`}>{product.name}</h3>
      <p className={css.promise}>{product.promise}</p>
      <ul className={css.strip}>
        <li><span className={css.chip}>{product.price}</span></li>
        <li className={css.fact}>{t('knowledgeSources', { count: product.sources.length })}</li>
        <li className={css.fact}>{t('knowledgeNoSubscription')}</li>
        {servable.length > 0 && (
          <li className={css.stripEnd}>
            <button type="button" className={LOOK_CLASS[allOn ? 'on' : 'dark']} disabled={busy || allOn} onClick={press}>
              {allOn ? t('stateOn') : t('knowledgeAddAll', { count: signedIn && installed !== null ? missing.length || servable.length : servable.length })}
            </button>
          </li>
        )}
      </ul>
      {note !== null && <p className={note.error ? `${css.promise} ${css.error}` : css.promise} role="status">{note.text}</p>}
      <p className={css.includes}><span>{t('knowledgeInside')}</span>{product.includes}</p>
      <blockquote className={css.askQuote}>{product.ask}</blockquote>
      <section className={css.sources} aria-labelledby={`knowledge-sources-${product.id}`}>
        <h4 className={css.sourcesHeading} id={`knowledge-sources-${product.id}`}>{t('knowledgeSources', { count: rows.length })}</h4>
        <ul className={css.list}>
          {rows.map(row => (
            <AppRow key={row.id} row={row} installed={installed} signedIn={signedIn} onOpen={props.onOpen}
              install={install} setEnabled={props.setEnabled} signIn={signIn} openLink={props.openLink} t={t} />
          ))}
        </ul>
      </section>
    </article>
  )
}
