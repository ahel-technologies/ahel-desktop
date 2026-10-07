/**
 * The chat column at the Conversation's trailing edge, shown only while the
 * main panel is the chat: the seat the rail draws New chat and the Chats list
 * into, then "Waiting on you" with the open approvals and the issue runs this
 * person asked for that wait for their answer or approval.
 */
import type { ReactNode } from 'react'
import type { ApprovalRow, Issue } from '@ahel/dsh-ahel-account/types'
import type { HostedAsideProps } from './contract.ts'
import css from './Aside.module.css'

/** Main panel id of the Approvals page that ui-ahel-account registers for owners and team leads. */
export const APPROVALS_PANEL = 'ahel-approvals'

const NO_APPROVALS: readonly ApprovalRow[] = []

/**
 * Render the chat column.
 * @param props - composed slot props.
 * @returns the column; hidden away from the chat, so the Chats list keeps its state.
 */
export function HostedAside({
  usePanelInfo, useSummary, useWaitingIssues, setChatSeat, selectPanel, openIssue, t,
}: HostedAsideProps): ReactNode {
  const onChat = usePanelInfo(info => info.activePanelId === null)
  const approvals = useSummary(state => state.summary?.approvals?.rows ?? NO_APPROVALS)
  const issues = useWaitingIssues(rows => rows)
  return (
    <aside className={css.aside} hidden={!onChat} aria-label={t('chatsLabel')}>
      <div ref={setChatSeat} className={css.seat} />
      {(approvals.length > 0 || issues.length > 0) && (
        <section className={css.waiting} aria-label={t('waiting')}>
          <div className={css.heading}>{t('waiting')}</div>
          <ul className={css.list}>
            {approvals.map(row => (
              <li key={`approval:${row.id}`}>
                <button type="button" className={css.item} onClick={() => { selectPanel(APPROVALS_PANEL) }}>
                  <span className={css.title}>{t('waitingApproval', { what: row.what })}</span>
                  {row.requester !== null && (
                    <span className={css.caption}>{t('waitingApprovalFrom', { requester: row.requester.name ?? row.requester.email })}</span>
                  )}
                </button>
              </li>
            ))}
            {issues.map((issue: Issue) => (
              <li key={`issue:${issue.key}`}>
                <button type="button" className={css.item} onClick={() => { openIssue(issue.key) }}>
                  <span className={css.title}><span className={css.key}>{issue.key}</span> {issue.title}</span>
                  <span className={css.caption}>{t(issue.run?.state === 'waiting_approval' ? 'waitingRunApproval' : 'waitingInput')}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  )
}
