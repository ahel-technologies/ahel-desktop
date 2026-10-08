/**
 * The ahel.ai workspace each chat was started in. At the first step a chat
 * takes before any prompt is logged, while a workspace is selected, the Host
 * appends the log-only `ahel-account/chat-workspace` event with the envelope's
 * `ignorable: true`, so a build that does not know the type still reads the
 * log. The `ahelWorkspace` projection folds it, so Session list rows carry the
 * stamp on live and cold rows and a fork inherits it. A chat with prompts from
 * before this stamp existed, or started with no workspace selected, stays
 * unstamped (null).
 * @module @ahel/dsh-ahel-account/chat-workspace
 */
import type { Context } from '@ahel/cordis'
import type { PreStepDecision } from '@ahel/dsh-agent'
import type { Session } from '@ahel/dsh-session'
import type { ProjectionDefinition } from '@ahel/dsh-session-projection'
import type {} from '@ahel/dsh-api-session-controller/types'
import { z } from 'zod'
import type {} from './types.ts'

declare module '@ahel/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The ahel.ai workspace selected when the chat took its first step.
     * Log-only and written with `ignorable: true`: it never reaches a model
     * request; the hosted chat lists the chat under this workspace.
     */
    'ahel-account/chat-workspace': { workspace: string }
  }
}

const stampSchema = z.union([z.string(), z.null()])

/** The `ahelWorkspace` projection: the latest stamp, null before one. */
export const chatWorkspaceProjection = {
  key: 'ahelWorkspace',
  stateSchema: stampSchema,
  init: () => null,
  apply: (state, event) => event.type === 'ahel-account/chat-workspace' ? event.data.workspace : state,
  wire: { viewSchema: stampSchema, view: state => state },
  stateVersion: 1,
} satisfies ProjectionDefinition<'ahelWorkspace', string | null>

/**
 * Whether a step stamps its chat: a top-level chat, not stamped yet, with no prompt logged. The
 * accepted prompt enters the log after `agent/pre-step`, so the chat's first step to run sees none;
 * a turn rejected or cancelled before its step logs none, and the next turn's first step stamps.
 * @param origin - the Session header's origin.
 * @param stamp - the `ahelWorkspace` state, or undefined when the projection is not registered.
 * @param lastPromptAt - `sessionListMetadata.lastPromptAt`, or undefined when that projection is not registered.
 * @returns true to stamp.
 */
export function needsStamp(origin: string | undefined, stamp: string | null | undefined, lastPromptAt: number | null | undefined): boolean {
  return origin !== 'subagent' && stamp === null && lastPromptAt === null
}

/**
 * Append the stamp, marked ignorable: it only names the chat's workspace, so a reader that skips it
 * reconstructs the same conversation.
 * @param session - the chat's Session.
 * @param workspace - the ahel.ai workspace id.
 */
export function stampChat(session: Session, workspace: string): void {
  session.append('ahel-account/chat-workspace', { workspace }, { ignorable: true })
}

/** Plugin name. */
export const name = 'ahel-chat-workspace'

/** Required services: the projection registry and the account for the selected workspace. */
export const inject = ['sessionProjections', 'ahelAccount']

/**
 * Register the projection and stamp each new top-level chat at its first accepted step.
 * @param ctx - Host context.
 */
export function apply(ctx: Context): void {
  ctx.sessionProjections.register(chatWorkspaceProjection)
  ctx.on('agent/pre-step', async ({ agent, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const { session } = agent
    const stamp = ctx.sessionProjections.stateOf(session, 'ahelWorkspace')
    const lastPromptAt = ctx.sessionProjections.stateOf(session, 'sessionListMetadata')?.lastPromptAt
    if (!needsStamp(session.header.origin, stamp, lastPromptAt)) return decision
    try {
      const workspace = await ctx.ahelAccount.workspace()
      if (workspace !== undefined) stampChat(session, workspace)
    } catch (error) {
      // An unstamped chat lists under the account's default workspace; the step goes on.
      ctx.logger.warn(`ahel-account: the chat's workspace could not be recorded: ${error instanceof Error ? error.message : String(error)}`)
    }
    return decision
  })
}
