/** Verified install of the pinned driver release, against a local archive. */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { installDriver, installedVersion, PINNED_RELEASE, sha256File, type DriverRelease } from '../src/release.ts'

const folders: string[] = []
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }) })

it('downloads once, checks both hashes, and installs only the executable with its version', async () => {
  expect(PINNED_RELEASE.assets['darwin-arm64']?.archive).toContain(PINNED_RELEASE.version)
  const root = mkdtempSync(join(tmpdir(), 'cua-release-'))
  folders.push(root)
  mkdirSync(join(root, 'src', 'pkg'), { recursive: true })
  writeFileSync(join(root, 'src', 'pkg', 'cua-driver'), '#!/bin/sh\necho fake\n')
  writeFileSync(join(root, 'src', 'pkg', 'README'), 'not shipped\n')
  const archive = join(root, 'pkg.tar.gz')
  execFileSync('tar', ['-czf', archive, '-C', join(root, 'src'), 'pkg'])
  const asset = { archive: 'pkg.tar.gz', archiveSha256: sha256File(archive), binary: 'pkg/cua-driver', binarySha256: sha256File(join(root, 'src', 'pkg', 'cua-driver')) }
  const release: DriverRelease = { version: '9.9.9', tag: 'v9.9.9', baseUrl: 'https://example.invalid/releases/', assets: { 'darwin-arm64': asset } }
  const urls: string[] = []
  const fetch = (url: string): Promise<Uint8Array> => { urls.push(url); return Promise.resolve(readFileSync(archive)) }
  const options = { release, asset, cacheDir: join(root, 'cache'), outputDir: join(root, 'out'), executable: 'cua-driver', fetch }

  const path = await installDriver(options)
  expect(path).toBe(join(root, 'out', 'cua-driver'))
  expect(sha256File(path)).toBe(asset.binarySha256)
  expect(installedVersion(join(root, 'out'))).toBe('9.9.9')
  expect(urls).toEqual(['https://example.invalid/releases/pkg.tar.gz'])
  await installDriver(options)
  expect(urls).toHaveLength(1)
  await expect(installDriver({ ...options, outputDir: join(root, 'other'), cacheDir: join(root, 'cache2'), asset: { ...asset, archiveSha256: '0'.repeat(64) } }))
    .rejects.toThrow('expected 0000')
})
