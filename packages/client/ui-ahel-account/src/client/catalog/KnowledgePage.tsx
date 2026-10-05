/**
 * The Knowledge main panel: ahel.ai's four Knowledge products as cards
 * (glyph tile, name, one line, price chip, source count, one state button),
 * a search over their sources, and a detail sheet per product.
 */
import { useEffect, useRef, useState } from 'react'
import { Button, IconSearchOutlineRegular, Input, Tag } from '@ahel/dsh-client-ui-primitives'
import type { CatalogInstalled, KnowledgeListing, KnowledgeProduct } from '@ahel/dsh-ahel-account/types'
import type { CatalogFaceProps, DiscoverPageProps } from './contract.ts'
import { KnowledgeDrawer } from './KnowledgeDrawer.tsx'
import { KnowledgeTile } from './KnowledgeTile.tsx'
import { formatPrice, KNOWLEDGE_URL, useProductButton } from './knowledgeAction.ts'
import catalogCss from './Catalog.module.css'
import css from './Knowledge.module.css'

/** Search waits this long after the last keystroke. */
const DEBOUNCE_MS = 300

/** Props of the Knowledge main panel; the same face as Discover. */
export type KnowledgePageProps = DiscoverPageProps

/**
 * The products a search shows: any whose own words match, or that sells a matched source.
 * @param listing - the listing for the search words.
 * @param q - the search words.
 * @returns the products to draw, each with the count of its matched sources.
 */
function shown(listing: KnowledgeListing, q: string): { product: KnowledgeProduct; matched: number | null }[] {
  if (listing.matches === null) return listing.products.map(product => ({ product, matched: null }))
  const words = q.toLowerCase()
  const matches = new Set(listing.matches)
  return listing.products.flatMap((product) => {
    const matched = product.sources.filter(source => matches.has(source.id)).length
    const own = `${product.name} ${product.promise} ${product.includes}`.toLowerCase().includes(words)
    return matched > 0 || own ? [{ product, matched }] : []
  })
}

/**
 * Render the Knowledge panel.
 * @param props - composed slot props: the catalog face, its hooks and `t`.
 * @returns the page; a card opens the product's detail sheet.
 */
