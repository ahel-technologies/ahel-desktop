/**
 * The one Cua Driver release Ahel Desktop runs, pinned in `cua-driver.release.json`
 * (version, download URL, archive and executable sha256), and the verified
 * install of that release. The packaging script and the Host both install
 * through {@link installDriver}, so a driver that runs always matches the pin.
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** One downloadable driver build and the hashes it must match. */
export interface DriverAsset {
  /** Archive file name under {@link DriverRelease.baseUrl}. */
  readonly archive: string
  readonly archiveSha256: string
  /** Executable path inside the archive. */
  readonly binary: string
  /** sha256 of the executable as it ships in the archive, before any re-signing. */
  readonly binarySha256: string
}

/** The pinned release file. */
export interface DriverRelease {
  readonly version: string
  readonly tag: string
  readonly baseUrl: string
  /** Builds keyed by `<platform>-<arch>`, such as `darwin-arm64`. */
  readonly assets: Readonly<Record<string, DriverAsset>>
}

/** The pinned release, read from the package's `cua-driver.release.json`. */
export const PINNED_RELEASE: DriverRelease = JSON.parse(
  readFileSync(new URL('../cua-driver.release.json', import.meta.url), 'utf8'),
) as DriverRelease

/** The Cua Driver version this package expects. */
export const PINNED_DRIVER_VERSION: string = PINNED_RELEASE.version

/** Marker written next to an installed executable; it names the installed version. */
export const VERSION_FILE = 'VERSION'

/**
 * The release asset key for one operating system and CPU.
 * @param platform - Node platform.
 * @param arch - Node architecture.
 * @returns the key in {@link DriverRelease.assets}, such as `darwin-arm64`.
 */
export function assetKey(platform: NodeJS.Platform, arch: string): string {
  return `${platform}-${arch}`
}

/**
 * sha256 of one file.
 * @param path - file to hash.
 * @returns lowercase hex digest.
 */
export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** Downloads one URL into memory; tests replace it. */
export type Fetcher = (url: string) => Promise<Uint8Array>

/** Default fetcher: HTTPS GET with redirects (GitHub release assets redirect to object storage). */
export const fetchBytes: Fetcher = async (url) => {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`cua-driver: download failed with HTTP ${String(response.status)}: ${url}`)
  return new Uint8Array(await response.arrayBuffer())
}

/** Options of {@link installDriver}. */
export interface InstallOptions {
  readonly release: DriverRelease
  readonly asset: DriverAsset
  /** Folder that keeps downloaded archives between installs. */
  readonly cacheDir: string
  /** Folder that receives the executable and its {@link VERSION_FILE}. */
  readonly outputDir: string
  /** Executable name in `outputDir`. */
  readonly executable: string
  readonly fetch?: Fetcher
}

/**
 * Install the pinned driver: reuse `outputDir` when its executable still
 * matches the pinned hash, otherwise download the archive (or reuse the cached
 * one when its hash matches), extract only the executable, and check both
 * hashes before the executable is moved into place.
 * @param options - release, asset, folders and fetcher.
 * @returns the absolute path of the verified executable.
 */
export async function installDriver(options: InstallOptions): Promise<string> {
  const { release, asset, cacheDir, outputDir } = options
  const target = join(outputDir, options.executable)
  if (existsSync(target) && sha256File(target) === asset.binarySha256) return target
  mkdirSync(cacheDir, { recursive: true })
  const archive = join(cacheDir, asset.archive)
  if (!existsSync(archive) || sha256File(archive) !== asset.archiveSha256) {
    const url = new URL(asset.archive, release.baseUrl).href
    const bytes = await (options.fetch ?? fetchBytes)(url)
    const actual = createHash('sha256').update(bytes).digest('hex')
    if (actual !== asset.archiveSha256) throw new Error(`cua-driver: ${url} has sha256 ${actual}, expected ${asset.archiveSha256}`)
    writeFileSync(`${archive}.partial`, bytes)
    renameSync(`${archive}.partial`, archive)
  }
  mkdirSync(outputDir, { recursive: true })
  const scratch = mkdtempSync(join(outputDir, '.extract-'))
  try {
    await extract(archive, scratch, asset.binary)
    const extracted = join(scratch, asset.binary)
    const actual = sha256File(extracted)
    if (actual !== asset.binarySha256) throw new Error(`cua-driver: ${asset.binary} has sha256 ${actual}, expected ${asset.binarySha256}`)
    chmodSync(extracted, 0o755)
    copyFileSync(extracted, `${target}.partial`)
    chmodSync(`${target}.partial`, 0o755)
    renameSync(`${target}.partial`, target)
    writeFileSync(join(outputDir, VERSION_FILE), `${release.version}\n`)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  return target
}

/**
 * Read the version marker next to an installed executable.
 * @param folder - the executable's folder.
 * @returns the installed version, or undefined without a marker.
 */
export function installedVersion(folder: string): string | undefined {
  const file = join(folder, VERSION_FILE)
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : undefined
}

/** `tar` reads both the macOS `.tar.gz` and the Windows `.zip` assets (bsdtar ships with macOS and Windows 10+). */
function extract(archive: string, into: string, member: string): Promise<void> {
  const args = archive.endsWith('.zip') ? ['-xf', archive, '-C', into, member] : ['-xzf', archive, '-C', into, member]
  return new Promise((resolve, reject) => {
    execFile('tar', args, { timeout: 120_000 }, (error) => {
      if (error !== null) reject(new Error(`cua-driver: could not extract ${member}: ${error.message}`, { cause: error }))
      else resolve()
    })
  })
}
