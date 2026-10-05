# Ahel Desktop releases

Releases are unsigned for now. Assets go to the public repo `ahel-technologies/ahel-desktop-releases`, so electron-updater reads the feed without a token. This repo stays private.

## Cut a release

1. Pick the version. Master carries `0.1.0`; the tag sets the version CI builds, so master need not be bumped first.
2. `git tag v0.1.0 && git push origin v0.1.0`. A tag with `-` (for example `v0.2.0-beta.1`) becomes a GitHub prerelease.
3. `.github/workflows/desktop-release.yml` runs: `macos-14` builds the mac arm64 DMG and zip, `windows-latest` builds the Windows x64 NSIS installer, both unsigned (about 30 to 60 minutes).
4. The publish job creates release `v0.1.0` in `ahel-desktop-releases` with: `ahel-desktop-<v>-mac-arm64-unsigned.dmg`, `.zip`, `.zip.blockmap`, `latest-mac.yml`, `ahel-desktop-<v>-win-x64-unsigned.exe`, `.exe.blockmap`, `latest.yml`, plus the version-free copies `ahel-desktop-mac-arm64.dmg` and `ahel-desktop-win-x64.exe`.
5. Rerun a failed tag: delete the release in `ahel-desktop-releases` if one was created, then use "Re-run all jobs" on the workflow run.

## Secret (one time, Karl)

1. Create the token: github.com → avatar → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token. Resource owner: `ahel-technologies`. Repository access: Only select repositories → `ahel-desktop-releases`. Permissions → Repository permissions → Contents: Read and write. Generate and copy it.
2. Add it: github.com/ahel-technologies/ahel-desktop → Settings → Secrets and variables → Actions → New repository secret. Name `RELEASES_TOKEN`, paste the value, Add secret.
3. If the org requires approval for fine-grained tokens, approve it at github.com/organizations/ahel-technologies/settings/personal-access-token-requests.

## Landing download links

`https://github.com/ahel-technologies/ahel-desktop-releases/releases/latest/download/<asset>`

- macOS: `.../releases/latest/download/ahel-desktop-mac-arm64.dmg`
- Windows: `.../releases/latest/download/ahel-desktop-win-x64.exe`

`latest` skips prereleases, so the landing only serves stable tags. The app updater does offer prereleases.

## Known limits of unsigned builds

- macOS: Gatekeeper blocks the first open. Users right-click → Open, or System Settings → Privacy & Security → Open Anyway. Auto-update cannot install on macOS: Squirrel.Mac requires a real code signature, so unsigned installs reinstall once by hand when signed builds ship.
- Windows: SmartScreen warns (More info → Run anyway). Auto-update works, but update signatures are not verified.

## Code signing later

- macOS: Apple Developer Program (99 USD/year), a Developer ID Application certificate as a p12, and notarization credentials (App Store Connect API key or Apple ID app password). CI writes `.env.macos` from secrets and runs `package:desktop:mac:arm64` instead of `:dev`. See `apps/desktop/README.md` (macOS signing and notarization).
- Windows: an EV code-signing certificate on a hardware token or a cloud HSM signer; the current signer expects a local token, so CI needs a cloud signer or a self-hosted Windows box. Then `package:desktop:win:x64` instead of `:unsigned`. See `apps/desktop/README.md#windows-ev-signing`.
- Signed artifacts drop the `-unsigned` suffix: update the collect step and the version-free copies in the workflow.
