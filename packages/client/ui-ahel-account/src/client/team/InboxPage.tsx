/** The Inbox main panel: handoffs teammates shared with you, each opened into a new session, and the ones you sent. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { HandoffList, HandoffReceivedRow, HandoffSentRow, IssueInboxItem } from '@ahel/dsh-ahel-account/types'
import type { InboxInjected, InboxLoad, InboxPageProps } from './contract.ts'
import type { AhelAccountKey } from '../locales.ts'
import { WEB_ISSUES } from './issue-items.ts'
import catalog from '../catalog/Catalog.module.css'
import css from './Team.module.css'

/** Relative times re-render this often. */
const TICK_MS = 30_000

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** The `t` seat of this package's panels. */
type Translate = InboxPageProps['t']

/** A row's in-place result after Open or Mark done failed. */
interface RowNotice {
  readonly text: string
}

/**
 * How long ago, in the largest whole unit.
 * @param iso - the timestamp.
 * @param now - the current time.
 * @param t - dictionary.
 * @returns `just now`, `5 min ago`, `3 h ago` or `2 d ago`.
 */
function ago(iso: string, now: number, t: Translate): string {
  const ms = now - Date.parse(iso)
  if (!Number.isFinite(ms) || ms < MINUTE_MS) return t('inboxJustNow')
  if (ms < HOUR_MS) return t('inboxAgo', { age: t('approvalMinutes', { n: String(Math.floor(ms / MINUTE_MS)) }) })
  if (ms < DAY_MS) return t('inboxAgo', { age: t('approvalHours', { n: String(Math.floor(ms / HOUR_MS)) }) })
  return t('inboxAgo', { age: t('inboxDays', { n: String(Math.floor(ms / DAY_MS)) }) })
}

/**
 * The first line of a next step.
 * @param next - ahel.ai's next-step text.
 * @returns its first non-empty line.
 */
function firstLine(next: string): string {
  return next.split('\n').find(line => line.trim() !== '')?.trim() ?? ''
}

/**
 * One received handoff with Open, Mark done and its ahel.ai page.
 * @param props - the row, the face's actions and the dictionary.
 * @returns the list item.
 */
function ReceivedItem({ row, now, open, markDone, openUrl, reload, t }: {
  row: HandoffReceivedRow
  now: number
  open: InboxInjected['open']
  markDone: InboxInjected['markDone']
  openUrl: InboxInjected['openUrl']
  reload: () => void
  t: Translate
}) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<RowNotice | null>(null)
  const done = row.status === 'done'
  const next = firstLine(row.next)

  const run = (action: () => ReturnType<InboxInjected['open']>): void => {
    setBusy(true)
    setNotice(null)
    void action().then((answer) => {
      if (answer.ok) { reload(); return }
      setNotice({ text: answer.outdated ? t('inboxOutdated') : answer.message ?? t('inboxFailed') })
    }).finally(() => { setBusy(false) })
  }

  return (
    <li className={css.row} data-unread={row.unread || undefined}>
      <p className={css.title}>
        {row.unread && <span className={css.dot} role="img" aria-label={t('inboxUnread')} />}
        <span>{row.title}</span>
        {done && <span className={css.tag}>{t('inboxDone')}</span>}
      </p>
      <p className={css.meta}>
        <span className={css.who}>{t('inboxFrom', { from: row.from })}</span>
        <span>{ago(row.updatedAt, now, t)}</span>
      </p>
      {next !== '' && <p className={css.next}>{next}</p>}
      {notice !== null && <p className={css.result} data-tone="refused" role="alert">{notice.text}</p>}
      <div className={css.actions}>
        <button type="button" className={`${catalog.btn} ${catalog.btnPrimary}`} disabled={busy}
          onClick={() => { run(() => open(row)) }}>{t('inboxOpen')}</button>
        {!done && (
          <button type="button" className={`${catalog.btn} ${catalog.btnSecondary}`} disabled={busy}
            onClick={() => { run(() => markDone(row.id)) }}>{t('inboxMarkDone')}</button>
        )}
        <button type="button" className={`${catalog.btn} ${catalog.btnGhost}`}
          onClick={() => { openUrl(row.url) }}>{t('inboxViewWeb')}</button>
      </div>
    </li>
  )
}

