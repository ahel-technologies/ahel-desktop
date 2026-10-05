/** Load platform-local release settings without changing the caller's process environment. */

/**
 * Read the target's UTF-8 dotenv file; release settings never fall back to ambient values.
 * @param platform Target platform.
 * @param environment Parent environment, retained only for unrelated build tools.
 * @param appRoot Desktop application directory; relative credential paths resolve here.
 * @param options `optional` treats a missing file as empty, for unsigned builds that need no release settings.
 * @returns Isolated environment with file-owned release settings.
 */
export function loadDesktopPackageEnvironment(
  platform: 'win32' | 'darwin',
  environment?: NodeJS.ProcessEnv,
  appRoot?: string,
  options?: { optional?: boolean },
): NodeJS.ProcessEnv

/**
 * Validate release configuration before preparation without invoking a token or Apple's services.
 * @param environment File-owned release settings.
 * @param target Selected release target.
 * @param options Explicit packaging mode.
 * @returns Nothing.
 */
export function validateDesktopPackageEnvironment(
  environment: NodeJS.ProcessEnv,
  target: { platform: 'win32' | 'darwin', arch: string },
  options?: { unsigned?: boolean, prepareOnly?: boolean },
): void
