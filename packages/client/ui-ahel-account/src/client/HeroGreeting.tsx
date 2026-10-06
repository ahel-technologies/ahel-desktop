/** Names the signed-in person in the blank-session greeting headline. */
import type { AhelProfile } from '@ahel/dsh-ahel-account/types'
import type { HeroGreetingProps } from './contract.ts'

/**
 * First name for the greeting: the first word of ahel.ai's current display
 * name (the one the account row shows), else of the name captured at sign-in.
 * @param profile - the signed-in profile, or null.
 * @param live - the display name from the latest team summary, or null.
 * @returns the name, or undefined when there is no display name to greet by.
 */
export function greetingName(profile: AhelProfile | null, live: string | null = null): string | undefined {
  for (const name of [live, profile?.name]) {
    const first = name?.trim().split(/\s+/)[0]
    if (first !== undefined && first !== '') return first
  }
  return undefined
}

/**
 * Render the hero headline with the signed-in person's first name.
 * @param props - composed slot props.
 * @returns the greeting text.
 */
export function HeroGreeting({ greet, useAccount, useSummary }: HeroGreetingProps) {
  const signedIn = useAccount(view => view?.status === 'signed-in')
  const profile = useAccount(view => view?.status === 'signed-in' ? view.profile : null)
  const live = useSummary(value => value.summary?.me?.name ?? null)
  return <>{greet(signedIn ? greetingName(profile, live) : undefined)}</>
}