/** The sentence for each kind of issue row. */
const ISSUE_KIND: Record<IssueInboxItem['type'], AhelAccountKey> = {
  assigned: 'inboxIssueAssigned',
  mentioned: 'inboxIssueMentioned',
  run_finished: 'inboxIssueRunFinished',
  run_failed: 'inboxIssueRunFailed',
}

/**
 * One issue row: who did what, Open issue (shows it in the desktop and marks the row read) and its ahel.ai page.
 * @param props - the row, the face's actions and the dictionary.
 * @returns the list item.
 */
function IssueItem({ item, now, openIssue, openUrl, reload, t }: {
  item: IssueInboxItem
  now: number
  openIssue: InboxInjected['openIssue']
  openUrl: InboxInjected['openUrl']
  reload: () => void
  t: Translate
}) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<RowNotice | null>(null)
  const key = item.issueKey
  const body = item.body === null ? '' : firstLine(item.body)
  return (
    <li className={css.row} data-unread={item.unread || undefined}>
      <p className={css.title}>
        {item.unread && <span className={css.dot} role="img" aria-label={t('inboxUnread')} />}
        <span>{key === null ? t('inboxIssueGone') : `${key} · ${item.issueTitle ?? ''}`}</span>
      </p>
      <p className={css.meta}>
        <span className={css.who}>{t(ISSUE_KIND[item.type], { actor: item.actorName })}</span>
        <span>{ago(item.createdAt, now, t)}</span>
      </p>
      {body !== '' && <p className={css.next}>{body}</p>}
      {notice !== null && <p className={css.result} data-tone="refused" role="alert">{notice.text}</p>}
      <div className={css.actions}>
        <button type="button" className={`${catalog.btn} ${catalog.btnPrimary}`} disabled={busy} onClick={() => {
          setBusy(true)
          setNotice(null)
          void openIssue(item).then((answer) => {
            if (answer.ok) { reload(); return }
            setNotice({ text: answer.outdated ? t('inboxOutdated') : answer.message ?? t('inboxFailed') })
          }).finally(() => { setBusy(false) })
        }}>{t('inboxOpenIssue')}</button>
        {key !== null && (
          <button type="button" className={`${catalog.btn} ${catalog.btnGhost}`}
            onClick={() => { openUrl(`${WEB_ISSUES}/${encodeURIComponent(key)}`) }}>{t('inboxViewWeb')}</button>
        )}
      </div>
    </li>
  )
}

/**
 * One handoff this person sent, with whether it was read.
 * @param props - the row, the face's link opener and the dictionary.
 * @returns the list item.
 */
function SentItem({ row, now, openUrl, t }: {
  row: HandoffSentRow
  now: number
  openUrl: InboxInjected['openUrl']
  t: Translate
}) {
  return (
    <li className={css.row}>
      <p className={css.title}>
        <span>{row.title}</span>
        {row.status === 'done' && <span className={css.tag}>{t('inboxDone')}</span>}
      </p>
      <p className={css.meta}>
        <span className={css.who}>{t(row.read ? 'inboxSentRead' : 'inboxSentUnread')}</span>
        <span>{t('inboxSentTo', { n: String(row.recipients) })}</span>
        <span>{ago(row.updatedAt, now, t)}</span>
      </p>
      <div className={css.actions}>
        <button type="button" className={`${catalog.btn} ${catalog.btnGhost}`}
          onClick={() => { openUrl(row.url) }}>{t('inboxViewWeb')}</button>
      </div>
    </li>
  )
}

/**
 * Render the Inbox panel; it reads ahel.ai on open, on window focus and on a workspace change.
 * @param props - composed slot props: the Inbox face, its hooks and `t`.
 * @returns the page.
 */
