/** The Approvals main panel: held calls waiting for an owner or team lead, each answered in place. */
import { useEffect, useState } from 'react'
import type { ApprovalRow } from '@ahel/dsh-ahel-account/types'
import type { ApprovalsInjected, ApprovalsPageProps } from './contract.ts'
import type { AhelAccountKey } from '../locales.ts'
import catalog from '../catalog/Catalog.module.css'
import css from './Team.module.css'

/** Age and countdown labels re-render this often. */
const TICK_MS = 30_000

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

/** The `t` seat of this package's panels. */
type Translate = ApprovalsPageProps['t']

/** What answering a row left on screen. */
interface Answered {
  readonly row: ApprovalRow
  /** `refused` is final; `failed` keeps Approve and Decline for a retry. */
  readonly tone: 'approved' | 'declined' | 'refused' | 'failed'
  readonly text: string
}

/**
 * A duration in whole minutes under an hour, else whole hours.
 * @param ms - positive span.
 * @param t - dictionary.
 * @returns `5 min` or `23 h`.
 */
function span(ms: number, t: Translate): string {
  if (ms < HOUR_MS) return t('approvalMinutes', { n: String(Math.max(1, Math.floor(ms / MINUTE_MS))) })
  return t('approvalHours', { n: String(Math.floor(ms / HOUR_MS)) })
}

/**
 * The args as indented JSON.
 * @param args - the exact arguments the requester's AI sent.
 * @returns the pretty text, or null without arguments.
 */
function prettyArgs(args: ApprovalRow['args']): string | null {
  if (args === null || Object.keys(args).length === 0) return null
  return JSON.stringify(args, null, 2)
}

/**
 * One held call with its note and Approve / Decline, or the answer it got.
 * @param props - the row, its answer, the face's `decide` and the dictionary.
 * @returns the list item.
 */
function ApprovalItem({ row, answered, now, decide, onAnswered, t }: {
  row: ApprovalRow
  answered: Answered | undefined
  now: number
  decide: ApprovalsInjected['decide']
  onAnswered: (answer: Answered) => void
  t: Translate
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const requester = row.requester?.name ?? row.requester?.email ?? t('approvalSomeone')
  const asked = now - Date.parse(row.createdAt)
  const left = Date.parse(row.expiresAt) - now
  const args = prettyArgs(row.args)

  const answer = (decision: 'approved' | 'declined'): void => {
    setBusy(true)
    void decide(row.id, decision, note).then((result) => {
      if (result.ok) {
        const approved = result.status === 'approved'
        onAnswered({ row, tone: approved ? 'approved' : 'declined', text: t(approved ? 'approvalApproved' : 'approvalDeclined') })
      } else {
        onAnswered({
          row, tone: result.final ? 'refused' : 'failed', text: result.outdated ? t('approvalsOutdated') : result.message ?? t('approvalFailed'),
        })
      }
    }).finally(() => { setBusy(false) })
  }

  return (
    <li className={css.row}>
      <p className={css.what}>{row.what}</p>
      <p className={css.meta}>
        <span className={css.who} title={row.requester?.email}>{requester}</span>
        <span className={css.rule}>{row.guardrailName}</span>
        <span>{asked < MINUTE_MS ? t('approvalAskedNow') : t('approvalAsked', { age: span(asked, t) })}</span>
        <span>{left <= 0 ? t('approvalExpired') : t('approvalExpires', { left: span(left, t) })}</span>
      </p>
      {args !== null && (
        <details className={css.args}>
          <summary>{t('approvalArgs')}</summary>
          <pre>{args}</pre>
        </details>
      )}
      {answered !== undefined && answered.tone !== 'failed'
        ? <p className={css.result} data-tone={answered.tone} role="status">{answered.text}</p>
        : (
          <>
            {answered !== undefined && <p className={css.result} data-tone="refused" role="alert">{answered.text}</p>}
            <div className={css.actions}>
              <input className={css.note} type="text" maxLength={500} value={note} disabled={busy}
                placeholder={t('approvalNote')} aria-label={t('approvalNote')}
                onChange={(event) => { setNote(event.target.value) }} />
              <button type="button" className={`${catalog.btn} ${catalog.btnPrimary}`} disabled={busy}
                onClick={() => { answer('approved') }}>{t('approve')}</button>
              <button type="button" className={`${catalog.btn} ${catalog.btnSecondary}`} disabled={busy}
                onClick={() => { answer('declined') }}>{t('decline')}</button>
            </div>
          </>
        )}
    </li>
  )
}

/**
 * Render the Approvals panel.
 * @param props - composed slot props: the Approvals face, its hooks and `t`.
 * @returns the page.
 */
export function ApprovalsPage({ decide, signIn, openWebApprovals, useAccount, useSummary, t }: ApprovalsPageProps) {
  const view = useAccount(value => value)
  const team = useSummary(value => value)
  const [answered, setAnswered] = useState<ReadonlyMap<string, Answered>>(new Map())
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()) }, TICK_MS)
    return () => { clearInterval(timer) }
  }, [])

  const workspace = team.summary?.workspace.id ?? null
  // Answers belong to the workspace they were given in.
  useEffect(() => { setAnswered(new Map()) }, [workspace])

  const signedIn = view?.status === 'signed-in'
  const approvals = team.summary?.approvals ?? null
  const manager = team.summary?.workspace.role === 'OWNER' || team.summary?.workspace.role === 'ADMIN'
  // An answered row leaves the summary on the next read; keep it on screen with its answer.
  const pending = approvals?.rows ?? []
  const rows = [...pending, ...[...answered.values()].map(item => item.row).filter(row => !pending.some(item => item.id === row.id))]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const remember = (answer: Answered): void => {
    setAnswered(previous => new Map(previous).set(answer.row.id, answer))
  }

  const notice = (key: AhelAccountKey, action?: { label: string; run: () => void }) => (
    <div className={catalog.empty}>
      <b>{t(key)}</b>
      {action !== undefined && (
        <button type="button" className={`${catalog.btn} ${catalog.btnSecondary}`} onClick={action.run}>{action.label}</button>
      )}
    </div>
  )
  const web = { label: t('openAhel'), run: openWebApprovals }

  let body
  if (!signedIn) body = notice('approvalsSignedOut', { label: t('signIn'), run: () => { void signIn().catch(() => undefined) } })
  else if (team.outdated) body = notice('approvalsOutdated', web)
  else if (team.summary === null) body = null
  else if (!manager) body = notice('approvalsMember')
  else if (approvals === null) body = notice('approvalsPlan', web)
  else if (rows.length === 0) body = notice('approvalsEmpty')
  else {
    body = (
      <ul className={css.list}>
        {rows.map(row => (
          <ApprovalItem key={row.id} row={row} answered={answered.get(row.id)} now={now} decide={decide} onAnswered={remember} t={t} />
        ))}
      </ul>
    )
  }

  return (
    <div className={`${catalog.tokens} ${catalog.page}`}>
      <div className={catalog.top} data-window-drag />
      <div className={catalog.wrap}>
        <header className={css.head}>
          <h1 className={catalog.h1}>{t('approvals')}<span className={catalog.stop}>.</span></h1>
          <p className={catalog.lead} style={{ marginTop: 14 }}>{t('approvalsLead')}</p>
        </header>
        <div aria-busy={signedIn && team.summary === null && !team.outdated}>{body}</div>
      </div>
    </div>
  )
}
