import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createMacOSAppUpdateConfig,
  resolveMacOSAppUpdateFeed,
  verifyMacOSAppUpdateConfig,
  writeMacOSAppUpdateConfig,
} from '../scripts/macos-app-update-config.mjs'

const roots: string[] = []
const update = { owner: 'ahel-technologies', repo: 'ahel-desktop', releaseType: 'release' }

async function fixture(): Promise<{ appPath: string; resourcesDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'desktop-macos-update-config-'))
  roots.push(root)
  const appPath = join(root, 'Ahel Desktop.app')
  const resourcesDir = join(appPath, 'Contents', 'Resources')
  await mkdir(resourcesDir, { recursive: true })
  return { appPath, resourcesDir }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('macOS packaged updater configuration', () => {
  it('uses the final GitHub releases provider configured for the build', () => {
    expect(resolveMacOSAppUpdateFeed([{ provider: 'github', ...update }])).toEqual(update)
    for (const publish of [undefined, [], [{ provider: 'generic', url: 'https://updates.example.com/', channel: 'latest' }],
      [{ provider: 'github', owner: update.owner, repo: update.repo, releaseType: 'draft' }],
      [{ provider: 'github', owner: update.owner, releaseType: 'release' }]]) {
      expect(() => resolveMacOSAppUpdateFeed(publish)).toThrow(/macOS update config/u)
    }
  })

  it('writes and verifies the GitHub feed electron-builder would write before signing', async () => {
    const paths = await fixture()
    expect(createMacOSAppUpdateConfig(update, 'ahel-desktop-updater')).toEqual({
      owner: 'ahel-technologies',
      repo: 'ahel-desktop',
      provider: 'github',
      releaseType: 'release',
      updaterCacheDirName: 'ahel-desktop-updater',
    })
    await writeMacOSAppUpdateConfig(paths.resourcesDir, update, 'ahel-desktop-updater')
    await expect(verifyMacOSAppUpdateConfig(paths.appPath, update, 'ahel-desktop-updater')).resolves.toBeUndefined()
  })

  it.each([
    ['missing', undefined],
    ['wrong repository', 'owner: ahel-technologies\nrepo: other\nprovider: github\nreleaseType: release\nupdaterCacheDirName: fixture\n'],
    ['generic provider', 'provider: generic\nurl: https://updates.example.com/\nupdaterCacheDirName: fixture\n'],
    ['missing cache directory', 'owner: ahel-technologies\nrepo: ahel-desktop\nprovider: github\nreleaseType: release\n'],
  ] as const)('rejects %s updater configuration', async (_label, contents) => {
    const paths = await fixture()
    if (contents !== undefined) await writeFile(join(paths.resourcesDir, 'app-update.yml'), contents)
    await expect(verifyMacOSAppUpdateConfig(paths.appPath, update)).rejects.toThrow(/macOS update config/u)
  })

  it('rejects another updater cache directory when the signed value is known', async () => {
    const paths = await fixture()
    await writeMacOSAppUpdateConfig(paths.resourcesDir, update, 'wrong-updater')
    await expect(verifyMacOSAppUpdateConfig(paths.appPath, update, 'ahel-desktop-updater'))
      .rejects.toThrow(/expected ahel-desktop-updater/u)
  })
})