export function InboxPage({ load, open, openIssue, markDone, openUrl, openWebInbox, signIn, useAccount, t }: InboxPageProps) {
  const view = useAccount(value => value)
  const [answer, setAnswer] = useState<InboxLoad | null>(null)
  const [now, setNow] = useState(() => Date.now())
  // Only the newest read publishes.
  const generation = useRef(0)

  const signedIn = view?.status === 'signed-in'
  const workspace = signedIn ? view.workspace : null

  const reload = useCallback((): void => {
    const mine = ++generation.current
    void load().then((next) => {
      if (mine === generation.current) setAnswer(next)
    }).catch(() => {
      if (mine === generation.current) setAnswer({ ok: false, reason: 'failed', message: null })
    })
  }, [load])

  useEffect(() => {
    if (!signedIn) { generation.current++; setAnswer(null); return }
    // A workspace change never shows the previous workspace's handoffs.
    setAnswer(null)
    reload()
    const onFocus = (): void => { reload() }
    window.addEventListener('focus', onFocus)
    return () => { window.removeEventListener('focus', onFocus) }
  }, [signedIn, workspace, reload])

  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()) }, TICK_MS)
    return () => { clearInterval(timer) }
  }, [])

  const notice = (text: string, action?: { label: string; run: () => void }) => (
    <div className={catalog.empty}>
      <b>{text}</b>
      {action !== undefined && (
        <button type="button" className={`${catalog.btn} ${catalog.btnSecondary}`} onClick={action.run}>{action.label}</button>
      )}
    </div>
  )
  const say = (key: AhelAccountKey, action?: { label: string; run: () => void }) => notice(t(key), action)

  let body
  if (!signedIn) body = say('inboxSignedOut', { label: t('signIn'), run: () => { void signIn().catch(() => undefined) } })
  else if (answer === null) body = null
  else if (!answer.ok) {
    if (answer.reason === 'outdated') body = say('inboxOutdated', { label: t('openAhel'), run: openWebInbox })
    else if (answer.reason === 'signed-out') body = say('inboxSignedOut', { label: t('signIn'), run: () => { void signIn().catch(() => undefined) } })
    else if (answer.reason === 'refused') body = notice(answer.message ?? t('inboxFailed'), { label: t('openAhel'), run: openWebInbox })
    else body = notice(answer.message ?? t('inboxFailed'), { label: t('inboxRetry'), run: reload })
  } else {
    body = (
      <InboxLists list={answer.list} now={now} open={open} openIssue={openIssue} markDone={markDone} openUrl={openUrl}
        reload={reload} t={t} />
    )
  }

  return (
    <div className={`${catalog.tokens} ${catalog.page}`}>
      <div className={catalog.top} data-window-drag />
      <div className={catalog.wrap}>
        <header className={css.head}>
          <h1 className={catalog.h1}>{t('inbox')}<span className={catalog.stop}>.</span></h1>
          <p className={catalog.lead} style={{ marginTop: 14 }}>{t('inboxLead')}</p>
        </header>
        <div aria-busy={signedIn && answer === null}>{body}</div>
      </div>
    </div>
  )
}

/**
 * Received handoffs, then the sent ones collapsed under "You sent".
 * @param props - the list and the row actions.
 * @returns both lists.
 */
function InboxLists({ list, now, open, openIssue, markDone, openUrl, reload, t }: {
  list: HandoffList
  now: number
  open: InboxInjected['open']
  openIssue: InboxInjected['openIssue']
  markDone: InboxInjected['markDone']
  openUrl: InboxInjected['openUrl']
  reload: () => void
  t: Translate
}) {
  // Open work first, then by most recent change.
  const received = [...list.received].sort((a, b) =>
    Number(a.status === 'done') - Number(b.status === 'done') || b.updatedAt.localeCompare(a.updatedAt))
  const sent = [...list.sent].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  // An older ahel.ai sends no `items`; null means it could not read them.
  const items = list.items
  return (
    <>
      {items === null && <p className={css.next}>{t('inboxIssuesUnavailable')}</p>}
      {items !== undefined && items !== null && items.length > 0 && (
        <section aria-label={t('inboxIssues')}>
          <ul className={`${css.list} ${css.listTight}`}>
            {items.map(item => (
              <IssueItem key={item.id} item={item} now={now} openIssue={openIssue} openUrl={openUrl} reload={reload} t={t} />
            ))}
          </ul>
        </section>
      )}
      {received.length === 0
        ? (
          <div className={catalog.empty}>
            <b>{t('inboxEmpty')}</b>
          </div>
        )
        : (
          <ul className={sent.length > 0 ? `${css.list} ${css.listTight}` : css.list}>
            {received.map(row => (
              <ReceivedItem key={row.id} row={row} now={now} open={open} markDone={markDone} openUrl={openUrl} reload={reload} t={t} />
            ))}
          </ul>
        )}
      {sent.length > 0 && (
        <details className={css.sent}>
          <summary>{t('inboxYouSent', { n: String(sent.length) })}</summary>
          <ul className={css.list}>
            {sent.map(row => <SentItem key={row.id} row={row} now={now} openUrl={openUrl} t={t} />)}
          </ul>
        </details>
      )}
    </>
  )
}
