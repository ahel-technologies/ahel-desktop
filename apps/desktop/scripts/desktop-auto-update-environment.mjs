/** Name the Desktop release targets and the GitHub Releases feed that electron-updater reads. */

import { valid } from 'semver'

/** GitHub repository whose published releases carry the Desktop update metadata and installers. */
export const DESKTOP_UPDATE_REPOSITORY = Object.freeze({ owner: 'ahel-technologies', repo: 'ahel-desktop' })

const UPDATE_TARGETS = new Set(['mac-arm64', 'mac-x64', 'win-x64'])

/**
 * Create the electron-builder publish setting that every packaged application embeds as `app-update.yml`.
 * Packaging never publishes: `package-target.ts` passes `--publish never`, so this only selects the feed.
 * @returns {[{ provider: 'github', owner: 'ahel-technologies', repo: 'ahel-desktop', releaseType: 'release' }]} One GitHub provider reading full releases.
 */
export function desktopUpdatePublishConfig() {
  return [{ provider: 'github', ...DESKTOP_UPDATE_REPOSITORY, releaseType: 'release' }]
}

/**
 * Return the local completion record filename for one packaged target.
 * @param {'mac-arm64' | 'mac-x64' | 'win-x64'} target - Supported release target.
 * @returns {string} Filename stored beside electron-builder artifacts.
 */
export function desktopBuildRecordFilename(target) {
  if (!UPDATE_TARGETS.has(target)) {
    throw new Error(`desktop auto-update: unsupported target ${target}`)
  }
  return `${target}-release.json`
}

/**
 * Return the electron-builder `latest` channel metadata filename for an application version.
 * @param {string} version - Desktop semantic version.
 * @param {NodeJS.Platform} platform - Target platform.
 * @returns {string} Channel metadata filename emitted for the target.
 */
export function desktopUpdateMetadataFilename(version, platform) {
  if (valid(version) === null) {
    throw new Error(`desktop auto-update: invalid Desktop version ${JSON.stringify(version)}`)
  }
  if (platform !== 'darwin' && platform !== 'win32') {
    throw new Error(`desktop auto-update: unsupported metadata platform ${platform}`)
  }
  return `latest${platform === 'darwin' ? '-mac' : ''}.yml`
}
