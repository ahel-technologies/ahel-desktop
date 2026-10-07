/**
 * Turn the release workflow's Apple secrets into the local `.env.macos` the signed package command reads.
 * Usage from `.github/workflows/desktop-release.yml`:
 * `node apps/desktop/scripts/macos-ci-signing.mjs gate` writes `signing=full|dry` to `$GITHUB_OUTPUT` and one line to `$GITHUB_STEP_SUMMARY`;
 * `node apps/desktop/scripts/macos-ci-signing.mjs configure` decodes the p12 and the App Store Connect API key under `$RUNNER_TEMP` and writes `.env.macos`.
 * Neither command prints a secret value.
 */

import { execFileSync } from 'node:child_process'
import { X509Certificate, createPrivateKey } from 'node:crypto'
import { appendFileSync, chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

/** GitHub Actions secrets that together enable a signed and notarized macOS build. */
export const MACOS_SIGNING_SECRETS = Object.freeze([
  'APPLE_CERT_P12_BASE64',
  'APPLE_CERT_PASSWORD',
  'APPLE_TEAM_ID',
  'ASC_KEY_ID',
  'ASC_ISSUER_ID',
  'ASC_KEY_P8_BASE64',
])

/** Step-summary line of a release built while any Apple secret is absent. */
export const UNSIGNED_SUMMARY = 'Unsigned build: Apple secrets absent'

const APP_ROOT = fileURLToPath(new URL('..', import.meta.url))
const DEVELOPER_ID_PREFIX = 'Developer ID Application: '
const P12_PASSWORD_ENV = 'DSH_CI_P12_PASSWORD'

/**
 * Decide the signing mode; any missing or blank secret selects the unsigned `dry` build.
 * @param {NodeJS.ProcessEnv} env - Step environment carrying the secrets.
 * @returns {{ signing: 'full' | 'dry', missing: string[] }} Mode and the names (never values) of absent secrets.
 */
export function macOSSigningGate(env) {
  const missing = MACOS_SIGNING_SECRETS.filter(name => (env[name] ?? '').trim() === '')
  return { signing: missing.length === 0 ? 'full' : 'dry', missing }
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
    throw new Error('macOS CI signing: APPLE_CERT_P12_BASE64 holds no Developer ID Application certificate')
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
  throw new Error('macOS CI signing: OpenSSL could not read APPLE_CERT_P12_BASE64; check APPLE_CERT_PASSWORD and that the export is a p12 with the certificate and its private key')
}

/**
 * Decode the App Store Connect API key that notarytool reads from a file.
 * @param {string} base64 - `ASC_KEY_P8_BASE64`, the Base64 of the downloaded `AuthKey_<id>.p8`.
 * @returns {Buffer} PEM PKCS#8 private key bytes.
 */
export function decodeAppStoreConnectKey(base64) {
  const key = Buffer.from(base64.replace(/\s+/gu, ''), 'base64')
  try {
    if (createPrivateKey(key).asymmetricKeyType !== 'ec') throw new Error('not an EC key')
  }
  catch {
    // Parser errors can quote key material.
    throw new Error('macOS CI signing: ASC_KEY_P8_BASE64 is not the Base64 of an App Store Connect API key (.p8)')
  }
  return key
}

/**
 * Decode the p12 and the API key into a private directory and write the `.env.macos` the signed package command reads.
 * The package command then owns the temporary keychain: create with a random password, import, partition list, search list, probe, delete.
 * @param {NodeJS.ProcessEnv} env - Step environment carrying all signing secrets.
 * @param {{ appRoot?: string, directory?: string, readCertificates?: typeof readP12Certificates, emit?: (line: string) => void }} options - Paths and injectable helpers.
 * @returns {{ envFile: string, certificateFile: string, apiKeyFile: string }} Written credential files, all mode 0600.
 */
export function configureMacOSSigning(env, options = {}) {
  const { missing } = macOSSigningGate(env)
  if (missing.length > 0) throw new Error(`macOS CI signing: missing secrets ${missing.join(', ')}`)
  // Workflow commands are only interpreted on Actions runners; elsewhere they would print the values.
  const emit = options.emit ?? (line => { if (env.GITHUB_ACTIONS === 'true') process.stdout.write(`${line}\n`) })
  const password = env.APPLE_CERT_PASSWORD.replace(/[\r\n]+$/u, '')
  const teamId = env.APPLE_TEAM_ID.trim()
  const keyId = env.ASC_KEY_ID.trim()
  const issuerId = env.ASC_ISSUER_ID.trim()
  // GitHub masks each stored secret; this also masks the normalized password written below.
  emit(`::add-mask::${password}`)
  if (!/^[A-Z0-9]{10}$/u.test(teamId)) throw new Error('macOS CI signing: APPLE_TEAM_ID must contain 10 uppercase letters or digits')
  if (!/^[A-Z0-9]{10}$/u.test(keyId)) throw new Error('macOS CI signing: ASC_KEY_ID must contain 10 uppercase letters or digits')
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(issuerId)) throw new Error('macOS CI signing: ASC_ISSUER_ID must be a UUID')
  const p12 = Buffer.from(env.APPLE_CERT_P12_BASE64.replace(/\s+/gu, ''), 'base64')
  if (p12.length === 0) throw new Error('macOS CI signing: APPLE_CERT_P12_BASE64 is not Base64')
  const apiKey = decodeAppStoreConnectKey(env.ASC_KEY_P8_BASE64)
  const directory = options.directory ?? join(env.RUNNER_TEMP ?? tmpdir(), 'ahel-macos-signing')
  rmSync(directory, { recursive: true, force: true })
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  chmodSync(directory, 0o700)
  const certificateFile = join(directory, 'developer-id.p12')
  writeFileSync(certificateFile, p12, { mode: 0o600 })
  const apiKeyFile = join(directory, `AuthKey_${keyId}.p8`)
  writeFileSync(apiKeyFile, apiKey, { mode: 0o600 })
  const identity = developerIdIdentity((options.readCertificates ?? readP12Certificates)(certificateFile, password), teamId)
  const envFile = join(options.appRoot ?? APP_ROOT, '.env.macos')
  // APPLE_TEAM_ID stays out: in .env.macos it selects the Apple ID notarization strategy.
  writeFileSync(envFile, formatMacOSDotenv({
    DSH_DESKTOP_MACOS_SIGNING_IDENTITY: identity,
    DSH_DESKTOP_MACOS_TEAM_ID: teamId,
    CSC_LINK: certificateFile,
    CSC_KEY_PASSWORD: password,
    APPLE_API_KEY: apiKeyFile,
    APPLE_API_KEY_ID: keyId,
    APPLE_API_ISSUER: issuerId,
  }), { mode: 0o600 })
  chmodSync(envFile, 0o600)
  return { envFile, certificateFile, apiKeyFile }
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  const command = process.argv[2]
  if (command === 'gate') {
    const { signing, missing } = macOSSigningGate(process.env)
    if (signing === 'full') process.stdout.write('macOS signing: full; all six Apple secrets are set; this release is signed and notarized\n')
    else if (missing.length === MACOS_SIGNING_SECRETS.length) process.stdout.write('macOS signing: dry; no Apple secrets; this release is unsigned\n')
    else process.stdout.write(`::warning::macOS signing: dry; missing ${missing.join(', ')}; this release is unsigned\n`)
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `signing=${signing}\n`)
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, signing === 'full'
        ? 'Signed build: Developer ID signature, notarization and stapled tickets\n'
        : `${UNSIGNED_SUMMARY}${missing.length === MACOS_SIGNING_SECRETS.length ? '' : ` (missing ${missing.join(', ')})`}\n`)
    }
  } else if (command === 'configure') {
    configureMacOSSigning(process.env)
    process.stdout.write('macOS signing: wrote .env.macos, the p12 for the Developer ID Application identity of APPLE_TEAM_ID, and the App Store Connect API key\n')
  } else {
    throw new Error('usage: node apps/desktop/scripts/macos-ci-signing.mjs gate|configure')
  }
}
