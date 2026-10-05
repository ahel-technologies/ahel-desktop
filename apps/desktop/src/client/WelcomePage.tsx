/** Desktop welcome presentation; the preload owns every native operation. */
import { useEffect, useRef, useState } from 'react'
import type { WelcomeApi } from '../welcome-api.ts'

/**
 * Render the first-launch welcome with localized copy.
 * Continue opens the workspace, where model keys are added in Settings → Models.
 * @param props.api - isolated preload API; no credentials reach the renderer.
 * @returns the welcome page with fixed bottom actions.
 */
export function Welcome({ api }: { api: WelcomeApi }) {
  const { messages: m } = api
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const mounted = useRef(true)
  const continueButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    mounted.current = true
    document.documentElement.lang = api.id
    document.title = m.welcomeTitle
    continueButton.current?.focus()
    return () => { mounted.current = false }
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

  return <>
    <div className="titlebar" aria-hidden="true" />
    <main className="welcome" aria-labelledby="welcome-heading">
      <img className="brand" src="assets/welcome-brand.svg" alt={m.welcomeBrand} width="472" height="40" />
      <div id="tagline" className="tagline">
        <h1 id="welcome-heading"><span>{m.welcomeTaglineBefore}</span><em>{m.welcomeTaglineBrand}</em><span>{m.welcomeTaglineAfter}</span></h1>
        <p id="welcome-description">{m.welcomeDescription}</p>
        <p id="continue-error" className="key-error" role="alert" hidden={!failed}>{m.welcomeContinueFailed}</p>
      </div>
      <div id="entry-actions" className="actions">
        <button ref={continueButton} id="continue" className="primary" type="button" disabled={busy} aria-describedby="welcome-description"
          onClick={() => { void enter() }}>{m.welcomeContinue}</button>
        {/* TODO(phase2): wire Sign in with Ahel to the ahel.ai OAuth account flow. */}
        <button id="sign-in" className="secondary" type="button" disabled>{m.welcomeSignIn}</button>
      </div>
    </main>
  </>
}
