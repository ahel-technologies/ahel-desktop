import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MACOS_SIGNING_SECRETS,
  configureMacOSSigning,
  developerIdIdentity,
  formatMacOSDotenv,
  macOSSigningGate,
  readP12Certificates,
} from '../scripts/macos-ci-signing.mjs'
import { loadDesktopPackageEnvironment, validateDesktopPackageEnvironment } from '../scripts/desktop-package-environment.mjs'

// Self-signed test certificate: CN "Developer ID Application: Example Company OÜ, Ltd (ABCDE12345)", OU ABCDE12345, valid until 2126.
const certificate = [
  '-----BEGIN CERTIFICATE-----',
  'MIICrzCCAlWgAwIBAgIUZASfutXglfj7lnOhktAumaQgg2kwCgYIKoZIzj0EAwIw',
  'gasxGjAYBgoJkiaJk/IsZAEBDApBQkNERTEyMzQ1MUgwRgYDVQQDDD9EZXZlbG9w',
  'ZXIgSUQgQXBwbGljYXRpb246IEV4YW1wbGUgQ29tcGFueSBPw5wsIEx0ZCAoQUJD',
  'REUxMjM0NSkxEzARBgNVBAsMCkFCQ0RFMTIzNDUxITAfBgNVBAoMGEV4YW1wbGUg',
  'Q29tcGFueSBPw5wsIEx0ZDELMAkGA1UEBhMCRUUwIBcNMjYxMDA2MTg1MzM5WhgP',
  'MjEyNjA5MTIxODUzMzlaMIGrMRowGAYKCZImiZPyLGQBAQwKQUJDREUxMjM0NTFI',
  'MEYGA1UEAww/RGV2ZWxvcGVyIElEIEFwcGxpY2F0aW9uOiBFeGFtcGxlIENvbXBh',
  'bnkgT8OcLCBMdGQgKEFCQ0RFMTIzNDUpMRMwEQYDVQQLDApBQkNERTEyMzQ1MSEw',
  'HwYDVQQKDBhFeGFtcGxlIENvbXBhbnkgT8OcLCBMdGQxCzAJBgNVBAYTAkVFMFkw',
  'EwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE7aqe4swojUgmzO3DNUWarVuQtX9bdRNK',
  'WyaqPot9a7cTubqpAFqrz7jcfQ0NQpSkakUBamtESZsEaB1RyhbK2aNTMFEwHQYD',
  'VR0OBBYEFPElrORTjsDvkW9WcX+9un8canwSMB8GA1UdIwQYMBaAFPElrORTjsDv',
  'kW9WcX+9un8canwSMA8GA1UdEwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDSAAwRQIh',
  'AO562BFUJ1atm5R8V29lrbNHuPmY3CQ9vaMPcOclsmz/AiB/d/JoC6rgMw8Xdqz+',
  'Iz/3YA9p9SKn3kqs4CmOBTPH6A==',
  '-----END CERTIFICATE-----',
].join('\n')
const secrets = {
  MAC_CERT_P12_BASE64: Buffer.from('p12 bytes').toString('base64'),
  MAC_CERT_PASSWORD: 'p12-export-secret',
  APPLE_ID: 'release@example.com',
  APPLE_APP_SPECIFIC_PASSWORD: 'abcd-efgh-ijkl-mnop',
  APPLE_TEAM_ID: 'ABCDE12345',
}
const roots: string[] = []
function temporary(): string {
  const path = mkdtempSync(join(tmpdir(), 'macos-ci-signing-'))
  roots.push(path)
  return path
}
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }) })

describe('signing gate', () => {
  it('signs only when every secret is non-blank', () => {
    expect(macOSSigningGate(secrets)).toEqual({ signed: true, missing: [] })
    expect(macOSSigningGate({})).toEqual({ signed: false, missing: [...MACOS_SIGNING_SECRETS] })
    expect(macOSSigningGate({ ...secrets, APPLE_TEAM_ID: '', MAC_CERT_PASSWORD: '  \n' }))
      .toEqual({ signed: false, missing: ['MAC_CERT_PASSWORD', 'APPLE_TEAM_ID'] })
  })
})

describe('Developer ID identity', () => {
  it('returns the qualifier without the certificate kind prefix and unescapes the subject', () => {
    expect(developerIdIdentity([certificate], 'ABCDE12345')).toBe('Example Company OÜ, Ltd (ABCDE12345)')
  })

  it('rejects a missing certificate, another team, and an expired certificate', () => {
    expect(() => developerIdIdentity([], 'ABCDE12345')).toThrow('no Developer ID Application certificate')
    expect(() => developerIdIdentity([certificate], 'ZZZZZ99999')).toThrow('different team')
    expect(() => developerIdIdentity([certificate], 'ABCDE12345', new Date('2200-01-01'))).toThrow('expired')
  })
})

