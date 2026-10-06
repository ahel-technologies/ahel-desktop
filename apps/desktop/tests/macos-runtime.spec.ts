import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { runtimeEntitlementsFile, signMacOSRuntime } from '../scripts/macos-runtime.ts'
import { signMacOSRuntimeCode, verifyMacOSRuntimeCode } from '../scripts/verify-macos-signature.mjs'

vi.mock('../scripts/verify-macos-signature.mjs', () => ({ signMacOSRuntimeCode: vi.fn(), verifyMacOSRuntimeCode: vi.fn() }))
const roots: string[] = []
function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'desktop-signing-'))
  roots.push(path)
  return path
}
const identity = { signingIdentity: 'Example (TEAMID1234)', teamId: 'TEAMID1234' }
afterEach(() => {
  vi.resetAllMocks()
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
})
it('signs Mach-O files in their final locations and verifies each signature', async () => {
  const path = root()
  writeFileSync(join(path, 'addon.node'), Buffer.from('cffaedfe00000000', 'hex'))
  writeFileSync(join(path, 'source.js'), 'export {}')
  await expect(signMacOSRuntime(path, 'com.example.app', identity, 'arm64')).resolves.toBe(1)
  expect(signMacOSRuntimeCode).toHaveBeenCalledWith(join(path, 'addon.node'), expect.stringMatching(/^com\.example\.app\.runtime\.[a-f0-9]{64}$/u), identity, undefined)
  expect(verifyMacOSRuntimeCode).toHaveBeenCalledWith(join(path, 'addon.node'), identity)
})
it('awaits other signers before rejecting and permitting output cleanup', async () => {
  const path = root()
  for (const name of ['a.node', 'b.node']) writeFileSync(join(path, name), Buffer.from('cffaedfe00000000', 'hex'))
  let release!: () => void
  const barrier = new Promise<void>((resolve) => { release = resolve })
  let started!: () => void
  const ready = new Promise<void>((resolve) => { started = resolve })
  vi.mocked(signMacOSRuntimeCode).mockImplementation(async (file) => {
    if (file.endsWith('a.node')) throw new Error('sign failure')
    started()
    await barrier
  })
  let completed = false
  const result = signMacOSRuntime(path, 'com.example.app', identity, 'arm64').catch((error: unknown) => { completed = true; return error })
  try {
    await ready
    expect(completed).toBe(false)
  } finally { release() }
  expect(await result).toBeInstanceOf(AggregateError)
  expect(verifyMacOSRuntimeCode).toHaveBeenCalledWith(join(path, 'b.node'), identity)
})

it.each(['arm64', 'x64'] as const)('selects %s Node entitlements and signs other code without entitlements', async (arch) => {
  const path = root()
  mkdirSync(join(path, 'dependencies/node/bin'), { recursive: true })
  const node = join(path, 'dependencies/node/bin/node')
  const addon = join(path, 'addon.node')
  for (const file of [node, addon]) writeFileSync(file, Buffer.from('cffaedfe00000000', 'hex'))
  await signMacOSRuntime(path, 'com.example.app', identity, arch)
  const nodePlist = join(import.meta.dirname, '../scripts', arch === 'x64' ? 'node-x64-entitlements.plist' : 'node-arm64-entitlements.plist')
  expect(signMacOSRuntimeCode).toHaveBeenCalledWith(node, expect.any(String), identity, nodePlist)
  const xml = readFileSync(nodePlist, 'utf8')
  expect(xml).toMatch(/<key>com\.apple\.security\.cs\.allow-jit<\/key>\s*<true\s*\/>/u)
  expect(/<key>com\.apple\.security\.cs\.allow-unsigned-executable-memory<\/key>\s*<true\s*\/>/u.test(xml)).toBe(arch === 'x64')
  expect(signMacOSRuntimeCode).toHaveBeenCalledWith(addon, expect.any(String), identity, undefined)
})

it('disables library validation only for the interpreters that load user-installed native extensions', () => {
  expect(runtimeEntitlementsFile('dependencies/node/bin/node', 'arm64')).toBe('node-arm64-entitlements.plist')
  for (const python of ['python', 'python3', 'python3.12']) {
    expect(runtimeEntitlementsFile(`dependencies/python/bin/${python}`, 'arm64')).toBe('python-entitlements.plist')
  }
  expect(runtimeEntitlementsFile('dependencies/python/lib/python3.12/lib-dynload/_ssl.cpython-312-darwin.so', 'arm64')).toBeUndefined()
  expect(runtimeEntitlementsFile('dependencies/python/bin/python3-config', 'arm64')).toBeUndefined()
  for (const file of ['node-arm64-entitlements.plist', 'node-x64-entitlements.plist', 'python-entitlements.plist']) {
    expect(readFileSync(join(import.meta.dirname, '../scripts', file), 'utf8')).toMatch(/<key>com\.apple\.security\.cs\.disable-library-validation<\/key>\s*<true\s*\/>/u)
  }
  expect(readFileSync(join(import.meta.dirname, '../scripts/python-entitlements.plist'), 'utf8')).not.toContain('allow-jit')
})
