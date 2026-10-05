/**
 * The Discover panel in ahel.ai's own layout: the section strip (Discover,
 * then Apps, MCP servers, Skills, Knowledge and Packs, as ahel.ai's
 * ConceptCrumbs), the Discover hero or a section's header, then the rail,
 * the kind and sort controls, the status line and the rows of ahel.ai's
 * public listing. The Knowledge section adds the four products when
 * ahel.ai serves them.
 */
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { IconSearchOutlineRegular } from '@ahel/dsh-client-ui-primitives'
import type {
  CatalogBrowsePage, CatalogBrowseQuery, CatalogConcept, CatalogGroup, CatalogSort, KnowledgeProduct,
} from '@ahel/dsh-ahel-account/types'
import type { DiscoverPageProps } from './contract.ts'
import { AppRow } from './AppRow.tsx'
import { DetailDrawer } from './DetailDrawer.tsx'
import { KnowledgeProducts } from './KnowledgeProducts.tsx'
import css from './Catalog.module.css'

/** ahel.ai's sections in its strip order (`CONCEPTS` in src/lib/catalog/concepts.ts). */
const CONCEPTS: readonly CatalogConcept[] = ['apps', 'mcp-servers', 'skills', 'knowledge', 'packs']

/** ahel.ai's 15 Discover categories, in its rail order. */
const CATEGORIES = [
  'search', 'web', 'data', 'files', 'docs', 'comms', 'cloud', 'monitoring', 'security', 'media', 'commerce',
  'productivity', 'ai-models', 'dev-tools', 'other',
] as const

/** Search waits this long after the last keystroke. */
const DEBOUNCE_MS = 300

/** Skeleton rows shown while a page loads. */
const SKELETON_ROWS = 6

/** Where "Ask for an app" sends the person; ahel.ai's request band. */
const ASK_URL = 'https://ahel.ai/apps#request-app'

type Kind = CatalogBrowseQuery['kind']

/** The listing as loaded so far for one query. */
interface Listing {
  /** The first page's query; nested-skill slices are fetched under it. */
  readonly query: CatalogBrowseQuery
  readonly groups: readonly CatalogGroup[]
  readonly last: CatalogBrowsePage
}

/**
 * A rail or control count as ahel.ai prints it: 980, 9.8k, 44.5k, 131k.
 * @param value - the count.
 * @returns the label, or null for nothing.
 */
function compactCount(value: number | undefined): string | null {
  if (value === undefined || value <= 0 || !Number.isFinite(value)) return null
  if (value < 1000) return String(Math.round(value))
  if (value < 100_000) {
    const tenths = Math.round(value / 100) / 10
    return `${Number.isInteger(tenths) ? tenths.toFixed(0) : tenths.toFixed(1)}k`
  }
  return `${Math.round(value / 1000)}k`
}

/**
 * "11.9k apps · 63.3k skills" in the Everything control.
 * @param kinds - rows per kind.
 * @returns the line, or null when there is neither.
 */
