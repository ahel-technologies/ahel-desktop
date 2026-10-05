/**
 * Desktop credentials provider: the credentials-local document, stored as
 * `$DSH_HOME/.credentials.enc` — base64 of Electron
 * `safeStorage.encryptString(yaml)`, so the key lives in the macOS Keychain
 * (DPAPI on Windows). Resolution order, record semantics, locking, and hot
 * reload are credentials-local's; only the bytes on disk differ.
 *
 * The Host reaches `safeStorage` through the Electron main process over its
 * IPC channel ({@link connectSafeStorageBridge}). Without that channel, or when
 * `safeStorage.isEncryptionAvailable()` is false, the provider logs once and
 * serves the plaintext `.credentials.yaml` exactly as credentials-local does.
 *
 * On the first encrypted start, an existing `.credentials.yaml` with no
 * `.credentials.enc` beside it is encrypted into `.credentials.enc`, read back,
 * and then deleted.
 * @module @ahel/dsh-credentials-safe-storage
 */

import { Service } from '@ahel/cordis'
import type { Context } from '@ahel/cordis'
import z from '@ahel/schemastery'
import { readFile, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { withFileLock } from '@ahel/dsh-atomic-write'
import { resolveDshHome } from '@ahel/dsh-home-paths'
import {
  LocalCredentialProvider,
  parseCredentialsDocument,
  renderFlatLayoutMigration,
  type Config as LocalConfig,
} from '@ahel/dsh-credentials-local'
import { connectSafeStorageBridge, type SafeStorageBridge } from './bridge.ts'

export {
  connectSafeStorageBridge,
  SAFE_STORAGE_REQUEST,
  SAFE_STORAGE_RESPONSE,
  type IpcProcess,
  type SafeStorageBridge,
  type SafeStorageRequest,
  type SafeStorageResponse,
} from './bridge.ts'

/** Basename of the encrypted credentials document inside the harness home. */
export const ENCRYPTED_CREDENTIALS_FILENAME = '.credentials.enc'

/** Plugin config: credentials-local's, plus the encrypted document location. */
export interface Config extends LocalConfig {
  /** Encrypted document path; defaults to `.credentials.enc` under the harness home. */
  encryptedPath?: string
}

/**
 * Resolve the encrypted document path: an explicit `encryptedPath` wins,
 * otherwise `<harness home>/.credentials.enc`.
 * @param config - raw plugin config.
 * @returns the absolute encrypted document path.
 */
export function resolveEncryptedPath(config: Config): string {
  return resolve(config.encryptedPath ?? join(resolveDshHome(config.dshHome), ENCRYPTED_CREDENTIALS_FILENAME))
}

/** Lock wait for the one-shot migration; matches credentials-local's document lock. */
const MIGRATION_LOCK_WAIT_MS = 30_000

async function exists(filename: string): Promise<boolean> {
  try {
    await stat(filename)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return false
    throw error
  }
}

/** credentials-local over a `safeStorage`-encrypted document. */
export class SafeStorageCredentialProvider extends LocalCredentialProvider {
  static override Config: z<Config> = z.object({
    path: z.string(),
    encryptedPath: z.string(),
    dshHome: z.string(),
    watch: z.boolean().default(true),
    debounceMs: z.number().min(0).default(100),
  })

  private readonly encryptedPath: string
  /** Set only once encryption is confirmed available; `undefined` serves plaintext. */
  private bridge: SafeStorageBridge | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx, config)
    this.encryptedPath = resolveEncryptedPath(config)
  }

  override async* [Service.init](): AsyncGenerator<() => Promise<void> | void, void, void> {
    yield () => { this.bridge?.close() }
    yield* super[Service.init]()
  }

  /**
   * The bridge to the Electron main process.
   * @returns the bridge, or `undefined` outside the Desktop Host.
   */
  protected connectBridge(): SafeStorageBridge | undefined {
    return connectSafeStorageBridge()
  }

  protected override async prepareStorage(): Promise<void> {
    const plaintextPath = this.spec.filename
    const bridge = this.connectBridge()
    let available = false
    try {
      available = bridge !== undefined && await bridge.isEncryptionAvailable()
    } catch (error) {
      this.ctx.logger.warn(error)
    }
    if (!available) {
      bridge?.close()
      this.ctx.logger.warn(
        'credentials-safe-storage: OS encryption is unavailable; credentials stay in plaintext at %s',
        plaintextPath,
      )
      return
    }
    this.bridge = bridge
    this.spec = { ...this.spec, filename: this.encryptedPath }
    await this.migratePlaintext(plaintextPath)
  }

  /**
   * Move a plaintext document into the encrypted one when only the plaintext
   * exists. The plaintext is deleted only after the encrypted copy reads back
   * identical; a document credentials-local would reject is left untouched.
   * @param plaintextPath - the credentials-local document path.
   */
  private async migratePlaintext(plaintextPath: string): Promise<void> {
    if (!await exists(plaintextPath)) return
    if (await exists(this.encryptedPath)) {
      this.ctx.logger.warn('credentials-safe-storage: ignoring %s because %s exists', plaintextPath, this.encryptedPath)
      return
    }
    await withFileLock(this.encryptedPath, async () => {
      if (await exists(this.encryptedPath)) return
      const text = await readFile(plaintextPath, 'utf8')
      parseCredentialsDocument(renderFlatLayoutMigration(text) ?? text, plaintextPath)
      await this.writeDocument(this.encryptedPath, text)
      if (await this.readDocument(this.encryptedPath) !== text) {
        throw new Error(`credentials-safe-storage: ${this.encryptedPath} did not read back; ${plaintextPath} is kept`)
      }
      await rm(plaintextPath)
      this.ctx.logger.info('credentials-safe-storage: encrypted %s into %s and deleted the plaintext', plaintextPath, this.encryptedPath)
    }, { waitMs: MIGRATION_LOCK_WAIT_MS })
  }

  protected override async readDocument(filename: string): Promise<string> {
    const stored = await super.readDocument(filename)
    if (this.bridge === undefined) return stored
    return this.bridge.decrypt(stored.trim())
  }

  protected override async writeDocument(filename: string, text: string): Promise<void> {
    if (this.bridge === undefined) {
      await super.writeDocument(filename, text)
      return
    }
    await super.writeDocument(filename, `${await this.bridge.encrypt(text)}\n`)
  }
}

export default SafeStorageCredentialProvider
