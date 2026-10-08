/**
 * The ahel.ai workspace each chat was started in. At the first step of a
 * chat's first turn, while a workspace is selected, the Host appends the
 * log-only `ahel-account/chat-workspace` event; the `ahelWorkspace` projection
 * folds it, so Session list rows carry the stamp on live and cold rows and a
 * fork inherits it. A chat that started before this stamp existed, or with no
 * workspace selected, stays unstamped (null).
 * @module @ahel/dsh-ahel-account/chat-workspace
 */
import type { Context } from '@ahel/cordis'
import type { PreStepDecision } from '@ahel/dsh-agent'
import type { ProjectionDefinition } from '@ahel/dsh-session-projection'
import { z } from 'zod'
import type {} from './types.ts'

declare module '@ahel/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The ahel.ai workspace selected when the chat's first turn took its
     * first step. Log-only: it never reaches a model request; the hosted chat
     * lists the chat under this workspace.
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
  ctx.on('agent/pre-step', async ({ agent, turn, step, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted || turn !== 1 || step !== 1) return decision
    if (agent.session.header.origin === 'subagent') return decision
    if (ctx.sessionProjections.stateOf(agent.session, 'ahelWorkspace') !== null) return decision
    try {
      const workspace = await ctx.ahelAccount.workspace()
      if (workspace !== undefined) agent.session.append('ahel-account/chat-workspace', { workspace })
    } catch (error) {
      // An unstamped chat lists under the account's default workspace; the step goes on.
      ctx.logger.warn(`ahel-account: the chat's workspace could not be recorded: ${error instanceof Error ? error.message : String(error)}`)
    }
    return decision
  })
}
