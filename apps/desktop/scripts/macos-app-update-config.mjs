/**
 * Write and verify the updater configuration sealed into a macOS application.
 *
 * electron-builder writes `app-update.yml` itself only when a macOS build includes a DMG or ZIP target.
 * Signed releases first build a `--dir` application and later wrap copies of it, so the configuration
 * is written here before signing and verified on every copy. The fields mirror what electron-builder
 * writes for a GitHub provider.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dump, load } from 'js-yaml'

const CONFIG_FILENAME = 'app-update.yml'

function object(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`desktop macOS update config: ${label} must be an object`)
  }
  return value
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`desktop macOS update config: ${label} must be a non-empty string`)
  }
  return value
}

/**
 * Resolve the one GitHub releases feed from the final electron-builder configuration.
 * @param {unknown} publish - Final electron-builder publish setting.
 * @returns {{ owner: string, repo: string, releaseType: string }} Feed read by the packaged App.
 */
export function resolveMacOSAppUpdateFeed(publish) {
  if (!Array.isArray(publish) || publish.length !== 1) {
    throw new Error('desktop macOS update config: publish must contain exactly one provider')
  }
  const provider = object(publish[0], 'publish provider')
  if (provider.provider !== 'github' || provider.releaseType !== 'release') {
    throw new Error('desktop macOS update config: publish provider must be GitHub releases')
  }
  return {
    owner: nonEmptyString(provider.owner, 'publish provider owner'),
    repo: nonEmptyString(provider.repo, 'publish provider repo'),
    releaseType: provider.releaseType,
  }
}

/**
 * Create the electron-updater configuration embedded before code signing.
 * @param {{ owner: string, repo: string, releaseType: string }} update - Resolved update feed.
 * @param {string} updaterCacheDirName - electron-builder application cache directory.
 * @returns {{ owner: string, repo: string, provider: 'github', releaseType: string, updaterCacheDirName: string }} Packaged updater fields.
 */
export function createMacOSAppUpdateConfig(update, updaterCacheDirName) {
  return {
    owner: nonEmptyString(update.owner, 'owner'),
    repo: nonEmptyString(update.repo, 'repo'),
    provider: 'github',
    releaseType: nonEmptyString(update.releaseType, 'release type'),
    updaterCacheDirName: nonEmptyString(updaterCacheDirName, 'updater cache directory'),
  }
}

/**
 * Write the updater configuration into an assembled App before signing.
 * @param {string} resourcesDir - App Contents/Resources directory.
 * @param {{ owner: string, repo: string, releaseType: string }} update - Resolved update feed.
 * @param {string} updaterCacheDirName - electron-builder application cache directory.
 * @returns {Promise<void>} Resolves after the configuration is written.
 */
export async function writeMacOSAppUpdateConfig(resourcesDir, update, updaterCacheDirName) {
  const config = createMacOSAppUpdateConfig(update, updaterCacheDirName)
  await writeFile(join(resourcesDir, CONFIG_FILENAME), dump(config, { lineWidth: -1, noRefs: true }))
}

/**
 * Verify the updater configuration inside an assembled macOS App.
 * @param {string} appPath - Application bundle path.
 * @param {{ owner: string, repo: string, releaseType: string }} update - Expected update feed.
 * @param {string | undefined} updaterCacheDirName - Exact cache directory when known.
 * @returns {Promise<void>} Resolves when the packaged configuration names the expected repository.
 */
export async function verifyMacOSAppUpdateConfig(appPath, update, updaterCacheDirName = undefined) {
  const path = join(appPath, 'Contents', 'Resources', CONFIG_FILENAME)
  let parsed
  try {
    parsed = load(await readFile(path, 'utf8'))
  }
  catch (error) {
    throw new Error(`desktop macOS update config: cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const config = object(parsed, CONFIG_FILENAME)
  if (config.provider !== 'github' || config.owner !== update.owner || config.repo !== update.repo
    || config.releaseType !== update.releaseType) {
    throw new Error(`desktop macOS update config: ${path} does not match GitHub releases of ${update.owner}/${update.repo}`)
  }
  const actualCacheDirName = nonEmptyString(config.updaterCacheDirName, `${CONFIG_FILENAME}.updaterCacheDirName`)
  if (updaterCacheDirName !== undefined && actualCacheDirName !== updaterCacheDirName) {
    throw new Error(`desktop macOS update config: ${path} has updater cache directory ${actualCacheDirName}; expected ${updaterCacheDirName}`)
  }
}
