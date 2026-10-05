/** Sidebar footer entry for the ahel.ai account: identity, workspaces, sign-in and sign-out. */
import { useEffect, useRef, useState } from 'react'
import { AhelTile } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AccountMenuProps } from './contract.ts'
import css from './AhelAccount.module.css'

/**
 * Render the account entry above Settings and its menu.
 * @param props - composed slot props.
 * @returns the entry.
 */
export function AccountMenu({ wide, signIn, signOut, openLink, useAccount, t }: AccountMenuProps) {
  const view = useAccount(value => value)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent): void => {
      if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => { document.removeEventListener('mousedown', close) }
  }, [open])

  const profile = view?.status === 'signed-in' ? view.profile : null
  const signedIn = view?.status === 'signed-in'
  const label = profile?.name ?? profile?.email ?? (signedIn ? t('account') : t('signIn'))
  const waiting = view?.attempt?.phase === 'waiting-browser' || view?.attempt?.phase === 'exchanging'
  const run = (action: () => Promise<void>): void => {
    setBusy(true)
    void action().finally(() => { setBusy(false); setOpen(false) })
  }

  return (
    <div ref={root} className={css.entry}>
      <button type="button" className={`${css.trigger} ${wide ? '' : css.rail}`} aria-haspopup="menu" aria-expanded={open}
        title={label} onClick={() => { setOpen(value => !value) }}>
        {signedIn
          ? <span className={css.avatar} aria-hidden="true">{(profile?.name ?? profile?.email ?? 'A').charAt(0).toUpperCase()}</span>
          : <AhelTile size={wide ? 18 : 20} />}
        {wide && <span className={css.label}>{label}</span>}
      </button>
      {open && (
        <div className={css.menu} role="menu">
          <div className={css.identity}>
            <div className={css.name}>{signedIn ? (profile?.name ?? profile?.email ?? t('account')) : t('signedOut')}</div>
            {profile !== null && profile.name !== null && <div className={css.caption}>{profile.email}</div>}
            {profile !== null && profile.workspaces.length > 0 && (
              <div className={css.caption}>{t('workspaces')}: {profile.workspaces.map(workspace => workspace.name).join(', ')}</div>
            )}
            {view?.attempt?.phase === 'failed' && <div className={css.caption}>{t('failed')}</div>}
          </div>
          <button type="button" role="menuitem" className={css.item} onClick={() => { openLink('https://ahel.ai/app'); setOpen(false) }}>
            {t('openAhel')}
          </button>
          {signedIn
            ? <button type="button" role="menuitem" className={css.item} disabled={busy} onClick={() => { run(signOut) }}>
              {busy ? t('signingOut') : t('signOut')}
            </button>
            : <button type="button" role="menuitem" className={css.item} disabled={busy || waiting} onClick={() => { run(signIn) }}>
              {waiting ? t('signingIn') : t('signIn')}
            </button>}
        </div>
      )}
    </div>
  )
}
