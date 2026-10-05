/** Client-safe Ahel account state; no token, verifier or code crosses this projection. */
import type {} from '@ahel/cordis'
import type { Branded } from '@ahel/dsh-brand'

/** Identity of one local sign-in attempt. */
export type AhelSignInAttemptId = Branded<'AhelSignInAttemptId'>

/**
 * Safe failure codes rendered through the caller's locale dictionary.
 * `denied`: declined in the browser or refused by ahel.ai; `timeout`: no browser callback in time;
 * `network`: ahel.ai unreachable or answered an error; `protocol`: an unexpected response or callback;
 * `storage`: the credential could not be written; `cancelled`: the attempt was cancelled locally.
 */
export type AhelSignInErrorCode = 'denied' | 'timeout' | 'network' | 'protocol' | 'storage' | 'cancelled'

/** Latest sign-in attempt, including its terminal outcome until the next attempt. */
export interface AhelSignInAttemptView {
  readonly id: AhelSignInAttemptId
  readonly phase: 'starting' | 'waiting-browser' | 'exchanging' | 'succeeded' | 'cancelled' | 'failed'
  /** The ahel.ai authorize URL; present from `waiting-browser` on. Safe to show: it carries no secret. */
  readonly authorizeUrl?: string
  readonly errorCode?: AhelSignInErrorCode
}

/** One workspace membership of the signed-in person. */
export interface AhelWorkspace {
  readonly id: string
  readonly name: string
  readonly slug: string
  readonly role: string
}

/** Display identity from `GET /api/mcp/profile`. */
export interface AhelProfile {
  readonly email: string
  readonly name: string | null
  readonly workspaces: readonly AhelWorkspace[]
}

/** Stored-account presence plus the latest attempt; presence is not a claim that ahel.ai still accepts the grant. */
export interface AhelAccountView {
  readonly status: 'signed-out' | 'signed-in'
  /** Profile captured at sign-in; null while signed out. */
  readonly profile: AhelProfile | null
  readonly attempt: AhelSignInAttemptView | null
  /** Selected workspace id (one of `profile.workspaces`); null leaves the choice to ahel.ai. */
  readonly workspace: string | null
  /** Whether ahel.ai answered the latest reachability read. */
  readonly reachable: boolean
}

declare module '@ahel/cordis' {
  interface Events {
    /**
     * The account view changed: a sign-in step, a completed sign-in or sign-out, or an external edit of the stored grant.
     * @param view - the new complete view.
     * @mode emit
     */
    'ahel-account/changed'(view: AhelAccountView): void
  }
}
