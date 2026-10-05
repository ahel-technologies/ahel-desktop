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
    case 'failed':
      if (state.errorCode === 'denied') return m.welcomeSignInDenied
      if (state.errorCode === 'timeout') return m.welcomeSignInTimeout
      if (state.errorCode === 'network') return m.welcomeSignInNetwork
      return m.welcomeSignInFailed
    case 'idle':
    case 'cancelled': return null
  }
}

/**
 * Render the welcome: sign in with the ahel.ai account, or continue with an own key.
 * @param props.api - isolated preload API; no credentials reach the renderer.
 * @returns the welcome page with fixed bottom actions.
 */
export function Welcome({ api }: { api: WelcomeApi }) {
  const { messages: m } = api
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
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

  async function enter() {
    if (busy) return
    setBusy(true)
    setFailed(false)
    try {
      await api.continue()
    } catch {
      if (mounted.current) setFailed(true)
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  async function startSignIn() {
    setSignIn({ phase: 'waiting-browser' })
    try {
      await api.signIn()
    } catch {
      if (mounted.current) setSignIn({ phase: 'failed', errorCode: 'network' })
    }
  }

  const pending = signIn.phase === 'waiting-browser' || signIn.phase === 'exchanging' || signIn.phase === 'succeeded'
  const status = signInStatus(m, signIn)

  return <>
    <div className="titlebar" aria-hidden="true" />
    <main className="welcome" aria-labelledby="welcome-heading">
      <img className="brand" src="assets/welcome-brand.svg" alt={m.welcomeBrand} width="472" height="40" />
      <div id="tagline" className="tagline">
        <h1 id="welcome-heading"><span>{m.welcomeTaglineBefore}</span><em>{m.welcomeTaglineBrand}</em><span>{m.welcomeTaglineAfter}</span></h1>
        <p id="welcome-description">{m.welcomeDescription}</p>
        <p id="sign-in-status" className={signIn.phase === 'failed' ? 'key-error' : 'status'} role="status" hidden={status === null}>{status}</p>
        <p id="continue-error" className="key-error" role="alert" hidden={!failed}>{m.welcomeContinueFailed}</p>
      </div>
      <div id="entry-actions" className="actions">
        {pending
          ? <button id="sign-in-cancel" className="primary" type="button" disabled={signIn.phase !== 'waiting-browser'}
            onClick={() => { void api.cancelSignIn() }}>{m.welcomeSignInCancel}</button>
          : <button ref={signInButton} id="sign-in" className="primary" type="button" disabled={busy} aria-describedby="welcome-description"
            onClick={() => { void startSignIn() }}>{m.welcomeSignIn}</button>}
        <button id="continue" className="secondary" type="button" disabled={busy || pending}
          onClick={() => { void enter() }}>{m.welcomeContinue}</button>
      </div>
    </main>
  </>
}