export function KnowledgePage(props: KnowledgePageProps) {
  const { knowledge, openLink, useAccount, useInstalled, t } = props
  const signedIn = useAccount(view => view?.status === 'signed-in')
  const installed = useInstalled(value => value)
  const [input, setInput] = useState('')
  const [q, setQ] = useState('')
  const [listing, setListing] = useState<KnowledgeListing | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const ticket = useRef(0)

  useEffect(() => {
    const timer = setTimeout(() => { setQ(input.trim()) }, DEBOUNCE_MS)
    return () => { clearTimeout(timer) }
  }, [input])

  useEffect(() => {
    const mine = ++ticket.current
    setStatus('loading')
    knowledge(q).then((next) => {
      if (mine !== ticket.current) return
      setListing(next)
      setStatus('ready')
    }, () => {
      if (mine === ticket.current) setStatus('error')
    })
  }, [knowledge, q, attempt])

  const cards = status === 'ready' && listing !== null ? shown(listing, q) : []
  const open = listing?.products.find(product => product.id === selected) ?? null

  return (
    <div className={catalogCss.page}>
      <header className={catalogCss.head} data-window-drag>
        <h1 className={catalogCss.title}>{t('knowledgeTitle')}</h1>
        <p className={catalogCss.lead}>{t('knowledgeLead')}</p>
      </header>
      <div className={catalogCss.controls}>
        <Input className={catalogCss.search ?? ''} icon={<IconSearchOutlineRegular size={16} />} type="search" value={input}
          placeholder={t('knowledgeSearchPlaceholder')} aria-label={t('knowledgeSearchLabel')}
          onChange={(event) => { setInput(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              const next = input.trim()
              if (next === q) setAttempt(value => value + 1)
              else setQ(next)
            }
          }} />
      </div>
      <div aria-busy={status === 'loading'}>
        {status === 'loading' && (
          <ul className={css.grid} aria-hidden="true">
            {Array.from({ length: 4 }, (_, index) => (
              <li key={index} className={css.card}>
                <span className={`${css.skeletonTile} ${catalogCss.skeletonFill}`} />
                <span className={`${catalogCss.skeletonBar} ${catalogCss.skeletonName} ${catalogCss.skeletonFill}`} />
                <span className={`${catalogCss.skeletonBar} ${catalogCss.skeletonLine} ${catalogCss.skeletonFill}`} />
              </li>
            ))}
          </ul>
        )}
        {status === 'error' && (
          <div className={catalogCss.state} role="alert">
            <p className={catalogCss.stateText}>{t('browseFailed')}</p>
            <Button variant="outline" size="sm" onClick={() => { setAttempt(value => value + 1) }}>{t('retry')}</Button>
          </div>
        )}
        {status === 'ready' && cards.length === 0 && (
          <div className={catalogCss.state}>
            <p className={catalogCss.stateTitle}>{t('nothingMatches')}</p>
            <Button variant="outline" size="sm" onClick={() => { openLink(KNOWLEDGE_URL) }}>{t('openOnAhel')}</Button>
          </div>
        )}
        {cards.length > 0 && (
          <ul className={css.grid}>
            {cards.map(({ product, matched }) => (
              <KnowledgeCard key={product.id} product={product} matched={matched} installed={installed} signedIn={signedIn}
                onOpen={() => { setSelected(product.id) }} install={props.install} setEnabled={props.setEnabled}
                signIn={props.signIn} openLink={openLink} t={t} />
            ))}
          </ul>
        )}
        {status === 'ready' && <p className={css.footnote}>{t('knowledgeFootnote')}</p>}
      </div>
      {open !== null && (
        <KnowledgeDrawer key={open.id} product={open} matches={listing?.matches ?? null} installed={installed} signedIn={signedIn}
          onClose={() => { setSelected(null) }} install={props.install} setEnabled={props.setEnabled} signIn={props.signIn}
          openLink={openLink} t={t} />
      )}
    </div>
  )
}

/** Props of one product card. */
type KnowledgeCardProps = Pick<CatalogFaceProps, 'install' | 'setEnabled' | 'signIn' | 'openLink' | 't'> & {
  readonly product: KnowledgeProduct
  /** Sources the search words found in this product; null while browsing. */
  readonly matched: number | null
  readonly installed: CatalogInstalled | null
  readonly signedIn: boolean
  readonly onOpen: () => void
}

/**
 * Render one product card.
 * @param props - the product, the person's installs and the catalog actions.
 * @returns the card.
 */
function KnowledgeCard(props: KnowledgeCardProps) {
  const { product, matched, onOpen, t } = props
  const button = useProductButton(product, props)
  return (
    <li className={css.card}>
      <button type="button" className={css.cardMain} onClick={onOpen}>
        <KnowledgeTile glyph={product.glyph} size={48} />
        <span className={css.cardName}>{product.name}</span>
        <span className={css.cardLine}>{product.promise}</span>
      </button>
      <div className={css.strip}>
        <Tag tone="success">{formatPrice(product.cents)}</Tag>
        <span className={css.fact}>{t('knowledgeSources', { count: product.sources.length })}</span>
        {matched !== null && matched > 0 && <span className={css.fact}>{t('knowledgeMatched', { count: matched })}</span>}
        <span className={css.stripEnd}>
          <Button variant="outline" size="sm" disabled={button.disabled} onClick={button.press}>{button.label}</Button>
        </span>
      </div>
      {button.outcome !== null && (
        <p className={button.outcome.error ? `${css.note} ${css.noteError}` : css.note} role="status">{button.outcome.text}</p>
      )}
    </li>
  )
}
