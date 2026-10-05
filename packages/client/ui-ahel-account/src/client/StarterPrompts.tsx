/** Starter prompts below the blank-session composer once the ahel.ai account is signed in. */
import type { StarterPromptsProps } from './contract.ts'
import type { AhelAccountKey } from './locales.ts'
import css from './AhelAccount.module.css'

const STARTERS: readonly AhelAccountKey[] = ['starterApps', 'starterDiscover', 'starterConnect']

/**
 * Render three chips; a click puts the prompt in the composer without sending it.
 * @param props - composed slot props.
 * @returns the chips, or null while signed out.
 */
export function StarterPrompts({ inputActions, useAccount, t }: StarterPromptsProps) {
  const signedIn = useAccount(view => view?.status === 'signed-in')
  if (!signedIn) return null
  return (
    <div className={css.starters} role="group" aria-label={t('starters')}>
      {STARTERS.map(key => (
        <button key={key} type="button" className={css.starter} onClick={() => { inputActions.setDraft(t(key)) }}>
          {t(key)}
        </button>
      ))}
    </div>
  )
}
