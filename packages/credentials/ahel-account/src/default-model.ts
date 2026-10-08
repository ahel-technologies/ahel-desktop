/**
 * The Host's saved default model follows the ahel.ai workspace, so chats the
 * Host starts by itself (an issue run it picks up, a webhook) start where a
 * new chat in the UI does: on the workspace default, else on the first model
 * the Ahel route lists, never on a model saved by an earlier pick that the
 * workspace no longer uses. A chat's own choice is its Session's, not the
 * saved default, so it is untouched. A listed model on the person's own key
 * is kept while the workspace has no default.
 * @module @ahel/dsh-ahel-account/default-model
 */
import type { Context } from '@ahel/cordis'
import type {} from '@ahel/dsh-agent-default-model'
import type {} from '@ahel/dsh-llm'
import type {} from './team.ts'
import type {} from './types.ts'

/** Route key of the Ahel models (`dsh-llm-ahel`'s default `provider`). */
export const AHEL_PROVIDER = 'ahel'

/** What the decision reads. */
export interface DefaultModelFacts {
  /** Model ids the Ahel route lists, in ahel.ai's order. */
  readonly listed: readonly string[]
  /** The workspace default; null when none is set, undefined while unknown. */
  readonly workspaceDefault: string | null | undefined
  /** The saved default, or undefined. */
  readonly saved: { readonly provider: string; readonly model: string } | undefined
  /** Whether the saved default is on another provider that lists it. */
  readonly ownKeyListed: boolean
}

/**
 * The Ahel model the saved default should be, or undefined to leave it.
 * @param facts - the route's list, the workspace default and the saved default.
 * @returns a listed model id on the Ahel route, or undefined.
 */
export function alignedDefault({ listed, workspaceDefault, saved, ownKeyListed }: DefaultModelFacts): string | undefined {
  const first = listed[0]
  if (first === undefined) return undefined
  const onAhel = saved?.provider === AHEL_PROVIDER
  let target: string | undefined
  if (typeof workspaceDefault === 'string' && listed.includes(workspaceDefault)) target = workspaceDefault
  else if (workspaceDefault === undefined) target = onAhel && !listed.includes(saved.model) ? first : undefined
  else target = ownKeyListed ? undefined : first
  return target === undefined || (onAhel && saved.model === target) ? undefined : target
}

/** Plugin name. */
export const name = 'ahel-default-model'

/** Required services. */
export const inject = ['agentDefaultModel', 'llm', 'ahelTeam', 'ahelAccount']

/**
 * Keep the saved default aligned on sign-in, on route and settings changes, and whenever
 * the team side reads the workspace default (each summary poll, a GET or a PUT).
 * @param ctx - Host context.
 */
export function apply(ctx: Context): void {
  let workspaceDefault: string | null | undefined
  let queue: Promise<void> = Promise.resolve()

  const align = async (): Promise<void> => {
    if (await ctx.ahelAccount.accessToken() === undefined) return
    const providers = ctx.llm.listProviders().map(provider => provider.id)
    if (!providers.includes(AHEL_PROVIDER)) return
    const listed = (await ctx.llm.listModels(AHEL_PROVIDER)).map(model => model.id)
    const saved = ctx.agentDefaultModel.configuredSelection()
    let ownKeyListed = false
    if (saved !== undefined && saved.provider !== AHEL_PROVIDER && providers.includes(saved.provider)) {
      // A catalog that cannot be read now keeps the person's own choice.
      ownKeyListed = await ctx.llm.listModels(saved.provider)
        .then(models => models.some(model => model.id === saved.model), () => true)
    }
    const target = alignedDefault({ listed, workspaceDefault, saved, ownKeyListed })
    if (target !== undefined) await ctx.agentDefaultModel.saveSelection({ provider: AHEL_PROVIDER, model: target })
  }
  const schedule = (): void => {
    queue = queue.then(align).catch((error: unknown) => {
      ctx.logger.warn(`ahel-account: the default model was not aligned with the workspace: ${error instanceof Error ? error.message : String(error)}`)
    })
  }
  const read = (): void => {
    // A read reports through `ahel-account/default-model`; an older or unreachable ahel.ai leaves it unknown.
    void ctx.ahelTeam.workspaceModel().catch(() => { schedule() })
  }

  ctx.on('ahel-account/default-model', (value) => {
    workspaceDefault = value
    schedule()
  })
  ctx.on('llm/adapters-updated', schedule)
  // A pick in any chat saves the default too; the chat keeps its pick, the saved default comes back.
  ctx.on('loader/volatile-update', schedule)
  ctx.on('ahel-account/changed', (view) => {
    if (view.status === 'signed-out') workspaceDefault = undefined
    else read()
  })
  read()
}
