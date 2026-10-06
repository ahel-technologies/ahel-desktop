/**
 * Turn the release workflow's Apple secrets into the local `.env.macos` the signed package command reads.
 * Usage from `.github/workflows/desktop-release.yml`:
 * `node apps/desktop/scripts/macos-ci-signing.mjs gate` writes `signed=true|false` to `$GITHUB_OUTPUT`;
 * `node apps/desktop/scripts/macos-ci-signing.mjs configure` decodes the p12 under `$RUNNER_TEMP` and writes `.env.macos`.
 * Neither command prints a secret value.
 */

import { execFileSync } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { appendFileSync, chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

/** GitHub Actions secrets that together enable a signed and notarized macOS build. */
export const MACOS_SIGNING_SECRETS = Object.freeze([
  'MAC_CERT_P12_BASE64',
  'MAC_CERT_PASSWORD',
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_TEAM_ID',
])

const APP_ROOT = fileURLToPath(new URL('..', import.meta.url))
const DEVELOPER_ID_PREFIX = 'Developer ID Application: '
const P12_PASSWORD_ENV = 'DSH_CI_P12_PASSWORD'

/**
 * Decide whether the release builds signed; any missing or blank secret selects the unsigned build.
 * @param {NodeJS.ProcessEnv} env - Step environment carrying the secrets.
 * @returns {{ signed: boolean, missing: string[] }} Mode and the names (never values) of absent secrets.
 */
export function macOSSigningGate(env) {
  const missing = MACOS_SIGNING_SECRETS.filter(name => (env[name] ?? '').trim() === '')
  return { signed: missing.length === 0, missing }
}

/**
 * Read one RFC 2253-escaped attribute from Node's multiline certificate subject.
 * @param {string} subject - `X509Certificate.subject`.
 * @param {string} key - Attribute name such as `CN`.
 * @returns {string | undefined} Unescaped value.
 */
function subjectField(subject, key) {
  const line = subject.split('\n').find(entry => entry.startsWith(`${key}=`))
  return line?.slice(key.length + 1).replace(/\\(.)/gu, '$1')
}

/**
 * Select the Developer ID Application certificate for the release team.
 * @param {readonly string[]} certificates - PEM certificates exported from the p12.
 * @param {string} teamId - Expected Apple Team ID.
 * @param {Date} now - Validity reference time.
 * @returns {string} electron-builder identity qualifier, `Name (TEAMID)`, without the `Developer ID Application:` prefix.
 */
export function developerIdIdentity(certificates, teamId, now = new Date()) {
  const identities = certificates.map(pem => new X509Certificate(pem))
    .map(certificate => ({ certificate, name: subjectField(certificate.subject, 'CN') ?? '', team: subjectField(certificate.subject, 'OU') }))
    .filter(entry => entry.name.startsWith(DEVELOPER_ID_PREFIX))
  if (identities.length === 0) {
    throw new Error('macOS CI signing: MAC_CERT_P12_BASE64 holds no Developer ID Application certificate')
  }
  const owned = identities.filter(entry => entry.team === teamId)
  if (owned.length === 0) {
    throw new Error('macOS CI signing: the Developer ID Application certificate belongs to a different team than APPLE_TEAM_ID')
  }
  const current = owned.filter(entry => new Date(entry.certificate.validFrom) <= now && now < new Date(entry.certificate.validTo))
  if (current.length === 0) {
    throw new Error('macOS CI signing: the Developer ID Application certificate is expired or not yet valid')
  }
  return current[0].name.slice(DEVELOPER_ID_PREFIX.length)
}

/**
 * Serialize settings so `util.parseEnv` reads back exactly the given values.
 * @param {Readonly<Record<string, string>>} settings - Setting names and values.
 * @returns {string} Dotenv text with one quoted line per setting.
 */
export function formatMacOSDotenv(settings) {
  const lines = Object.entries(settings).map(([name, value]) => {
    if (/[\r\n\0]/u.test(value)) throw new Error(`macOS CI signing: ${name} cannot contain line breaks or NUL characters`)
    for (const quote of ["'", '"', '`']) {
      if (value.includes(quote)) continue
      const line = `${name}=${quote}${value}${quote}`
      if (parseEnv(line)[name] === value) return line
    }
    throw new Error(`macOS CI signing: ${name} cannot be written to .env.macos; it contains every dotenv quote character`)
  })
  return `${lines.join('\n')}\n`
}

/**
 * Extract the certificates from a password-protected p12 with OpenSSL.
 * Tries OpenSSL 3 as is, OpenSSL 3 with the legacy provider (Keychain Access RC2 exports), then macOS LibreSSL.
 * @param {string} p12Path - Decoded p12 file.
 * @param {string} password - p12 export password; passed through the environment, never argv.
 * @returns {string[]} PEM certificates.
 */
export function readP12Certificates(p12Path, password) {
  const attempts = [['openssl', []], ['openssl', ['-legacy']], ['/usr/bin/openssl', []]]
  for (const [command, extra] of attempts) {
    let output
    try {
      output = execFileSync(command, ['pkcs12', ...extra, '-in', p12Path, '-nokeys', '-passin', `env:${P12_PASSWORD_ENV}`], {
        env: { ...process.env, [P12_PASSWORD_ENV]: password }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000,
      })
    }
    catch { continue } // A wrong provider or password fails here; the next attempt or the final error covers it.
    const certificates = output.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/gu) ?? []
    if (certificates.length > 0) return certificates
  }
  throw new Error('macOS CI signing: OpenSSL could not read MAC_CERT_P12_BASE64; check MAC_CERT_PASSWORD and that the export is a p12 with the certificate and its private key')
}

