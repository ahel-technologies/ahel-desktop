/** Desktop welcome presentation; the preload owns every native operation. */
import { useEffect, useRef, useState } from 'react'
import type { WelcomeApi, WelcomeSignInState } from '../welcome-api.ts'

type Messages = WelcomeApi['messages']

/** Status line for one sign-in state, or null when nothing is shown. */
function signInStatus(m: Messages, state: WelcomeSignInState): string | null {
  switch (state.phase) {
    case 'waiting-browser': return m.welcomeSignInWaiting
    case 'exchanging':
    case 'succeeded': return m.welcomeSignInExchanging
    case 'failed': return state.errorCode === 'network' ? m.welcomeSignInNetwork : m.welcomeSignInFailed
    case 'cancelled': return m.welcomeSignInFailed
    case 'idle': return null
  }
}

/**
 * Render the welcome: one way in, the ahel.ai sign-in. Own keys are added later in Settings → Models.
 * @param props.api - isolated preload API; no credentials reach the renderer.
 * @returns the welcome page with its fixed bottom action.
 */
export function Welcome({ api }: { api: WelcomeApi }) {
  const { messages: m } = api
  const [signIn, setSignIn] = useState<WelcomeSignInState>({ phase: 'idle' })
  const mounted = useRef(true)
  const signInButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    mounted.current = true
    document.documentElement.lang = api.id
    document.title = m.welcomeTitle
    signInButton.current?.focus()
    const stop = api.onSignInState((state) => { if (mounted.current) setSignIn(state) })
    return () => { mounted.current = false; stop() }
  }, [api, m.welcomeTitle])

  async function startSignIn() {
    setSignIn({ phase: 'waiting-browser' })
    try {
      await api.signIn()
    } catch {
      if (mounted.current) setSignIn({ phase: 'failed', errorCode: 'network' })
    }
  }

  const pending = signIn.phase === 'waiting-browser' || signIn.phase === 'exchanging' || signIn.phase === 'succeeded'
  // The opening notice stands until the person starts another sign-in.
  const status = signIn.phase === 'idle' && api.notice === 'session-ended' ? m.welcomeSessionEnded : signInStatus(m, signIn)
  const failed = signIn.phase === 'failed' || signIn.phase === 'cancelled' || (signIn.phase === 'idle' && api.notice !== null)

  return <>
    <div className="titlebar" aria-hidden="true" />
    <main className="welcome" aria-labelledby="welcome-heading">
      <img className="brand" src="assets/welcome-brand.svg" alt={m.welcomeBrand} width="472" height="40" />
      <div id="tagline" className="tagline">
        <h1 id="welcome-heading"><span>{m.welcomeTaglineBefore}</span><em>{m.welcomeTaglineBrand}</em><span>{m.welcomeTaglineAfter}</span></h1>
        <p id="welcome-description">{m.welcomeDescription}</p>
        <p id="sign-in-status" className={failed ? 'key-error' : 'status'} role="status" hidden={status === null}>{status}</p>
      </div>
      <div id="entry-actions" className="actions">
        {pending
          ? <button id="sign-in-cancel" className="primary" type="button" disabled={signIn.phase !== 'waiting-browser'}
            onClick={() => { void api.cancelSignIn() }}>{m.welcomeSignInCancel}</button>
          : <button ref={signInButton} id="sign-in" className="primary" type="button" aria-describedby="welcome-description"
            onClick={() => { void startSignIn() }}>{m.welcomeSignIn}</button>}
      </div>
    </main>
  </>
}
