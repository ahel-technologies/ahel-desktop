/** In-place rows for Ahel model refusals, and the claimed frame-wide balance notice. */
import { useEffect } from 'react'
import { StateDot } from '@ahel/dsh-client-ui-primitives'
import type { AhelFailureCode, AhelQuotaNoticeProps, AhelTurnErrorProps } from './contract.ts'
import type { AhelAccountKey } from './locales.ts'
import css from './AhelAccount.module.css'

/** ahel.ai page where the workspace balance is topped up. */
export const BILLING_URL = 'https://ahel.ai/app/settings/billing'

const COPY: Record<AhelFailureCode, AhelAccountKey> = {
  ACCOUNT_QUOTA: 'errorCredits',
  AHEL_NOT_ENABLED: 'errorNotEnabled',
  AHEL_SESSION_ENDED: 'errorSessionEnded',
}

/**
 * Claim the failure codes `dsh-llm-ahel` gives Ahel refusals.
 * @param owner - the failure offered to the turn-error chain.
 * @returns the claimed code, or null to leave the generic row.
 */
export function claimAhelFailure(owner: { code: string | undefined }): AhelFailureCode | null {
  return owner.code !== undefined && owner.code in COPY ? owner.code as AhelFailureCode : null
}

/**
 * One terminal turn failure with its way out: top up, add an own key, or sign in again.
 * @param props - composed slot props; `matched` is the claimed code.
 * @returns the row.
 */
export function AhelTurnError({ matched, openLink, openModels, signIn, t }: AhelTurnErrorProps) {
  return (
    <div className={css.turnError} role="status">
      <StateDot state="error" className={css.turnErrorDot} />
      <div className={css.turnErrorBody}>
        <span className={css.turnErrorText}>{t(COPY[matched])}</span>
        <span className={css.turnErrorActions}>
          {matched === 'AHEL_SESSION_ENDED'
            ? <button type="button" className={css.rowButton} onClick={() => { void signIn().catch(() => undefined) }}>{t('signIn')}</button>
            : <button type="button" className={css.rowButton} onClick={() => { openLink(BILLING_URL) }}>{t('openBilling')}</button>}
          {matched === 'ACCOUNT_QUOTA' && (
            <button type="button" className={css.rowButton} onClick={openModels}>{t('openModels')}</button>
          )}
        </span>
      </div>
    </div>
  )
}

/**
 * The balance refusal already has its in-place row with actions, so the
 * frame-wide notice is taken down instead of repeating it as a toast.
 * @param props - the live notice.
 * @returns nothing.
 */
export function AhelQuotaNotice({ dismiss }: AhelQuotaNoticeProps) {
  useEffect(() => { dismiss() }, [dismiss])
  return null
}
