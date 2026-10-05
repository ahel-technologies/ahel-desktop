/**
 * Browser face of the MCP Apps card host: mounts the `mcpApps` Remote
 * namespace and fills the Tool layer's `tool.call.app` slot with a sandboxed
 * card for every settled call that persisted an `mcpApp` record.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import mcpAppsRemote from '@deepseek-ai/dsh-client-ui-mcp-app/remote'
import { registerMcpAppCard } from './register.ts'

/** Client configuration. */
export interface Config {
  /** Largest card height in CSS pixels; taller app content scrolls inside the card. */
  maxHeight?: number
}

/** Client configuration schema. */
export const Config: z<Config> = z.object({
  maxHeight: z.natural().min(120).default(640),
})

/** Required services: the Remote mount, slots, and dictionaries. */
export const inject = ['remote', 'slots', 'locale']

/**
 * Mount the `mcpApps` Remote namespace and register the card.
 * @param ctx - Client runtime.
 * @param config - card limits.
 * @returns disposer withdrawing the card and the Remote namespace.
 */
export async function apply(ctx: Context, config: Config = Config({})): Promise<() => Promise<void>> {
  return await mountMcpAppCard(ctx, mcpAppsRemote, { maxHeight: config.maxHeight ?? 640 })
}

/**
 * Mount the Remote contribution, then register the card once its namespace is ready.
 * @param ctx - Client runtime.
 * @param contribution - generated `mcpApps` Remote definitions.
 * @param config - card limits.
 * @returns disposer withdrawing the card and the Remote namespace.
 */
async function mountMcpAppCard(
  ctx: Context,
  contribution: TypertRemoteContribution,
  config: { maxHeight: number },
): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(contribution)
  const ui = ctx.inject(['remote.mcpApps', 'slots', 'locale'], (inner) => { registerMcpAppCard(inner, config) })
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
