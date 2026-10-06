/** Names the signed-in person in the blank-session greeting headline. */
import type { AhelProfile } from '@ahel/dsh-ahel-account/types'
import type { HeroGreetingProps } from './contract.ts'

/**
 * First name for the greeting: the display name's first word, else the
 * email's local part capitalised.
 * @param profile - the signed-in profile, or null.
 * @returns the name, or undefined when there is nothing to greet by.
 */
export function greetingName(profile: AhelProfile | null): string | undefined {
  const first = profile?.name?.trim().split(/\s+/)[0]
  if (first !== undefined && first !== '') return first
  const local = profile?.email.split('@')[0]?.trim() ?? ''
  return local === '' ? undefined : local.charAt(0).toUpperCase() + local.slice(1)
}

/**
 * Render the hero headline with the signed-in person's first name.
 * @param props - composed slot props.
 * @returns the greeting text.
 */
export function HeroGreeting({ greet, useAccount }: HeroGreetingProps) {
  const name = useAccount(view => view?.status === 'signed-in' ? greetingName(view.profile) : undefined)
  return <>{greet(name)}</>
}
