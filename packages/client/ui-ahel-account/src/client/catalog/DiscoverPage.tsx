/** The Discover main panel: search, kind and category filters, and paged result rows from ahel.ai's public listing. */
import { useEffect, useRef, useState } from 'react'
import { Button, IconSearchOutlineRegular, Input, Pill, SegmentedControl } from '@ahel/dsh-client-ui-primitives'
import type { CatalogBrowsePage, CatalogBrowseQuery, CatalogGroup } from '@ahel/dsh-ahel-account/types'
import type { DiscoverPageProps } from './contract.ts'
import { AppRow } from './AppRow.tsx'
import { DetailDrawer } from './DetailDrawer.tsx'
import css from './Catalog.module.css'

/** ahel.ai's 15 Discover categories, in its rail order. */
const CATEGORIES = [
  'search', 'web', 'data', 'files', 'docs', 'comms', 'cloud', 'monitoring', 'security', 'media', 'commerce',
  'productivity', 'ai-models', 'dev-tools', 'other',
] as const

/** Search waits this long after the last keystroke. */
const DEBOUNCE_MS = 300

/** Skeleton rows shown while a page loads. */
const SKELETON_ROWS = 6

/** Where "Ask for an app" sends the person. */
const ASK_URL = 'https://ahel.ai/discover'

type Kind = CatalogBrowseQuery['kind']

/** The listing as loaded so far for one query. */
interface Listing {
  /** The first page's query; nested-skill slices are fetched under it. */
  readonly query: CatalogBrowseQuery
  readonly groups: readonly CatalogGroup[]
  readonly last: CatalogBrowsePage
}

/**
 * Render the Discover panel.
 * @param props - composed slot props: the catalog face, its hooks and `t`.
 * @returns the page; a result opens in the detail sheet.
 */
