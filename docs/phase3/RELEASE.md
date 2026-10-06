# Ahel Desktop releases

macOS releases are signed and notarized once the five secrets under [Signing](#signing) exist; until then, and on Windows, they are unsigned. Assets go to the GitHub releases of this public repository, `ahel-technologies/ahel-desktop`, so electron-updater reads the feed without a token. The workflow publishes with the default `GITHUB_TOKEN` (`contents: write` on the publish job); no extra secret is needed.

## Cut a release

1. Pick the version. Master carries `0.1.0`; the tag sets the version CI builds, so master need not be bumped first.
2. `git tag v0.1.0 && git push origin v0.1.0`. A tag with `-` (for example `v0.2.0-beta.1`) becomes a GitHub prerelease.
3. `.github/workflows/desktop-release.yml` runs: `macos-14` builds the mac arm64 DMG and zip (signed and notarized when the secrets exist), `windows-latest` builds the unsigned Windows x64 NSIS installer (about 30 to 60 minutes; notarization adds 5 to 30).
4. The publish job creates release `v0.1.0` in this repository with: `ahel-desktop-<v>-mac-arm64-unsigned.dmg` (signed: no `-unsigned` suffix), `.zip`, `.zip.blockmap`, `latest-mac.yml`, `ahel-desktop-<v>-win-x64-unsigned.exe`, `.exe.blockmap`, `latest.yml`, plus the version-free copies `ahel-desktop-mac-arm64.dmg` and `ahel-desktop-win-x64.exe`.
5. Rerun a failed tag: delete the release if one was created, then use "Re-run all jobs" on the workflow run.

## Landing download links

`https://github.com/ahel-technologies/ahel-desktop/releases/latest/download/<asset>`

- macOS: `.../releases/latest/download/ahel-desktop-mac-arm64.dmg`
- Windows: `.../releases/latest/download/ahel-desktop-win-x64.exe`

`latest` skips prereleases, so the landing only serves stable tags. The app updater does offer prereleases.

## Known limits of unsigned builds

- macOS: Gatekeeper blocks the first open. Users right-click → Open, or System Settings → Privacy & Security → Open Anyway. Auto-update cannot install on macOS: Squirrel.Mac requires a real code signature, so unsigned installs reinstall once by hand when signed builds ship.
- Windows: SmartScreen warns (More info → Run anyway). Auto-update works, but update signatures are not verified.

## Signing

The `Select macOS signing` step checks five repository secrets. All set: the job writes `.env.macos` and the p12 under `$RUNNER_TEMP`, runs `package:desktop:mac:arm64` (temporary keychain, hardened runtime, every nested Mach-O signed, App and DMG notarized and stapled), checks `spctl` and `stapler validate`, and deletes the credentials. Any missing: the unsigned `:dev` build, with a warning when only some are set.

| Secret | Value | Where Karl gets it |
|---|---|---|
| `MAC_CERT_P12_BASE64` | Developer ID Application certificate and private key, p12, Base64 | developer.apple.com/account → Certificates → + → Developer ID Application (needs a CSR from Keychain Access → Certificate Assistant). Install it, then Keychain Access → My Certificates → right-click "Developer ID Application: …" → Export → .p12 with a password. Then `base64 -i cert.p12 \| pbcopy`. |
| `MAC_CERT_PASSWORD` | the p12 export password | chosen at export |
| `APPLE_ID` | Apple account email of the developer team member | appleid.apple.com |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password for notarytool | appleid.apple.com → Sign-In and Security → App-Specific Passwords → + |
| `APPLE_TEAM_ID` | 10-character Team ID | developer.apple.com/account → Membership details → Team ID |

Add each: github.com/ahel-technologies/ahel-desktop → Settings → Secrets and variables → Actions → New repository secret. The workflow checks that the certificate's team equals `APPLE_TEAM_ID` and that it is not expired. Delete any one secret to go back to unsigned builds.

Entitlements: the app (`apps/desktop/scripts/macos-entitlements.plist`) keeps `allow-jit` and `allow-unsigned-executable-memory` for V8 in Electron and in the Host child that runs Electron as Node, `disable-library-validation` because that Host loads user-installed plugins with native addons, and `audio-input` for dictation. Bundled Node gets `allow-jit` plus `disable-library-validation`; bundled Python gets only `disable-library-validation`: both load native extensions that users install with npm or pip, which carry other signatures.

Updates: `latest-mac.yml` is still generated next to the zip and uploaded unchanged. Squirrel.Mac only installs an update whose signature matches the running app, so users of an unsigned build download the first signed DMG once by hand; signed-to-signed updates then install in place. Signed builds use the real login keychain instead of Chromium's mock keychain, so web sign-ins kept by the old unsigned build may need repeating.

### Windows (later)

Planned: Azure Trusted Signing (cloud HSM, no hardware token) through electron-builder's `azureSignOptions`, then `package:desktop:win:x64` instead of `:unsigned`. The current signer expects a local EV token; see `apps/desktop/README.md#windows-ev-signing`.
