/** Release-workflow gate and `.env.macos` writer for macOS Developer ID signing. */

/** GitHub Actions secrets that together enable a signed and notarized macOS build. */
export const MACOS_SIGNING_SECRETS: readonly ['MAC_CERT_P12_BASE64', 'MAC_CERT_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']

/**
 * Decide whether the release builds signed; any missing or blank secret selects the unsigned build.
 * @param env Step environment carrying the secrets.
 * @returns Mode and the names (never values) of absent secrets.
 */
export function macOSSigningGate(env: NodeJS.ProcessEnv): { signed: boolean, missing: string[] }

/**
 * Select the Developer ID Application certificate for the release team.
 * @param certificates PEM certificates exported from the p12.
 * @param teamId Expected Apple Team ID.
 * @param now Validity reference time.
 * @returns electron-builder identity qualifier, `Name (TEAMID)`, without the `Developer ID Application:` prefix.
 */
export function developerIdIdentity(certificates: readonly string[], teamId: string, now?: Date): string

/**
 * Serialize settings so `util.parseEnv` reads back exactly the given values.
 * @param settings Setting names and values.
 * @returns Dotenv text with one quoted line per setting.
 */
export function formatMacOSDotenv(settings: Readonly<Record<string, string>>): string

/**
 * Extract the certificates from a password-protected p12 with OpenSSL.
 * @param p12Path Decoded p12 file.
 * @param password p12 export password; passed through the environment, never argv.
 * @returns PEM certificates.
 */
export function readP12Certificates(p12Path: string, password: string): string[]

/**
 * Decode the p12 into a private directory and write the `.env.macos` the signed package command reads.
 * @param env Step environment carrying all signing secrets.
 * @param options Paths and injectable helpers.
 * @returns Written credential files, both mode 0600.
 */
export function configureMacOSSigning(env: NodeJS.ProcessEnv, options?: {
  appRoot?: string
  directory?: string
  readCertificates?: typeof readP12Certificates
  emit?: (line: string) => void
}): { envFile: string, certificateFile: string }