describe('dotenv output', () => {
  it.each(['plain-value', 'it\'s', 'both \' and "', 'a$b#c ${HOME}', 'back\\nslash', ' padded '])('round-trips %j', (value) => {
    expect(parseEnv(formatMacOSDotenv({ CSC_KEY_PASSWORD: value })).CSC_KEY_PASSWORD).toBe(value)
  })

  it('rejects values it cannot represent without echoing them', () => {
    expect(() => formatMacOSDotenv({ CSC_KEY_PASSWORD: 'line\nbreak' })).toThrow('CSC_KEY_PASSWORD cannot contain line breaks')
    expect(() => formatMacOSDotenv({ CSC_KEY_PASSWORD: '\'"`' })).toThrow(/^(?!.*'".*`).*every dotenv quote/u)
  })
})

describe('configure', () => {
  it('writes private credential files that the signed package configuration accepts', () => {
    const appRoot = temporary()
    const directory = join(temporary(), 'signing')
    const readCertificates = vi.fn(() => [certificate])
    const emit = vi.fn<(line: string) => void>()
    const { envFile, certificateFile } = configureMacOSSigning(
      { ...secrets, MAC_CERT_PASSWORD: `${secrets.MAC_CERT_PASSWORD}\n`, APPLE_ID: ` ${secrets.APPLE_ID} ` },
      { appRoot, directory, readCertificates, emit },
    )
    expect(readCertificates).toHaveBeenCalledWith(certificateFile, secrets.MAC_CERT_PASSWORD)
    expect(readFileSync(certificateFile, 'utf8')).toBe('p12 bytes')
    expect(statSync(directory).mode & 0o777).toBe(0o700)
    expect(statSync(certificateFile).mode & 0o777).toBe(0o600)
    expect(statSync(envFile).mode & 0o777).toBe(0o600)
    expect(emit.mock.calls.map(([line]) => line)).toEqual([
      `::add-mask::${secrets.MAC_CERT_PASSWORD}`, `::add-mask::${secrets.APPLE_ID}`, `::add-mask::${secrets.APPLE_APP_SPECIFIC_PASSWORD}`,
    ])
    const environment = loadDesktopPackageEnvironment('darwin', {}, appRoot)
    expect(environment).toMatchObject({
      DSH_DESKTOP_MACOS_SIGNING_IDENTITY: 'Example Company OÜ, Ltd (ABCDE12345)',
      DSH_DESKTOP_MACOS_TEAM_ID: 'ABCDE12345',
      CSC_LINK: certificateFile,
      CSC_KEY_PASSWORD: secrets.MAC_CERT_PASSWORD,
      APPLE_ID: secrets.APPLE_ID,
      APPLE_APP_SPECIFIC_PASSWORD: secrets.APPLE_APP_SPECIFIC_PASSWORD,
      APPLE_TEAM_ID: 'ABCDE12345',
    })
    expect(() => { validateDesktopPackageEnvironment(environment, { platform: 'darwin', arch: 'arm64' }) }).not.toThrow()
  })

  it('refuses to run with a missing secret or a malformed Team ID', () => {
    expect(() => configureMacOSSigning({ ...secrets, APPLE_ID: '' }, { appRoot: temporary(), emit: vi.fn() })).toThrow('missing secrets APPLE_ID')
    expect(() => configureMacOSSigning({ ...secrets, APPLE_TEAM_ID: 'abc' }, { appRoot: temporary(), emit: vi.fn() })).toThrow('10 uppercase')
  })
})

const openssl = spawnSync('openssl', ['version']).status === 0
it.skipIf(!openssl)('reads the certificate from a password-protected p12 without the password on argv', () => {
  const directory = temporary()
  const key = join(directory, 'key.pem')
  const cert = join(directory, 'cert.pem')
  const p12 = join(directory, 'identity.p12')
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', key, '-out', cert,
    '-days', '2', '-subj', '/CN=Developer ID Application: Example (ABCDE12345)/OU=ABCDE12345'], { stdio: 'ignore' })
  execFileSync('openssl', ['pkcs12', '-export', '-inkey', key, '-in', cert, '-out', p12, '-passout', 'pass:p12 secret'], { stdio: 'ignore' })
  const certificates = readP12Certificates(p12, 'p12 secret')
  expect(developerIdIdentity(certificates, 'ABCDE12345')).toBe('Example (ABCDE12345)')
  writeFileSync(p12, 'not a p12')
  expect(() => readP12Certificates(p12, 'p12 secret')).toThrow('OpenSSL could not read')
})
