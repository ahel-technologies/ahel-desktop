/**
 * Fetch the pinned Cua Driver for the packaged target into
 * `.desktop-build/targets/<target>/cua-driver/`, which electron-builder copies
 * to `Resources/cua-driver/`. The archive and the extracted executable must
 * match the hashes in `packages/computer-use/cua-driver/cua-driver.release.json`;
 * only the executable and its VERSION marker ship. Archives are cached in the
 * shared download cache, so a repeat build does not download again.
 */

import { join, resolve } from 'node:path'
import { rmSync } from 'node:fs'
import { installDriver, PINNED_RELEASE } from '../../../packages/computer-use/cua-driver/src/release.ts'
import { packagingStep } from './packaging-step.mjs'
import { resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'

/**
 * The release asset a packaged target ships.
 * @param target - desktop build target such as `mac-arm64`.
 * @returns the asset key, or undefined when the target ships no driver yet.
 */
export function cuaDriverAssetKey(target: string): string | undefined {
  // macOS first; the Windows build gets the pinned win32-x64 asset once its smoke exists.
  return target === 'mac-arm64' ? 'darwin-arm64' : target === 'mac-x64' ? 'darwin-x64' : undefined
}

/**
 * Prepare the driver for one packaged target.
 * @param target - desktop build target such as `mac-arm64`.
 * @returns the folder electron-builder copies, or undefined when the target ships no driver yet.
 */
export async function prepareCuaDriver(target = resolveDesktopBuildTarget()): Promise<string | undefined> {
  const key = cuaDriverAssetKey(target)
  const paths = resolveDesktopTargetBuildPaths()
  const output = join(paths.root, 'cua-driver')
  rmSync(output, { recursive: true, force: true })
  if (key === undefined) return undefined
  const asset = PINNED_RELEASE.assets[key]
  if (asset === undefined) throw new Error(`cua-driver: no pinned asset for ${key}`)
  await packagingStep(process.env.DSH_DESKTOP_PACKAGING_RUN_DIR, 'download:cua-driver', () => installDriver({
    release: PINNED_RELEASE,
    asset,
    cacheDir: join(paths.downloads, 'cua-driver', PINNED_RELEASE.version),
    outputDir: output,
    executable: 'cua-driver',
  }))
  return output
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  const output = await prepareCuaDriver()
  console.log(output === undefined ? 'cua-driver: this target ships no driver' : `cua-driver: ${PINNED_RELEASE.version} ready in ${output}`)
}
