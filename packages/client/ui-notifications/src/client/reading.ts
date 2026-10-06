/** Structural reads of Client data this plugin does not own: settings, Session waits, turn previews and the Inbox. */
import type { SessionPendingInteractionBase } from '@ahel/dsh-client-ui-session/client'
import type { InboxRow } from './inbox.ts'
import { DEFAULT_SETTINGS, type NotificationSettings, type PendingWait } from './watcher.ts'

/** Localized display copy as approval requests carry it. */
export interface DisplayText {
  readonly en: string
  readonly [locale: string]: string
}

/**
 * Non-blank text, else absence.
 * @param value - any value.
 * @returns the string when it has visible content.
 */
export function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/**
 * Read a saved preference, falling back per field.
 * @param value - stored or submitted value.
 * @returns complete settings.
 */
export function normalizeSettings(value: unknown): NotificationSettings {
  const saved = (typeof value === 'object' && value !== null ? value : {}) as Partial<Record<keyof NotificationSettings, unknown>>
  return { enabled: typeof saved.enabled === 'boolean' ? saved.enabled : DEFAULT_SETTINGS.enabled }
}

/**
 * Reduce one Session wait to notification copy. Approvals (ui-approval) and questions or
 * plan reviews (ui-user-questions) notify; other kinds do not.
 * @param interaction - highest-precedence wait of one Session.
 * @param resolve - localizes approval display copy.
 * @returns the wait, or absence.
 */
export function waitOf(interaction: SessionPendingInteractionBase, resolve: (text: DisplayText) => string): PendingWait | undefined {
  const fields = interaction as unknown as Record<string, unknown>
  if (interaction.kind === 'approval') {
    const display = fields.displayReason as DisplayText | undefined
    const summary = (display === undefined ? undefined : text(resolve(display)))
      ?? text(fields.reason) ?? text(fields.toolName) ?? ''
    return { key: interaction.key, kind: 'approval', text: summary }
  }
  if (interaction.kind === 'question' || interaction.kind === 'plan-review') {
    const questions = Array.isArray(fields.questions) ? fields.questions as readonly { readonly question?: unknown }[] : []
    return { key: interaction.key, kind: 'question', text: text(questions[0]?.question) ?? '' }
  }
  return undefined
}

/**
 * Final assistant text of the newest turn, from the `turnOutline` projection preview
 * (the preview is clipped at its head, so a long reply never reads as a question).
 * @param values - Session projection values.
 * @returns the preview, or absence.
 */
export function lastResponse(values: unknown): string | undefined {
  const outline = (values as { turnOutline?: unknown } | undefined)?.turnOutline
  if (!Array.isArray(outline)) return undefined
  return text((outline.at(-1) as { response?: unknown } | undefined)?.response)
}

/** `ctx.remote.ahelTeam`, present only in Ahel builds; read structurally so other builds need no account package. */
interface TeamRemote {
  inbox(): Promise<{ readonly ok: boolean; readonly value?: { readonly received?: unknown } }>
}

/**
 * Bind the received-handoff read of the Ahel account, when this Client has one.
 * @param remote - `ctx.remote`.
 * @returns the reader, or absence without an Ahel account namespace.
 */
export function inboxReader(remote: unknown): (() => Promise<readonly InboxRow[] | undefined>) | undefined {
  const team = (remote as { ahelTeam?: Partial<TeamRemote> } | undefined)?.ahelTeam
  if (typeof team?.inbox !== 'function') return undefined
  const inbox = team.inbox.bind(team)
  return async () => {
    const result = await inbox()
    const received = result.ok ? result.value?.received : undefined
    if (!Array.isArray(received)) return undefined
    return received.flatMap((row: Partial<Record<keyof InboxRow, unknown>>) =>
      typeof row.id === 'string' && typeof row.unread === 'boolean'
        ? [{ id: row.id, unread: row.unread, title: text(row.title) ?? '', from: text(row.from) ?? '' }]
        : [])
  }
}
