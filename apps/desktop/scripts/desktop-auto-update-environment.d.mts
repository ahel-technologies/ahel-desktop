/** Public GitHub repository whose releases carry the Desktop update metadata and installers. */
export const DESKTOP_UPDATE_REPOSITORY: { readonly owner: 'ahel-technologies', readonly repo: 'ahel-desktop-releases' }

/** Directory name of one supported Desktop release target. */
export type DesktopAutoUpdateTarget = 'mac-arm64' | 'mac-x64' | 'win-x64'

/** electron-builder GitHub provider embedded as the packaged application's update feed. */
export interface DesktopUpdatePublishProvider {
  readonly provider: 'github'
  readonly owner: 'ahel-technologies'
  readonly repo: 'ahel-desktop-releases'
  readonly releaseType: 'release'
}

/**
 * Create the electron-builder publish setting that every packaged application embeds as `app-update.yml`.
 * @returns One GitHub provider reading full releases; packaging never publishes with it.
 */
export function desktopUpdatePublishConfig(): [DesktopUpdatePublishProvider]

/**
 * Return the local completion record filename for one packaged target.
 * @param target - Supported release target.
 * @returns Filename stored beside electron-builder artifacts.
 */
export function desktopBuildRecordFilename(target: DesktopAutoUpdateTarget): string

/**
 * Return the electron-builder `latest` channel metadata filename for an application version.
 * @param version - Desktop semantic version.
 * @param platform - Target platform.
 * @returns Channel metadata filename emitted for the target.
 */
export function desktopUpdateMetadataFilename(
  version: string,
  platform: NodeJS.Platform,
): string