export function DiscoverPage(props: DiscoverPageProps) {
  const { browse, openLink, useAccount, useInstalled, t } = props
  const signedIn = useAccount(view => view?.status === 'signed-in')
  const installed = useInstalled(value => value)
  const [input, setInput] = useState('')
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<Kind>('all')
  const [category, setCategory] = useState<string | null>(null)
  const [listing, setListing] = useState<Listing | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [more, setMore] = useState<'idle' | 'loading' | 'error'>('idle')
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState<CatalogGroup | null>(null)
  // Each request takes a ticket; only the newest one may publish.
  const ticket = useRef(0)

  useEffect(() => {
    const timer = setTimeout(() => { setQ(input.trim()) }, DEBOUNCE_MS)
    return () => { clearTimeout(timer) }
  }, [input])

  useEffect(() => {
    const mine = ++ticket.current
    setStatus('loading')
    setMore('idle')
    const query: CatalogBrowseQuery = { q, kind, category, page: 0 }
    browse(query).then((page) => {
      if (mine !== ticket.current) return
      setListing({ query, groups: page.groups, last: page })
      setStatus('ready')
    }, () => {
      if (mine === ticket.current) setStatus('error')
    })
  }, [browse, q, kind, category, attempt])

  const showMore = (): void => {
    if (listing === null) return
    const mine = ++ticket.current
    setMore('loading')
    browse({ q, kind, category, page: listing.last.page + 1 }).then((page) => {
      if (mine !== ticket.current) return
      setListing({ query: listing.query, groups: [...listing.groups, ...page.groups], last: page })
      setMore('idle')
    }, () => {
      if (mine === ticket.current) setMore('error')
    })
  }

  const counts = listing?.last
  const kindLabel = (label: string, count: number | undefined): string =>
    count === undefined ? label : t('kindCount', { label, count: count.toLocaleString() })
  const kindOptions = [
    { value: 'all' as const, label: kindLabel(t('kindAll'), counts === undefined ? undefined : counts.kinds.app + counts.kinds.skill) },
    { value: 'app' as const, label: kindLabel(t('kindApps'), counts?.kinds.app) },
    { value: 'skill' as const, label: kindLabel(t('kindSkills'), counts?.kinds.skill) },
  ]
  const chips = CATEGORIES.filter(key => key === category || counts === undefined || (counts.categories[key] ?? 0) > 0)
  const groups = status === 'ready' ? listing?.groups ?? [] : []
  const hasMore = status === 'ready' && listing !== null && (listing.last.page + 1) * listing.last.pageSize < listing.last.total

  return (
    <div className={css.page}>
      <header className={css.head} data-window-drag>
        <h1 className={css.title}>{t('discoverTitle')}</h1>
        <p className={css.lead}>{t('discoverLead')}</p>
      </header>
      <div className={css.controls}>
        <Input className={css.search ?? ''} icon={<IconSearchOutlineRegular size={16} />} type="search" value={input}
          placeholder={t('searchPlaceholder')} aria-label={t('searchLabel')}
          onChange={(event) => { setInput(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              const next = input.trim()
              if (next === q) setAttempt(value => value + 1)
              else setQ(next)
            }
          }} />
        <SegmentedControl id="ahel-discover-kind" className={css.kinds} value={kind} options={kindOptions}
          label={t('kindLabel')} onChange={setKind} />
      </div>
      <div className={css.chips} role="group" aria-label={t('categoriesLabel')}>
        {chips.map(key => (
          <Pill key={key} active={key === category} aria-pressed={key === category}
            onClick={() => { setCategory(current => current === key ? null : key) }}>
            {t(`category.${key}`)}
          </Pill>
        ))}
      </div>
      <div id={`ahel-discover-kind-${kind}-panel`} role="tabpanel" aria-labelledby={`ahel-discover-kind-${kind}`}
        aria-busy={status === 'loading'}>
        {status === 'loading' && (
          <ul className={css.list} aria-hidden="true">
            {Array.from({ length: SKELETON_ROWS }, (_, index) => (
              <li key={index} className={css.row}>
                <div className={css.rowBody}>
                  <span className={`${css.tile} ${css['tile-md']} ${css.skeletonFill}`} />
                  <span className={css.rowText}>
                    <span className={`${css.skeletonBar} ${css.skeletonName} ${css.skeletonFill}`} />
                    <span className={`${css.skeletonBar} ${css.skeletonLine} ${css.skeletonFill}`} />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
        {status === 'error' && (
          <div className={css.state} role="alert">
            <p className={css.stateText}>{t('browseFailed')}</p>
            <Button variant="outline" size="sm" onClick={() => { setAttempt(value => value + 1) }}>{t('retry')}</Button>
          </div>
        )}
        {status === 'ready' && groups.length === 0 && (
          <div className={css.state}>
            <p className={css.stateTitle}>{t('nothingMatches')}</p>
            <Button variant="outline" size="sm" onClick={() => { openLink(`${ASK_URL}?q=${encodeURIComponent(q)}`) }}>
              {t('askForApp')}
            </Button>
          </div>
        )}
        {groups.length > 0 && (
          <ul className={css.list}>
            {groups.map(group => (
              <AppRow key={group.key} row={group.row} installed={installed} signedIn={signedIn}
                onOpen={() => { setSelected(group) }}
                install={props.install} setEnabled={props.setEnabled} signIn={props.signIn} openLink={openLink} t={t} />
            ))}
          </ul>
        )}
        {more === 'error' && (
          <div className={css.notice} role="alert">
            <span>{t('browseFailed')}</span>
            <Button variant="ghost" size="sm" onClick={showMore}>{t('retry')}</Button>
          </div>
        )}
        {hasMore && more !== 'error' && (
          <div className={css.more}>
            <Button variant="outline" size="sm" disabled={more === 'loading'} onClick={showMore}>{t('showMore')}</Button>
          </div>
        )}
      </div>
      {selected !== null && listing !== null && (
        <DetailDrawer key={selected.row.id} group={selected} query={listing.query} installed={installed} signedIn={signedIn}
          onSelect={setSelected} onClose={() => { setSelected(null) }} browsePart={props.browsePart} install={props.install}
          setEnabled={props.setEnabled} signIn={props.signIn} openLink={openLink} t={t} />
      )}
    </div>
  )
}
