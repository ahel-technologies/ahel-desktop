/** The Ahel row in Settings > Models, below the bring-your-own-key providers. */
import { AhelTile } from '@ahel/dsh-client-ui-primitives'
import type { ModelsRowProps } from './contract.ts'
import css from './AhelAccount.module.css'

/**
 * Render the Ahel provider row with the account state and its sign-in action.
 * @param props - composed slot props.
 * @returns the row.
 */
export function ModelsRow({ signIn, useAccount, t }: ModelsRowProps) {
  const view = useAccount(value => value)
  const signedIn = view?.status === 'signed-in'
  const waiting = view?.attempt?.phase === 'waiting-browser' || view?.attempt?.phase === 'exchanging'
  return (
    <div className={css.row}>
      <AhelTile size={28} />
      <div className={css.rowText}>
        <div className={css.rowTitle}>{t('modelsTitle')}</div>
        <div className={css.caption}>
          {signedIn ? t('modelsSignedIn', { email: view.profile?.email ?? '' }) : t('modelsSignedOut')}
        </div>
        {signedIn && <div className={css.caption}>{t('modelsHint')}</div>}
      </div>
      {!signedIn && (
        <button type="button" className={css.rowButton} disabled={waiting} onClick={() => { void signIn() }}>
          {waiting ? t('signingIn') : t('signIn')}
        </button>
      )}
    </div>
  )
}
