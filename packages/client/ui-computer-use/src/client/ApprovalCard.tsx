/**
 * Composer takeover for one pending computer-use write: target app and
 * window, element, the exact text or keys, a crop of the target, and
 * Approve / Deny. Approve needs a real pointer click: Enter, Space, a
 * programmatic click or a spoken "yes" do nothing.
 */
import { useEffect, useState, type MouseEvent } from 'react'
import type { ComputerUseCard, ComputerUseCrop } from '@ahel/dsh-computer-use-action-gate/types'
import type { ApprovalCardProps } from './contract.ts'
import { cropLayout } from './view.ts'
import css from './ComputerUse.module.css'

/** The card's loading state: undefined while reading, null when the Host has no card. */
type Loaded = ComputerUseCard | null | undefined

/**
 * Render one pending computer-use approval.
 * @param props - the matched approval, the computer-use face and copy.
 * @returns the card.
 */
export function ComputerUseApprovalCard(props: ApprovalCardProps) {
  const { matched: pending, card: readCard, stop, t } = props
  const [card, setCard] = useState<Loaded>(undefined)
  const [answered, setAnswered] = useState(false)

  useEffect(() => {
    let live = true
    setCard(undefined)
    if (pending.callId === undefined) {
      setCard(null)
      return () => { live = false }
    }
    readCard(pending.callId).then(
      (value) => { if (live) setCard(value) },
      () => { if (live) setCard(null) },
    )
    return () => { live = false }
  }, [pending, readCard])

  const answer = (outcome: 'allowed-once' | 'rejected'): void => {
    if (answered || !pending.answerable) return
    setAnswered(true)
    void pending.answer(outcome).catch(() => { setAnswered(false) })
  }
  const approve = (event: MouseEvent<HTMLButtonElement>): void => {
    // `detail` counts pointer clicks; keyboard and programmatic activation report 0.
    if (event.detail < 1) return
    answer('allowed-once')
  }

  const summary = card?.summary ?? pending.displayReason?.en ?? pending.toolName
  return (
    <div className={css.root}>
      <div className={`${css.tokens} ${css.card}`} data-computer-use-approval={pending.key} aria-busy={answered}
        role="group" aria-label={t('approval.aria')}>
        <div className={css.strip}><span className={css.dot} />{t('approval.strip')}</div>
        <div className={css.body}>
          <p className={css.what}>{summary}</p>
          {card === undefined && <p className={css.note}>{t('approval.loading')}</p>}
          {card === null && <p className={css.note} role="alert">{t('approval.noDetails')}</p>}
          {card != null && <Facts card={card} t={t} />}
          {card?.crop != null && <Crop crop={card.crop} label={t('approval.crop')} />}
          {card != null && (
            <details className={css.args}>
              <summary>{t('approval.details')}</summary>
              <pre>{card.args}</pre>
            </details>
          )}
        </div>
        <div className={css.actions}>
          <button type="button" className={css.stopLink} onClick={() => { void stop() }}>{t('stop')}</button>
          <button type="button" className={`${css.btn} ${css.btnSecondary}`} disabled={answered}
            onClick={() => { answer('rejected') }}>{t('deny')}</button>
          <button type="button" className={`${css.btn} ${css.btnPrimary}`} disabled={answered || card == null}
            title={t('approval.clickOnly')} onClick={approve}>{t('approve')}</button>
        </div>
      </div>
    </div>
  )
}

function Facts({ card, t }: { card: ComputerUseCard; t: ApprovalCardProps['t'] }) {
  return (
    <>
      <dl className={css.facts}>
        {card.app !== null && <><dt>{t('approval.app')}</dt><dd>{card.bundleId === null ? card.app : `${card.app} (${card.bundleId})`}</dd></>}
        {card.window !== null && <><dt>{t('approval.window')}</dt><dd>{card.window}</dd></>}
        {card.element !== null && (
          <><dt>{t('approval.element')}</dt><dd>{card.element.label === null ? card.element.role : `${card.element.role} “${card.element.label}”`}</dd></>
        )}
        {card.point !== null && card.element === null && (
          <><dt>{t('approval.point')}</dt><dd>{`${String(Math.round(card.point.x))}, ${String(Math.round(card.point.y))}`}</dd></>
        )}
        {card.keys !== null && <><dt>{t('approval.keys')}</dt><dd><kbd className={css.keys}>{card.keys}</kbd></dd></>}
      </dl>
      {card.text !== null && (
        <div>
          <div className={css.note}>{t('approval.text')}</div>
          <pre className={css.exact} data-exact-text="">{card.text}</pre>
        </div>
      )}
    </>
  )
}

function Crop({ crop, label }: { crop: ComputerUseCrop; label: string }) {
  const layout = cropLayout(crop)
  return (
    <div className={css.crop} style={{ width: layout.width, height: layout.height }} role="img" aria-label={label}>
      <img src={`data:${crop.mimeType};base64,${crop.data}`} alt="" draggable={false} style={{ transform: layout.transform }} />
    </div>
  )
}
