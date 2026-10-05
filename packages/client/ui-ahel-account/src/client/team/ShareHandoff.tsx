/**
 * "Share with teammate": a `sidebar.workspaces.session.menu.item` row that
 * raises the share request, and the `shell.overlay` dialog that answers it.
 * Step one is the handoff text, prefilled from the chat; Review asks ahel.ai
 * for the screened preview and the teammate list, and only Share delivers.
 */
import { useEffect, useRef, useState } from 'react'
import { Button, IconShareOutlineRegular, MenuItemButton, Modal } from '@ahel/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsHooks, PropsLocale, PropsRuntime } from '@ahel/dsh-client-ui-slots'
import type {
  HandoffDraft, HandoffReview, HandoffSections, HandoffSent, HandoffSessionDraft, HandoffShare,
} from '@ahel/dsh-ahel-account/types'
import type {} from '@ahel/dsh-client-ui-workspace/client'
import type {} from '@ahel/dsh-client-ui-layout/client'
import type { InboxLoad } from './contract.ts'
import type {} from '../locales.ts'
import css from './ShareHandoff.module.css'

/** One open request for the dialog; `nonce` starts a fresh draft for each menu press. */
export interface ShareRequest {
  readonly sessionId: string
  /** The row's title, until the chat's own title arrives. */
  readonly displayTitle: string
  readonly nonce: number
}

/** Why a Review or Share did not go through; `refused` carries ahel.ai's own sentence. */
export type ShareFailure = Extract<InboxLoad, { ok: false }>

/** What Review or Share left. */
export type ShareAnswer<T> = { readonly ok: true; readonly value: T } | ShareFailure

/** Face of the menu row and the dialog. */
export interface ShareHandoffInjected {
  /** Open the dialog for one chat. */
  requestShare(sessionId: string, displayTitle: string): void
  /** Close the dialog. */
  settleShare(): void
  /** The chat's title, first message and last reply; empty strings when it could not be read. */
  draft(sessionId: string): Promise<HandoffSessionDraft>
  /** ahel.ai's screened preview and teammate list; stores nothing. */
  prepare(draft: HandoffDraft): Promise<ShareAnswer<HandoffReview>>
  /** Deliver the reviewed handoff; only the Share button calls this. */
  share(share: HandoffShare): Promise<ShareAnswer<HandoffSent>>
  /** Open an ahel.ai page in the browser; ignores anything that is not a web page. */
  openUrl(url: string): void
  hooks: {
    shareRequest: HostObservable<ShareRequest | null>
  }
}

/** Props of the session-row menu entry. */
export type ShareHandoffMenuItemProps =
  PropsRuntime<'sidebar.workspaces.session.menu.item'> & PropsLocale<'ahel-account'> & InjectFace<ShareHandoffInjected>

/** Props of the `shell.overlay` dialog entry. */
export type ShareHandoffDialogProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'ahel-account'>
  & Omit<ShareHandoffInjected, 'hooks'>
  & PropsHooks<ShareHandoffInjected['hooks']>

type Translate = ShareHandoffDialogProps['t']

/** ahel.ai's section limits (`HANDOFF_SECTIONS`). */
const MAX = { title: 120, goal: 4000, changes: 6000, next: 2000, open: 4000 } as const

/**
 * Menu row (order 350, after Fork): open the share dialog for this chat.
 * @param props - the row's session, the menu state and the share face.
 * @returns the row.
 */
export function ShareHandoffMenuItem({ sessionId, displayTitle, useMenuOpenState, requestShare, t }: ShareHandoffMenuItemProps) {
  const [, setMenuOpen] = useMenuOpenState()
  return (
    <MenuItemButton
      icon={<IconShareOutlineRegular />}
      onSelect={() => {
        setMenuOpen(false)
        requestShare(sessionId, displayTitle)
      }}
    >
      {t('shareMenu')}
    </MenuItemButton>
  )
}

/**
 * The `shell.overlay` entry: nothing until a row asks, then one dialog per request.
 * @param props - the request hook and the share face.
 * @returns the dialog, or null.
 */
export function ShareHandoffDialog({ useShareRequest, ...face }: ShareHandoffDialogProps) {
  const request = useShareRequest(pending => pending)
  if (request === null) return null
  return <ShareForm key={request.nonce} request={request} face={face} />
}

/** ahel.ai's seat roles in the words its own pages use; another role shows as ahel.ai sent it. */
function roleLabel(role: string, t: Translate): string {
  switch (role) {
    case 'OWNER': return t('shareRoleOwner')
    case 'ADMIN': return t('shareRoleAdmin')
    case 'MEMBER': return t('shareRoleMember')
    default: return role
  }
}

