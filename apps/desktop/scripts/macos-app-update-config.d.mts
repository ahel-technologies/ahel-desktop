/** Resolved GitHub releases feed embedded into a macOS application. */
export interface MacOSAppUpdateFeed {
  readonly owner: string
  readonly repo: string
  readonly releaseType: string
}

/** Packaged electron-updater configuration for macOS, matching what electron-builder writes for GitHub. */
export interface MacOSAppUpdateConfig {
  readonly owner: string
  readonly repo: string
  readonly provider: 'github'
  readonly releaseType: string
  readonly updaterCacheDirName: string
}

/** Resolve the one GitHub releases feed from the final electron-builder configuration. */
export function resolveMacOSAppUpdateFeed(publish: unknown): MacOSAppUpdateFeed

/** Create the electron-updater configuration embedded before code signing. */
export function createMacOSAppUpdateConfig(
  update: MacOSAppUpdateFeed,
  updaterCacheDirName: string,
): MacOSAppUpdateConfig

/** Write the updater configuration into an assembled App before signing. */
export function writeMacOSAppUpdateConfig(
  resourcesDir: string,
  update: MacOSAppUpdateFeed,
  updaterCacheDirName: string,
): Promise<void>

/** Verify the updater configuration inside an assembled macOS App. */
export function verifyMacOSAppUpdateConfig(
  appPath: string,
  update: MacOSAppUpdateFeed,
  updaterCacheDirName?: string,
): Promise<void>
