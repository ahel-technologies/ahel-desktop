/** Time-aware greeting for the blank-session hero headline. */
import { en, type ConversationKey } from '../locales.ts'

/** Dictionary keys the greeting picks from. */
export type HeroGreetingKey = Extract<ConversationKey, `hero.greeting.${string}`>

/** Part of the day a greeting belongs to. */
export type HeroGreetingBand = 'morning' | 'afternoon' | 'evening' | 'night'

/** Greeting inputs. */
export interface HeroGreetingInput {
  /** Local hour, 0–23. */
  hour: number
  /** First name of the signed-in person; absent or blank drops the name. */
  name?: string | undefined
  /** Picks the late-night phrase; the day of the year keeps it stable within a day. */
  seed: number
}

/** Translate seat narrowed to the greeting keys. */
export type HeroGreetingTranslate = (key: HeroGreetingKey, params?: Record<string, unknown>) => string

const NIGHT_PHRASES = ['lateNight', 'stillUp', 'moonlit'] as const

/**
 * Part of the day for an hour.
 * @param hour - local hour, 0–23.
 * @returns morning 5–11, afternoon 12–17, evening 18–22, night 23–4.
 */
export function heroGreetingBand(hour: number): HeroGreetingBand {
  if (hour >= 5 && hour <= 11) return 'morning'
  if (hour >= 12 && hour <= 17) return 'afternoon'
  if (hour >= 18 && hour <= 22) return 'evening'
  return 'night'
}

/**
 * Day of the year for a local moment.
 * @param date - the local moment.
 * @returns the day of the year, 1–366.
 */
export function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0)
  return Math.floor((date.getTime() - start.getTime()) / 86_400_000)
}

const english: HeroGreetingTranslate = (key, params) =>
  en[key].replace('{name}', typeof params?.['name'] === 'string' ? params['name'] : '')

/**
 * Build the hero headline, e.g. "Good morning, Karl" or "Still up?".
 * @param input - see {@link HeroGreetingInput}.
 * @param t - the conversation locale seat; English when omitted.
 * @returns the headline text.
 */
export function heroGreeting(input: HeroGreetingInput, t: HeroGreetingTranslate = english): string {
  const { hour, name, seed } = input
  const band = heroGreetingBand(hour)
  const phrase = band === 'night' ? NIGHT_PHRASES[((Math.trunc(seed) % 3) + 3) % 3] ?? 'lateNight' : band
  const trimmed = name?.trim() ?? ''
  return trimmed === '' ? t(`hero.greeting.${phrase}.anon`) : t(`hero.greeting.${phrase}`, { name: trimmed })
}
