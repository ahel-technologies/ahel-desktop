/**
 * Exclusive named registration for the computer-use capability, plus the
 * person's `computerUse.enabled` switch that every provider and gate reads.
 * @module @ahel/dsh-computer-use
 */

import { Context, Service, type Volatile } from '@ahel/cordis'
import z from '@ahel/schemastery'
// Type-only: the `settings` service that persists setEnabled() into this entry, and the Loader's
// entry and `loader/volatile-update` merges.
import type {} from '@ahel/dsh-settings'
import type {} from '@ahel/cordis-plugin-loader'
import type { ComputerUseProviderName } from './brand.ts'

export { ComputerUseProviderName } from './brand.ts'

declare module '@ahel/cordis' {
  interface Context {
    computerUse: ComputerUseRegistry
  }

  interface Events {
    /**
     * The person turned computer use on or off. Emitted after the new value is live.
     * @param enabled - the value `ctx.computerUse.enabled` now reads.
     * @mode emit
     */
    'computer-use/enabled'(enabled: boolean): void
  }
}

/** Profile-owned computer-use policy. */
export interface Config {
  /**
   * The `computerUse.enabled` setting: off until the person turns on
   * Settings > General > Computer use (beta). Providers start their driver
   * only while it is on; the action gate denies every computer tool while it is off.
   */
  enabled: Volatile<boolean>
}

/** Owns one optional provider registration and the person's on switch. */
export class ComputerUseRegistry extends Service {
  static Config = z.object({
    enabled: z.boolean().default(false).volatile(),
  })

  private registration: ComputerUseProviderName | undefined
  /** Profile entry id that Settings writes; absent when mounted without Loader. */
  private readonly entryId: string | undefined
  private last: boolean

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'computerUse')
    this.entryId = ctx.fiber.entry?.options.id
    this.last = this.enabled
    ctx.on('loader/volatile-update', () => { this.announce() })
  }

  /** The `computerUse.enabled` setting as it is live now. */
  get enabled(): boolean {
    return this.config.enabled.get()
  }

  /** Name of the registered provider, including while its resources are closing. */
  get providerName(): ComputerUseProviderName | undefined {
    return this.registration
  }

  /**
   * Persist the person's on switch into this plugin's profile entry. The
   * Loader applies it live and `computer-use/enabled` follows.
   * @param enabled - the requested value.
   * @returns after the profile write.
   */
  async setEnabled(enabled: boolean): Promise<void> {
    const settings = this.ctx.get('settings')
    if (settings === undefined || this.entryId === undefined) {
      throw new Error('computer use: the switch requires the settings service and a profile entry')
    }
    await settings.update(this.entryId, { enabled })
    this.announce()
  }

  /**
   * Reserve the sole provider slot until the contribution is disposed.
   * A second registration fails even when it repeats the current name. Providers
   * must stop their tools and await owned work before releasing this registration.
   * @param name - provider-owned name used in registration diagnostics.
   * @returns the effect disposer for this exact registration.
   */
  register(name: ComputerUseProviderName): () => Promise<void> {
    if (this.registration !== undefined) {
      throw new Error(`computer use provider "${this.registration}" is already registered`)
    }
    return this.ctx.effect(() => {
      this.registration = name
      return () => {
        this.registration = undefined
      }
    }, 'computerUse.register()')
  }

  private announce(): void {
    const now = this.enabled
    if (now === this.last) return
    this.last = now
    this.ctx.emit('computer-use/enabled', now)
  }
}

export default ComputerUseRegistry
