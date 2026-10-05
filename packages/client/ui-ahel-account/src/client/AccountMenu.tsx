/** Sidebar footer entry for the ahel.ai account: identity, workspace choice, ahel.ai pages, sign-in and sign-out. */
import { useEffect, useRef, useState } from 'react'
import { AhelTile } from '@ahel/dsh-client-ui-primitives'
import type { AccountMenuProps } from './contract.ts'
import type { CatalogPanelId } from './catalog/contract.ts'
import type { AhelAccountKey } from './locales.ts'
import css from './AhelAccount.module.css'

/** Menu links: in-app panels open in the main area, ahel.ai pages in the system browser. */
const LINKS: readonly ({ key: AhelAccountKey; panel: CatalogPanelId } | { key: AhelAccountKey; url: string })[] = [
  { key: 'discover', panel: 'ahel-discover' },
  { key: 'appsTitle', panel: 'ahel-apps' },
  { key: 'studio', url: 'https://ahel.ai/app/studio' },
  { key: 'vault', url: 'https://ahel.ai/app/vault' },
  { key: 'openAhel', url: 'https://ahel.ai/app' },
]

/**
 * Carry the selected workspace to an ahel.ai page.
 * @param url - page URL.
 * @param workspace - selected workspace id, if any.
 * @returns the URL to open.
 */
function pageUrl(url: string, workspace: string | null): string {
  if (workspace === null) return url
  const next = new URL(url)
  next.searchParams.set('workspace', workspace)
  return next.href
}

/**
 * Render the account entry above Settings and its menu.
 * @param props - composed slot props.
 * @returns the entry.
 */
export function AccountMenu({ wide, signIn, signOut, selectWorkspace, openLink, openPanel, useAccount, t }: AccountMenuProps) {
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
  const workspace = view?.workspace ?? null
  const label = profile?.name ?? profile?.email ?? (signedIn ? t('account') : t('signIn'))
  const waiting = view?.attempt?.phase === 'waiting-browser' || view?.attempt?.phase === 'exchanging'
  const run = (action: () => Promise<void>, close = true): void => {
    setBusy(true)
    void action().catch(() => undefined).finally(() => { setBusy(false); if (close) setOpen(false) })
  }

  return (
    <div ref={root} className={css.entry}>
      {view?.reachable === false && (
        // Clears itself: the Host re-reads ahel.ai every few seconds and the view follows.
        <div className={css.offline} role="status" title={t('offline')}>
          <span className={css.offlineDot} aria-hidden="true" />
          {wide && <span className={css.offlineText}>{t('offline')}</span>}
        </div>
      )}
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
            {view?.attempt?.phase === 'failed' && <div className={css.caption}>{t('failed')}</div>}
          </div>
          {profile !== null && profile.workspaces.length > 0 && (
            <div className={css.section} role="group" aria-label={t('workspace')}>
              <div className={css.sectionLabel}>{t('workspace')}</div>
              {profile.workspaces.map(item => (
                <button key={item.id} type="button" role="menuitemradio" aria-checked={item.id === workspace}
                  className={`${css.item} ${css.choice}`} disabled={busy}
                  onClick={() => { if (item.id !== workspace) run(() => selectWorkspace(item.id), false) }}>
                  <span className={css.choiceName}>{item.name}</span>
                  {item.id === workspace && <span className={css.check} aria-hidden="true">✓</span>}
                </button>
              ))}
              {workspace === null && <div className={css.hint}>{t('workspaceDefault')}</div>}
            </div>
          )}
          {LINKS.map(link => (
            <button key={link.key} type="button" role="menuitem" className={css.item}
              onClick={() => {
                if ('panel' in link) openPanel(link.panel)
                else openLink(pageUrl(link.url, workspace))
                setOpen(false)
              }}>
              {t(link.key)}
            </button>
          ))}
          {signedIn
            ? <button type="button" role="menuitem" className={`${css.item} ${css.separated}`} disabled={busy} onClick={() => { run(signOut) }}>
              {busy ? t('signingOut') : t('signOut')}
            </button>
            : <button type="button" role="menuitem" className={`${css.item} ${css.separated}`} disabled={busy || waiting} onClick={() => { run(signIn) }}>
              {waiting ? t('signingIn') : t('signIn')}
            </button>}
        </div>
      )}
    </div>
  )
}
