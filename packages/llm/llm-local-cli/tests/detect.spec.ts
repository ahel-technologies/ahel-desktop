import { describe, expect, it } from 'vitest'
import { candidatePaths, CLI_DESCRIPTORS, compareVersions, detectCli, parseVersion } from '../src/detect.ts'
import type { DetectDeps, ProbeResult } from '../src/detect.ts'

const claude = CLI_DESCRIPTORS.find(descriptor => descriptor.id === 'claude-code')!
const codex = CLI_DESCRIPTORS.find(descriptor => descriptor.id === 'codex-cli')!
const gemini = CLI_DESCRIPTORS.find(descriptor => descriptor.id === 'gemini-cli')!

const ok = (output: string, exitCode = 0): ProbeResult => ({ exitCode, output, timedOut: false, failed: false })

type FakeDeps = DetectDeps & { calls: string[][] }

function deps(executables: string[], answers: Record<string, ProbeResult>, env: Record<string, string> = {}): FakeDeps {
  const calls: string[][] = []
  return {
    env: { PATH: '/opt/bin:/usr/local/bin', ...env },
    platform: 'darwin',
    home: '/Users/person',
    calls,
    isExecutable: async path => executables.includes(path),
    run: async (argv) => {
      calls.push([...argv])
      return answers[argv.slice(1).join(' ')] ?? { exitCode: null, output: '', timedOut: true, failed: false }
    },
  }
}

describe('version parsing', () => {
  it('reads the first semver of each banner and compares numerically', () => {
    expect(parseVersion('2.0.14 (Claude Code)')).toBe('2.0.14')
    expect(parseVersion('codex-cli 0.101.0\n')).toBe('0.101.0')
    expect(parseVersion('no version here')).toBeUndefined()
    expect(compareVersions('0.100.0', '0.99.9')).toBeGreaterThan(0)
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0)
  })
})

describe('candidate ordering', () => {
  it('tries the override, then PATH, then known install locations', () => {
    const environment = { env: { PATH: '/opt/bin::relative:/usr/local/bin', AHEL_CODEX_PATH: '/custom/codex' }, platform: 'darwin' as const, home: '/Users/person' }
    expect(candidatePaths(codex, environment)).toEqual([
      '/custom/codex',
      '/opt/bin/codex',
      '/usr/local/bin/codex',
      '/Applications/ChatGPT.app/Contents/Resources/codex',
      '/Users/person/Applications/ChatGPT.app/Contents/Resources/codex',
      '/Applications/Codex.app/Contents/Resources/codex',
      '/Users/person/Applications/Codex.app/Contents/Resources/codex',
    ])
    expect(candidatePaths(claude, environment).at(-1)).toBe('/Users/person/.claude/local/claude')
  })
})

describe('detection', () => {
  it('reports a signed-in CLI from the first executable candidate', async () => {
    const fake = deps(['/usr/local/bin/claude', '/Users/person/.claude/local/claude'], { '--version': ok('2.1.0 (Claude Code)'), 'auth status': ok('') })
    await expect(detectCli(claude, fake, 5_000)).resolves.toMatchObject({
      installed: true, path: '/usr/local/bin/claude', version: '2.1.0', versionOk: true, login: 'signed-in',
    })
    expect(fake.calls).toEqual([['/usr/local/bin/claude', '--version'], ['/usr/local/bin/claude', 'auth', 'status']])
  })

  it('keeps a timed-out CLI installed with an unknown login, and skips the login probe below the minimum', async () => {
    await expect(detectCli(claude, deps(['/opt/bin/claude'], {}), 5_000)).resolves.toMatchObject({ installed: true, versionOk: false, login: 'unknown' })
    const old = deps(['/opt/bin/codex'], { '--version': ok('codex-cli 0.46.0') })
    await expect(detectCli(codex, old, 5_000)).resolves.toMatchObject({ installed: true, version: '0.46.0', versionOk: false, login: 'unknown' })
    expect(old.calls).toHaveLength(1)
  })

  it('reports signed-out from a non-zero status exit, unknown for Gemini, and absent CLIs as not installed', async () => {
    await expect(detectCli(codex, deps(['/opt/bin/codex'], { '--version': ok('codex-cli 0.101.0'), 'login status': ok('', 1) }), 5_000))
      .resolves.toMatchObject({ versionOk: true, login: 'signed-out' })
    await expect(detectCli(gemini, deps(['/opt/bin/gemini'], { '--version': ok('0.62.0') }), 5_000)).resolves.toMatchObject({ versionOk: true, login: 'unknown' })
    await expect(detectCli(gemini, deps([], {}), 5_000)).resolves.toMatchObject({ installed: false, versionOk: false })
  })
})
