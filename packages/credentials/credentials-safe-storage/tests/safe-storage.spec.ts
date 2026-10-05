import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@ahel/cordis'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credentialRef } from '@ahel/dsh-credentials'
import { createLaunchEnvironmentSnapshot, DSH_LAUNCH_ENVIRONMENT_KEY } from '@ahel/dsh-launch-environment'
import { SafeStorageCredentialProvider, type SafeStorageBridge } from '../src/index.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

/** Reversible stand-in for the Keychain: base64 of the byte-flipped UTF-8 text. */
class FakeKeychainProvider extends SafeStorageCredentialProvider {
  protected override connectBridge(): SafeStorageBridge {
    return {
      isEncryptionAvailable: () => Promise.resolve(true),
      encrypt: text => Promise.resolve(Buffer.from(text).map(byte => byte ^ 0xff).toString('base64')),
      decrypt: data => Promise.resolve(Buffer.from(data, 'base64').map(byte => byte ^ 0xff).toString()),
      close: () => {},
    }
  }
}

describe('credentials-safe-storage', () => {
  it('moves the plaintext document into the encrypted one and serves and writes through it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-credentials-safe-storage-'))
    cleanups.push(() => rm(home, { recursive: true, force: true }))
    const plaintext = join(home, '.credentials.yaml')
    const encrypted = join(home, '.credentials.enc')
    await writeFile(plaintext, 'version: 1\nrefs:\n  OLD_KEY: old-secret\n', { mode: 0o600 })

    const ctx = new Context()
    ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([]))
    const fiber = ctx.plugin(FakeKeychainProvider, { dshHome: home, watch: false })
    cleanups.push(async () => { await fiber.dispose() })
    await fiber

    await expect(stat(plaintext)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await ctx.credentials.resolve(credentialRef('OLD_KEY'))).toEqual({ value: 'old-secret', source: 'file' })

    await ctx.credentials.set(credentialRef('NEW_KEY'), 'new-secret')
    const stored = await readFile(encrypted, 'utf8')
    expect(stored).not.toContain('secret')
    expect((await stat(encrypted)).mode & 0o777).toBe(0o600)
    await expect(stat(plaintext)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
