import { execFileSync, spawnSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MACOS_SIGNING_SECRETS,
  configureMacOSSigning,
  decodeAppStoreConnectKey,
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
// Throwaway P-256 key in the PKCS#8 PEM form App Store Connect downloads as AuthKey_<id>.p8.
const apiKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const secrets = {
  APPLE_CERT_P12_BASE64: Buffer.from('p12 bytes').toString('base64'),
  APPLE_CERT_PASSWORD: 'p12-export-secret',
  APPLE_TEAM_ID: 'ABCDE12345',
  ASC_KEY_ID: 'KEYID12345',
  ASC_ISSUER_ID: '69a6de7e-0000-47e3-e053-5b8c7c11a4d1',
  ASC_KEY_P8_BASE64: Buffer.from(apiKey).toString('base64'),
}
const roots: string[] = []
function temporary(): string {
  const path = mkdtempSync(join(tmpdir(), 'macos-ci-signing-'))
  roots.push(path)
  return path
}
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }) })

describe('signing gate', () => {
  it('selects full signing only when every secret is non-blank', () => {
    expect(macOSSigningGate(secrets)).toEqual({ signing: 'full', missing: [] })
    expect(macOSSigningGate({})).toEqual({ signing: 'dry', missing: [...MACOS_SIGNING_SECRETS] })
    expect(macOSSigningGate({ ...secrets, ASC_ISSUER_ID: '', APPLE_CERT_PASSWORD: '  \n' }))
      .toEqual({ signing: 'dry', missing: ['APPLE_CERT_PASSWORD', 'ASC_ISSUER_ID'] })
  })

  it('reports the mode and the missing names to the workflow without values', () => {
    const directory = temporary()
    const output = join(directory, 'output')
    const summary = join(directory, 'summary')
    const run = (env: Record<string, string>) => execFileSync(process.execPath, [join(import.meta.dirname, '../scripts/macos-ci-signing.mjs'), 'gate'], {
      env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary, ...env }, encoding: 'utf8',
    })
    run({})
    run({ ...secrets, ASC_KEY_P8_BASE64: '' })
    const stdout = run(secrets)
    expect(readFileSync(output, 'utf8')).toBe('signing=dry\nsigning=dry\nsigning=full\n')
    expect(readFileSync(summary, 'utf8')).toBe([
      'Unsigned build: Apple secrets absent',
      'Unsigned build: Apple secrets absent (missing ASC_KEY_P8_BASE64)',
      'Signed build: Developer ID signature, notarization and stapled tickets', '',
    ].join('\n'))
    for (const value of Object.values(secrets)) expect(stdout).not.toContain(value)
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

describe('App Store Connect key', () => {
  it('decodes a Base64 .p8 and rejects other input without echoing it', () => {
    expect(decodeAppStoreConnectKey(`${secrets.ASC_KEY_P8_BASE64.slice(0, 20)}\n${secrets.ASC_KEY_P8_BASE64.slice(20)}`).toString()).toBe(apiKey)
    expect(() => decodeAppStoreConnectKey(Buffer.from('not a key').toString('base64'))).toThrow(/^(?!.*not a key).*ASC_KEY_P8_BASE64 is not/u)
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    expect(() => decodeAppStoreConnectKey(Buffer.from(rsa).toString('base64'))).toThrow('ASC_KEY_P8_BASE64 is not')
  })
})

describe('configure', () => {
  it('writes private credential files that the signed package configuration accepts', () => {
    const appRoot = temporary()
    const directory = join(temporary(), 'signing')
    const readCertificates = vi.fn(() => [certificate])
    const emit = vi.fn<(line: string) => void>()
    const { envFile, certificateFile, apiKeyFile } = configureMacOSSigning(
      { ...secrets, APPLE_CERT_PASSWORD: `${secrets.APPLE_CERT_PASSWORD}\n`, ASC_KEY_ID: ` ${secrets.ASC_KEY_ID} ` },
      { appRoot, directory, readCertificates, emit },
    )
    expect(readCertificates).toHaveBeenCalledWith(certificateFile, secrets.APPLE_CERT_PASSWORD)
    expect(readFileSync(certificateFile, 'utf8')).toBe('p12 bytes')
    expect(readFileSync(apiKeyFile, 'utf8')).toBe(apiKey)
    expect(apiKeyFile).toBe(join(directory, 'AuthKey_KEYID12345.p8'))
    expect(statSync(directory).mode & 0o777).toBe(0o700)
    for (const file of [certificateFile, apiKeyFile, envFile]) expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(emit.mock.calls.map(([line]) => line)).toEqual([`::add-mask::${secrets.APPLE_CERT_PASSWORD}`])
    const environment = loadDesktopPackageEnvironment('darwin', {}, appRoot)
    expect(environment).toMatchObject({
      DSH_DESKTOP_MACOS_SIGNING_IDENTITY: 'Example Company OÜ, Ltd (ABCDE12345)',
      DSH_DESKTOP_MACOS_TEAM_ID: 'ABCDE12345',
      CSC_LINK: certificateFile,
      CSC_KEY_PASSWORD: secrets.APPLE_CERT_PASSWORD,
      APPLE_API_KEY: apiKeyFile,
      APPLE_API_KEY_ID: secrets.ASC_KEY_ID,
      APPLE_API_ISSUER: secrets.ASC_ISSUER_ID,
    })
    expect(environment).not.toHaveProperty('APPLE_TEAM_ID')
    expect(() => { validateDesktopPackageEnvironment(environment, { platform: 'darwin', arch: 'arm64' }) }).not.toThrow()
  })

  it('refuses to run with a missing secret or a malformed identifier', () => {
    const run = (env: Record<string, string>) => () => configureMacOSSigning(env, { appRoot: temporary(), emit: vi.fn() })
    expect(run({ ...secrets, ASC_KEY_ID: '' })).toThrow('missing secrets ASC_KEY_ID')
    expect(run({ ...secrets, APPLE_TEAM_ID: 'abc' })).toThrow('APPLE_TEAM_ID must contain 10 uppercase')
    expect(run({ ...secrets, ASC_KEY_ID: 'short' })).toThrow('ASC_KEY_ID must contain 10 uppercase')
    expect(run({ ...secrets, ASC_ISSUER_ID: 'issuer' })).toThrow('ASC_ISSUER_ID must be a UUID')
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