/** The sentence for a failed Review or Share. */
function failureText(failure: ShareFailure, t: Translate): string {
  if (failure.reason === 'outdated') return t('shareOutdated')
  if (failure.reason === 'signed-out') return t('shareSignedOut')
  return failure.message ?? t('shareFailed')
}

/** One request's dialog; the draft and every answer die with it. */
function ShareForm({ request, face }: {
  request: ShareRequest
  face: Omit<ShareHandoffDialogProps, 'useShareRequest'>
}) {
  const { draft, prepare, share, openUrl, settleShare, t } = face
  const [title, setTitle] = useState(request.displayTitle.slice(0, MAX.title))
  const [goal, setGoal] = useState('')
  const [changes, setChanges] = useState('')
  const [next, setNext] = useState('')
  const [note, setNote] = useState('')
  const [reading, setReading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [review, setReview] = useState<{ draft: HandoffDraft; view: HandoffReview } | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [sent, setSent] = useState<HandoffSent | null>(null)
  // Fields the person already typed in keep their text when the prefill lands.
  const touched = useRef(new Set<string>())

  useEffect(() => {
    let live = true
    void draft(request.sessionId).then((prefill) => {
      if (!live) return
      // The row's title is what the person sees; the chat's own title fills in when the row has none.
      if (!touched.current.has('title') && request.displayTitle.trim() === '' && prefill.title !== '') setTitle(prefill.title)
      if (!touched.current.has('goal')) setGoal(prefill.goal)
      if (!touched.current.has('changes')) setChanges(prefill.changes)
    }).catch(() => undefined).finally(() => { if (live) setReading(false) })
    return () => { live = false }
  }, [draft, request.sessionId, request.displayTitle])

  const edit = (field: string, set: (value: string) => void) => (value: string): void => {
    touched.current.add(field)
    set(value)
    setError(null)
  }

  const ready = title.trim() !== '' && goal.trim() !== '' && next.trim() !== ''

  const startReview = (): void => {
    if (!ready || busy) return
    const sections: HandoffSections = {
      goal: goal.trim(),
      next: next.trim(),
      ...changes.trim() === '' ? {} : { changes: changes.trim() },
      ...note.trim() === '' ? {} : { open: note.trim() },
    }
    const outgoing: HandoffDraft = { title: title.trim(), sections }
    setBusy(true)
    setError(null)
    void prepare(outgoing).then((answer) => {
      if (!answer.ok) { setError(failureText(answer, t)); return }
      setReview({ draft: outgoing, view: answer.value })
      const values = answer.value.recipients.map(row => row.value)
      setPicked(answer.value.selected !== null && values.includes(answer.value.selected) ? answer.value.selected : values[0] ?? null)
    }).finally(() => { setBusy(false) })
  }

  const send = (): void => {
    if (review === null || picked === null || busy) return
    setBusy(true)
    setError(null)
    void share({
      ...review.draft, recipients: [picked], requestKey: review.view.continuation.requestKey,
    }).then((answer) => {
      if (!answer.ok) { setError(failureText(answer, t)); return }
      setSent(answer.value)
    }).finally(() => { setBusy(false) })
  }

  const close = (): void => {
    if (busy && review !== null) return
    settleShare()
  }

  if (sent !== null) {
    const label = review?.view.recipients.find(row => row.value === picked)?.label ?? ''
    const names = sent.recipientNames !== undefined && sent.recipientNames.length > 0 ? sent.recipientNames.join(', ') : label
    return (
      <Modal
        open
        onClose={close}
        closeLabel={t('shareClose')}
        title={t('shareTitle')}
        className={css.dialog ?? ''}
        footer={(
          <>
            <Button variant="outline" onClick={() => { openUrl(sent.url) }}>{t('inboxViewWeb')}</Button>
            <Button variant="primary" data-modal-autofocus onClick={close}>{t('shareDone')}</Button>
          </>
        )}
      >
        <p className={css.sent} role="status">{t('shareSent', { names })}</p>
        {(sent.warnings ?? []).length > 0 && <Warnings warnings={sent.warnings ?? []} />}
      </Modal>
    )
  }

  if (review !== null) {
    const view = review.view
    return (
      <Modal
        open
        onClose={close}
        closeLabel={t('shareClose')}
        title={t('shareTitle')}
        className={css.dialog ?? ''}
        contentClassName={css.scroll ?? ''}
        footer={(
          <>
            <Button variant="outline" disabled={busy} onClick={() => { setReview(null); setError(null) }}>{t('shareBack')}</Button>
            {!view.noTeammates && (
              <Button variant="primary" disabled={busy || picked === null} onClick={send}>
                {busy ? t('shareSending') : t('shareSend')}
              </Button>
            )}
          </>
        )}
      >
        <p className={css.reviewTitle}>{review.draft.title}</p>
        {view.noTeammates
          ? (
            <div className={css.empty}>
              <p className={css.hint}>{t('shareNoTeammates')}</p>
              <Button variant="outline" size="sm" onClick={() => { openUrl(view.inviteUrl) }}>{t('shareInvite')}</Button>
            </div>
          )
          : (
            <fieldset className={css.picker} disabled={busy}>
              <legend className={css.label}>{t('shareTo')}</legend>
              {view.recipients.map(row => (
                <label key={row.value} className={css.recipient}>
                  <input
                    type="radio"
                    name="ahel-share-recipient"
                    value={row.value}
                    checked={picked === row.value}
                    onChange={() => { setPicked(row.value); setError(null) }}
                  />
                  <span className={css.recipientName}>{row.label}</span>
                  {row.role !== '' && <span className={css.recipientRole}>{roleLabel(row.role, t)}</span>}
                </label>
              ))}
            </fieldset>
          )}
        {view.warnings.length > 0 && <Warnings warnings={view.warnings} />}
        {error !== null && <p className={css.error} role="alert">{error}</p>}
        {!view.noTeammates && <p className={css.footnote}>{t('shareFootnote')}</p>}
      </Modal>
    )
  }

  return (
    <Modal
      open
      onClose={close}
      closeLabel={t('shareClose')}
      title={t('shareTitle')}
      description={t('shareLead')}
      className={css.dialog ?? ''}
      contentClassName={css.scroll ?? ''}
      footer={(
        <>
          <Button variant="outline" disabled={busy} onClick={close}>{t('shareCancel')}</Button>
          <Button variant="primary" disabled={!ready || busy} onClick={startReview}>
            {busy ? t('shareReviewing') : t('shareReview')}
          </Button>
        </>
      )}
    >
      <div className={css.form}>
        <Field label={t('shareFieldTitle')} value={title} max={MAX.title} disabled={busy} onChange={edit('title', setTitle)} autofocus single />
        <Field label={t('shareFieldGoal')} value={goal} max={MAX.goal} disabled={busy} onChange={edit('goal', setGoal)} rows={3} />
        <Field
          label={t('shareFieldChanges')}
          optional={t('shareOptional')}
          value={changes}
          max={MAX.changes}
          disabled={busy}
          onChange={edit('changes', setChanges)}
          rows={4}
        />
        <Field label={t('shareFieldNext')} value={next} max={MAX.next} disabled={busy} onChange={edit('next', setNext)} rows={2} />
        <Field label={t('shareFieldNote')} optional={t('shareOptional')} value={note} max={MAX.open} disabled={busy} onChange={edit('note', setNote)} rows={2} />
        {reading && <p className={css.hint} role="status">{t('shareReading')}</p>}
        {error !== null && <p className={css.error} role="alert">{error}</p>}
      </div>
    </Modal>
  )
}

/** One labelled input or text area. */
function Field({ label, optional, value, max, disabled, onChange, rows = 3, single = false, autofocus = false }: {
  label: string
  optional?: string
  value: string
  max: number
  disabled: boolean
  onChange: (value: string) => void
  rows?: number
  single?: boolean
  autofocus?: boolean
}) {
  return (
    <label className={css.field}>
      <span className={css.label}>
        {label}
        {optional !== undefined && <span className={css.optional}>{optional}</span>}
      </span>
      {single
        ? (
          <input
            className={css.input}
            value={value}
            maxLength={max}
            disabled={disabled}
            data-modal-autofocus={autofocus || undefined}
            onChange={(e) => { onChange(e.target.value) }}
          />
        )
        : (
          <textarea
            className={css.textarea}
            value={value}
            maxLength={max}
            rows={rows}
            disabled={disabled}
            data-modal-autofocus={autofocus || undefined}
            onChange={(e) => { onChange(e.target.value) }}
          />
        )}
    </label>
  )
}

/** ahel.ai's redaction and screening notices. */
function Warnings({ warnings }: { warnings: readonly string[] }) {
  return (
    <ul className={css.warnings}>
      {warnings.map(warning => <li key={warning}>{warning}</li>)}
    </ul>
  )
}
