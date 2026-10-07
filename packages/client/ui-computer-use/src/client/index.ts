/**
 * Browser face of computer use: mounts the Host's `computerUseApproval` Remote
 * namespace and fills the composer takeover with the approval card for every
 * computer-use write, the composer dock with the stop control, pause toggle
 * and activity log, and Settings > General with the user's block list.
 */
import type { Context } from '@ahel/cordis'
import z from '@ahel/schemastery'
import type {} from '@ahel/dsh-api-remotes/client'
import computerUseRemote from '@ahel/dsh-client-ui-computer-use/remote'
import { registerComputerUse } from './register.ts'

export type { ApprovalCardProps, ComputerUseInjected, DockProps, SettingsRowProps } from './contract.ts'
export type { ComputerUseKey } from './locales.ts'

/** Client configuration. */
export interface Config {
  /** MCP server name of the Cua Driver; must match the gate's `serverName`. */
  serverName?: string
}

/** Client configuration schema. */
export const Config: z<Config> = z.object({
  serverName: z.string().default('ahel-computer'),
})

/** Required services: the Remote mount, slots, and dictionaries. */
export const inject = ['remote', 'slots', 'locale']

/**
 * Mount the `computerUseApproval` Remote namespace, then register the UI.
 * @param ctx - Client runtime.
 * @param config - client options.
 * @returns disposer withdrawing the UI and the Remote namespace.
 */
export async function apply(ctx: Context, config: Config = Config({})): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(computerUseRemote)
  const ui = ctx.inject(['remote.computerUseApproval', 'slots', 'locale'], (inner) => {
    registerComputerUse(inner, { serverName: config.serverName ?? 'ahel-computer' })
  })
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await disposeRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await disposeRemote()
  }
}