function kindLine(kinds: CatalogBrowsePage['kinds']): string | null {
  const parts: string[] = []
  if (kinds.app > 0) parts.push(`${compactCount(kinds.app)} ${kinds.app === 1 ? 'app' : 'apps'}`)
  if (kinds.skill > 0) parts.push(`${compactCount(kinds.skill)} ${kinds.skill === 1 ? 'skill' : 'skills'}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** ahel.ai's search glyph. */
function SearchIcon() {
  return <IconSearchOutlineRegular size={18} />
}

/**
 * Render the Discover panel.
 * @param props - composed slot props: the catalog face, its hooks and `t`.
 * @returns the page; a result opens in the detail sheet.
 */
export function DiscoverPage(props: DiscoverPageProps) {
  const { browse, knowledgeProducts, openLink, useAccount, useInstalled, t } = props
  const signedIn = useAccount(view => view?.status === 'signed-in')
  const installed = useInstalled(value => value)
  const [concept, setConcept] = useState<CatalogConcept | null>(null)
  const [draft, setDraft] = useState('')
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<Kind>('all')
  const [category, setCategory] = useState<string | null>(null)
  const [official, setOfficial] = useState(false)
  const [free, setFree] = useState(false)
  const [sort, setSort] = useState<CatalogSort | null>(null)
  const [listing, setListing] = useState<Listing | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [more, setMore] = useState<'idle' | 'loading' | 'error'>('idle')
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState<CatalogGroup | null>(null)
  const [products, setProducts] = useState<readonly KnowledgeProduct[] | null>(null)
  // Each request takes a ticket; only the newest one may publish.
  const ticket = useRef(0)

  const searching = q !== ''
  const effectiveSort: CatalogSort = sort === null || (sort === 'best' && !searching) ? (searching ? 'best' : 'added') : sort

  useEffect(() => {
    const timer = setTimeout(() => { setQ(draft.trim()) }, DEBOUNCE_MS)
    return () => { clearTimeout(timer) }
  }, [draft])

  useEffect(() => {
    const mine = ++ticket.current
    setStatus('loading')
    setMore('idle')
    const query: CatalogBrowseQuery = {
      q, kind: concept === null ? kind : 'all', category, page: 0, concept, official, free, ...sort === null ? {} : { sort: effectiveSort },
    }
    browse(query).then((page) => {
      if (mine !== ticket.current) return
      setListing({ query, groups: page.groups, last: page })
      setStatus('ready')
    }, () => {
      if (mine === ticket.current) setStatus('error')
    })
  }, [browse, q, kind, category, concept, official, free, sort, effectiveSort, attempt])

  useEffect(() => {
    if (concept !== 'knowledge' || products !== null) return
    // A missing products route (null) or a failed read leaves the section on its rows.
    knowledgeProducts().then(setProducts, () => undefined)
  }, [concept, knowledgeProducts, products])

  const go = (next: CatalogConcept | null): void => {
    setConcept(next)
    setDraft('')
    setQ('')
    setKind('all')
    setCategory(null)
    setSort(null)
    setSelected(null)
  }

  const showMore = (): void => {
    if (listing === null) return
    const mine = ++ticket.current
    setMore('loading')
    browse({ ...listing.query, page: listing.last.page + 1 }).then((page) => {
      if (mine !== ticket.current) return
      setListing({ query: listing.query, groups: [...listing.groups, ...page.groups], last: page })
      setMore('idle')
    }, () => {
      if (mine === ticket.current) setMore('error')
    })
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const next = draft.trim()
    if (next === q) setAttempt(value => value + 1)
    else setQ(next)
  }

  const page = listing?.last
  const groups = status === 'ready' ? listing?.groups ?? [] : []
  const shown = groups.length
  const total = status === 'ready' ? page?.total ?? 0 : 0
  const remaining = Math.max(0, total - shown)
  const hasDataset = groups.some(group => group.row.facts.some(part => part.key === 'price' && part.source === 'ahel'))
  const productsShown = concept === 'knowledge' && !searching && products !== null && products.length > 0
  const sorts: CatalogSort[] = searching ? ['best', 'added', 'newest'] : ['added', 'name', 'newest']
  const everything = page === undefined ? null : kindLine(page.kinds)

  const searchForm = (hero: boolean) => (
    <form role="search" className={hero ? css.search : `${css.search} ${css.searchSlim}`} onSubmit={submit}>
      <span className={css.searchIcon}><SearchIcon /></span>
      <input className={css.searchInput} type="search" autoComplete="off" maxLength={200} value={draft}
        placeholder={concept === null ? t('searchPlaceholder') : t(`search.${concept}`)}
        aria-label={concept === null ? t('searchLabel') : t(`search.${concept}`)}
        onChange={(event) => { setDraft(event.target.value) }} />
      {draft !== '' && (
        <button type="button" className={css.clear} aria-label={t('clearSearch')} onClick={() => { setDraft(''); setQ('') }}>×</button>
      )}
      <button type="submit" className={`${css.btn} ${css.btnPrimary} ${css.btnSearch}`}>{t('searchGo')}</button>
    </form>
  )

  const statusLine = (() => {
    if (status === 'error') return t('browseFailed')
    if (status !== 'ready' || page === undefined) return null
    if (total <= 0) return t('statusNone')
    const count = total.toLocaleString('en-US')
    if (searching) return <><b>{q}</b>: {t('status.best', { count })}</>
    return t(`status.${effectiveSort}`, { count })
  })()

  return (
    <div className={`${css.tokens} ${css.page}`}>
      <div className={css.top} data-window-drag>
        <div className={css.wrap}>
          <nav aria-label={t('sectionsLabel')}>
            <ul className={css.crumbs}>
              <li>
                <button type="button" className={css.crumb} aria-current={concept === null ? 'page' : undefined}
                  onClick={() => { go(null) }}>{t('discover')}</button>
              </li>
              {CONCEPTS.map(key => (
                <li key={key}>
                  <button type="button" className={css.crumb} aria-current={concept === key ? 'page' : undefined}
                    onClick={() => { go(key) }}>{t(`concept.${key}`)}</button>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>

      {concept === null
        ? (
          <section className={css.wrap}>
            <div className={css.hero}>
              <p className={css.eyebrow}>{t('heroEyebrow')}</p>
              <h1 className={css.h1}>{t('heroTitle')}<span className={css.stop}>.</span></h1>
              <p className={css.lead}>{t('heroLead')}</p>
              {searchForm(true)}
            </div>
          </section>
        )
        : (
          <section className={`${css.wrap} ${css.conceptHead}`}>
            <h1 className={css.h1}>{t(`concept.${concept}`)}<span className={css.stop}>.</span></h1>
            <p className={css.lead}>{t(`blurb.${concept}`)}</p>
            {t(`intro.${concept}`) !== '' && (
              <div className={css.intro}>
                <p>{t(`intro.${concept}`)}</p>
                <p>{t(`intro2.${concept}`)}</p>
              </div>
            )}
            <div style={{ marginTop: 22 }}>{searchForm(false)}</div>
          </section>
        )}

      <section className={css.results} data-searching={searching ? 'true' : undefined} aria-busy={status === 'loading'}>
        <div className={`${css.wrap} ${css.layout}`}>
          <aside className={css.rail} aria-label={t('railShow')}>
            <div className={css.railGroup}>
              <h2 className={css.railHead}>{t('railShow')}</h2>
              <label className={css.railOption}>
                <input type="checkbox" checked={official} onChange={(event) => { setOfficial(event.target.checked) }} />
                {t('officialOnly')}
              </label>
              <label className={css.railOption}>
                <input type="checkbox" checked={free} onChange={(event) => { setFree(event.target.checked) }} />
                {t('freeToUse')}
              </label>
            </div>
            <div className={css.railGroup} role="radiogroup" aria-label={t('railCategory')}>
              <h2 className={css.railHead}>{t('railCategory')}</h2>
              <label className={css.railOption} data-on={category === null ? 'true' : undefined}>
                <input type="radio" name="ahel-discover-category" checked={category === null} onChange={() => { setCategory(null) }} />
                {t('allCategories')}
              </label>
              {CATEGORIES.map((key) => {
                const count = compactCount(page?.categories[key])
                return (
                  <label key={key} className={css.railOption} data-on={category === key ? 'true' : undefined}>
                    <input type="radio" name="ahel-discover-category" checked={category === key} onChange={() => { setCategory(key) }} />
                    {t(`category.${key}`)}
                    {count !== null && <span className={css.n}>{count}</span>}
                  </label>
                )
              })}
            </div>
            <p className={css.note}>{t('railNote')}</p>
          </aside>

          <div className={css.main}>
            <div className={css.controls}>
              {concept === null
                ? (
                  <div className={css.seg} role="group" aria-label={t('kindLabel')}>
                    <button type="button" aria-pressed={kind === 'all'} onClick={() => { setKind('all') }}>
                      {t('kindEverything')}
                      {everything !== null && <span className={css.segCount}>{everything}</span>}
                    </button>
                    <button type="button" aria-pressed={kind === 'app'} onClick={() => { setKind('app') }}>
                      <span className={css.kind}>{t('tagApp')}</span>{t('kindApps')}
                    </button>
                    <button type="button" aria-pressed={kind === 'skill'} onClick={() => { setKind('skill') }}>
                      <span className={`${css.kind} ${css.kindSkill}`}>{t('tagSkill')}</span>{t('kindSkills')}
                    </button>
                  </div>
                )
                : <span />}
              <div className={css.sortWrap}>
                <span className={css.sortLabel}>{t('sortLabel')}</span>
                <div className={css.sort} role="group" aria-label={t('sortLabel')}>
                  {sorts.map(key => (
                    <button key={key} type="button" aria-pressed={effectiveSort === key} onClick={() => { setSort(key) }}>
                      {t(`sort.${key}`)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {productsShown && (
              <KnowledgeProducts products={products} installed={installed} signedIn={signedIn}
                onOpen={(row) => { setSelected({ key: row.id, row, skills: null, copies: 0 }) }}
                install={props.install} setEnabled={props.setEnabled} signIn={props.signIn} openLink={openLink} t={t} />
            )}

            {!productsShown && (
              <>
                <p className={css.status} role="status" aria-live="polite">{statusLine}</p>
                {status === 'loading' && (
                  <ul className={css.list} aria-hidden="true">
                    {Array.from({ length: SKELETON_ROWS }, (_, index) => (
                      <li key={index} className={css.row}>
                        <div className={css.vrow}>
                          <span className={`${css.tile} ${css.skeletonFill}`} />
                          <span>
                            <span className={`${css.skeletonBar} ${css.skeletonName} ${css.skeletonFill}`} />
                            <span className={`${css.skeletonBar} ${css.skeletonLine} ${css.skeletonFill}`} />
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {status === 'error' && (
                  <div className={css.empty} role="alert">
                    <button type="button" className={`${css.btn} ${css.btnSecondary}`} onClick={() => { setAttempt(value => value + 1) }}>{t('retry')}</button>
                  </div>
                )}
                {groups.length > 0 && (
                  <ul className={css.list}>
                    {groups.map(group => (
                      <AppRow key={group.key} row={group.row} installed={installed} signedIn={signedIn} showDescription={searching}
                        onOpen={() => { setSelected(group) }}
                        install={props.install} setEnabled={props.setEnabled} signIn={props.signIn} openLink={openLink} t={t}>
                        {group.skills !== null && group.skills.rows.length > 0 && (
                          <>
                            <p className={css.nestLabel}>{t('nestLabel', { vendor: group.skills.vendorName, count: group.skills.count.toLocaleString('en-US') })}</p>
                            <ul className={css.subRows}>
                              {group.skills.rows.map(skill => (
                                <AppRow key={skill.id} row={skill} nested installed={installed} signedIn={signedIn}
                                  onOpen={(item) => { setSelected({ key: item.id, row: item, skills: null, copies: 0 }) }}
                                  install={props.install} setEnabled={props.setEnabled} signIn={props.signIn} openLink={openLink} t={t} />
                              ))}
                            </ul>
                          </>
                        )}
                      </AppRow>
                    ))}
                  </ul>
                )}
                {searching && groups.length > 0 && <p className={css.note}>{t(hasDataset ? 'datasetNote' : 'officialNote')}</p>}
                {more === 'error' && <p className={`${css.note} ${css.error}`} role="alert">{t('browseFailed')}</p>}
                {status === 'ready' && remaining > 0 && (
                  <div className={css.more}>
                    <span>{t('shownOf', { shown: shown.toLocaleString('en-US'), total: total.toLocaleString('en-US') })}</span>
                    <button type="button" className={`${css.btn} ${css.btnSecondary}`} disabled={more === 'loading'} onClick={showMore}>
                      {t('showMoreCount', { count: Math.min(remaining, page?.pageSize ?? 24) })}
                    </button>
                  </div>
                )}
              </>
            )}
            <div className={css.ask}>
              <span>
                {searching && status === 'ready' && remaining === 0
                  ? <><b>{t('askEnd')}</b> {t('askEndText')}</>
                  : <><b>{t('askNotHere')}</b> {t('askNotHereText')}</>}
              </span>
              <button type="button" className={`${css.btn} ${css.btnSecondary}`} onClick={() => { openLink(ASK_URL) }}>{t('askForApp')}</button>
            </div>
          </div>
        </div>
      </section>
      {selected !== null && listing !== null && (
        <DetailDrawer key={selected.row.id} group={selected} query={listing.query} installed={installed} signedIn={signedIn}
          onSelect={setSelected} onClose={() => { setSelected(null) }} browsePart={props.browsePart} install={props.install}
          setEnabled={props.setEnabled} signIn={props.signIn} openLink={openLink} t={t} />
      )}
    </div>
  )
}