/**
 * Decode the p12 into a private directory and write the `.env.macos` the signed package command reads.
 * The package command then owns the temporary keychain: create, import, partition list, probe, delete.
 * @param {NodeJS.ProcessEnv} env - Step environment carrying all signing secrets.
 * @param {{ appRoot?: string, directory?: string, readCertificates?: typeof readP12Certificates, emit?: (line: string) => void }} options - Paths and injectable helpers.
 * @returns {{ envFile: string, certificateFile: string }} Written credential files, both mode 0600.
 */
export function configureMacOSSigning(env, options = {}) {
  const { missing } = macOSSigningGate(env)
  if (missing.length > 0) throw new Error(`macOS CI signing: missing secrets ${missing.join(', ')}`)
  // Workflow commands are only interpreted on Actions runners; elsewhere they would print the values.
  const emit = options.emit ?? (line => { if (env.GITHUB_ACTIONS === 'true') process.stdout.write(`${line}\n`) })
  const stripLineEnd = value => value.replace(/[\r\n]+$/u, '')
  const password = stripLineEnd(env.MAC_CERT_PASSWORD)
  const appleId = env.APPLE_ID.trim()
  const appPassword = env.APPLE_APP_SPECIFIC_PASSWORD.trim()
  const teamId = env.APPLE_TEAM_ID.trim()
  // GitHub masks each stored secret; these lines also mask the normalized forms written below.
  for (const value of [password, appleId, appPassword]) emit(`::add-mask::${value}`)
  if (!/^[A-Z0-9]{10}$/u.test(teamId)) throw new Error('macOS CI signing: APPLE_TEAM_ID must contain 10 uppercase letters or digits')
  const p12 = Buffer.from(env.MAC_CERT_P12_BASE64.replace(/\s+/gu, ''), 'base64')
  if (p12.length === 0) throw new Error('macOS CI signing: MAC_CERT_P12_BASE64 is not Base64')
  const directory = options.directory ?? join(env.RUNNER_TEMP ?? tmpdir(), 'ahel-macos-signing')
  rmSync(directory, { recursive: true, force: true })
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  chmodSync(directory, 0o700)
  const certificateFile = join(directory, 'developer-id.p12')
  writeFileSync(certificateFile, p12, { mode: 0o600 })
  const identity = developerIdIdentity((options.readCertificates ?? readP12Certificates)(certificateFile, password), teamId)
  const envFile = join(options.appRoot ?? APP_ROOT, '.env.macos')
  writeFileSync(envFile, formatMacOSDotenv({
    DSH_DESKTOP_MACOS_SIGNING_IDENTITY: identity,
    DSH_DESKTOP_MACOS_TEAM_ID: teamId,
    CSC_LINK: certificateFile,
    CSC_KEY_PASSWORD: password,
    APPLE_ID: appleId,
    APPLE_APP_SPECIFIC_PASSWORD: appPassword,
    APPLE_TEAM_ID: teamId,
  }), { mode: 0o600 })
  chmodSync(envFile, 0o600)
  return { envFile, certificateFile }
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  const command = process.argv[2]
  if (command === 'gate') {
    const { signed, missing } = macOSSigningGate(process.env)
    if (signed) process.stdout.write('macOS signing: all signing secrets are set; this release is signed and notarized\n')
    else if (missing.length === MACOS_SIGNING_SECRETS.length) process.stdout.write('macOS signing: no signing secrets; this release is unsigned\n')
    else process.stdout.write(`::warning::macOS signing: missing ${missing.join(', ')}; this release is unsigned\n`)
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `signed=${String(signed)}\n`)
  } else if (command === 'configure') {
    configureMacOSSigning(process.env)
    process.stdout.write('macOS signing: wrote .env.macos and the p12 for the Developer ID Application identity of APPLE_TEAM_ID\n')
  } else {
    throw new Error('usage: node apps/desktop/scripts/macos-ci-signing.mjs gate|configure')
  }
}
