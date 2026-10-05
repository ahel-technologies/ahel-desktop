import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertDesktopHostPackageFiles,
  selectDesktopPackageClosure,
  type PackedDesktopPackage,
} from '../scripts/prepare-package-set.ts'

function packed(name: string, manifest: Record<string, unknown> = {}): PackedDesktopPackage {
  return { tarball: `${name}.tgz`, manifest: { name, version: '1.0.0', ...manifest } }
}

describe('desktop package-set selection', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('does not select a packaging target when imported as a library', async () => {
    vi.stubEnv('DSH_DESKTOP_TARGET_PLATFORM', 'linux')
    vi.stubEnv('DSH_DESKTOP_TARGET_ARCH', 'x64')
    vi.resetModules()
    await expect(import('../scripts/prepare-package-set.ts')).resolves.toHaveProperty('prepareDesktopPackageSet')
  })

  it('includes only the available internal production closure', () => {
    const available = new Map<string, PackedDesktopPackage>([
      ['@ahel/dsh', packed('@ahel/dsh', {
        dependencies: { '@ahel/dsh-base': '^1.0.0', external: '^2.0.0' },
        optionalDependencies: { '@ahel/platform-package': '1.0.0', '@ahel/missing-platform': '1.0.0' },
      })],
      ['@ahel/dsh-desktop-host', packed('@ahel/dsh-desktop-host', {
        dependencies: { '@ahel/dsh': '^1.0.0' },
      })],
      ['@ahel/dsh-base', packed('@ahel/dsh-base', {
        peerDependencies: { '@ahel/cordis': '^1.0.0' },
      })],
      ['@ahel/cordis', packed('@ahel/cordis')],
      ['@ahel/platform-package', packed('@ahel/platform-package')],
      ['@ahel/unused', packed('@ahel/unused')],
    ])
    expect(selectDesktopPackageClosure(available).map(entry => entry.manifest.name)).toEqual([
      '@ahel/cordis',
      '@ahel/dsh',
      '@ahel/dsh-base',
      '@ahel/dsh-desktop-host',
      '@ahel/platform-package',
    ])
  })

  it.each([
    '@ahel/dsh-base', '@ahel/cordis', '@ahel/node-addon-system',
  ])('rejects required prepared package %s absent from the packed release inputs', (dependency) => {
    const available = new Map<string, PackedDesktopPackage>([
      ['@ahel/dsh', packed('@ahel/dsh', {
        dependencies: { [dependency]: '^1.0.0' },
      })],
      ['@ahel/dsh-desktop-host', packed('@ahel/dsh-desktop-host', {
        dependencies: { '@ahel/dsh': '^1.0.0' },
      })],
    ])
    expect(() => selectDesktopPackageClosure(available)).toThrow(/unpacked package/u)
    expect(() => selectDesktopPackageClosure(new Map([
      ['@ahel/dsh', packed('@ahel/dsh')],
    ]))).toThrow(/omit @ahel\/dsh-desktop-host/u)
  })

  it('leaves independently published packages to npm resolution', () => {
    const available = new Map<string, PackedDesktopPackage>([
      ['@ahel/dsh', packed('@ahel/dsh', {
        dependencies: {
          '@example/published-kit': '0.0.1',
          '@example/published-kit-wasm': '0.0.1',
        },
      })],
      ['@ahel/dsh-desktop-host', packed('@ahel/dsh-desktop-host')],
    ])
    expect(selectDesktopPackageClosure(available).map(entry => entry.manifest.name)).toEqual([
      '@ahel/dsh', '@ahel/dsh-desktop-host',
    ])
  })

  it('requires both Desktop Host and public CLI entries', () => {
    const files = [
      'package/lib/index.js',
      'package/lib/cli.js',
    ]
    expect(() => {
      assertDesktopHostPackageFiles(files)
    }).not.toThrow()
    expect(() => {
      assertDesktopHostPackageFiles(files.slice(1))
    }).toThrow(/lib\/index\.js/u)
    expect(() => { assertDesktopHostPackageFiles(files.slice(0, 1)) }).toThrow(/lib\/cli\.js/u)
  })
})
