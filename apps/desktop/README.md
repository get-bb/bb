# @bb/desktop

macOS and Linux Electron shell for bb. The desktop app loads the existing bb
web UI and uses the packaged `bb-app` launcher for server and host-daemon
lifecycle.

## Development

From the repo root, the full source dev loop is:

```bash
pnpm dev:desktop
```

That starts the source dev server and the Electron shell through
`scripts/bb-dev-app`. To run only the desktop package task directly:

```bash
pnpm exec turbo run dev --filter=@bb/desktop
```

The dev script builds `bb-app`, compiles the Electron main/preload files, and
opens Electron directly. By default it uses the same checkout-scoped
`~/.bb-dev/<checkout-instance>` data directory and deterministic high ports as
the main repo dev launcher; it prints the resolved data dir, server URL, and
Electron user-data dir at startup. It intentionally overwrites inherited
`BB_DATA_DIR`, `BB_SERVER_PORT`, `BB_SERVER_URL`, and `BB_HOST_DAEMON_PORT` so a
desktop dev run launched from an existing bb session still targets the current
checkout. Set `BB_DESKTOP_USER_DATA_DIR` to override only Electron's user-data
directory.

The launcher probes the checkout's Vite app port at startup and adapts:

- **`pnpm dev` is already running** (Vite reachable): the shell loads the Vite
  dev URL, so you get live source and HMR for `@bb/app` changes — no rebuild
  needed. It still attaches to the same running server/daemon for all API/WS
  traffic. The launcher prints `app <url> (Vite dev server — live reload)`. This
  is the fast loop for iterating on the desktop UI.
- **`pnpm dev` is not running**: the shell starts its own `bb-app` runtime and
  loads the built UI it serves, so you must rebuild (re-run this task) to pick up
  source changes. The launcher prints `app (own bb-app runtime — …)`.

The override is plumbed via `BB_DESKTOP_APP_URL`, which the launcher only sets
when Vite is confirmed reachable; it is never set in packaged builds, so
production always loads the server's own built UI.

To run the slower unpacked Electron Builder app, which more closely matches the
packaged runtime and keeps native dependencies rebuilt for Electron's bundled
Node runtime:

```bash
pnpm exec turbo run start --filter=@bb/desktop
```

Electron is pinned to `41.7.0`, the highest stable line verified to rebuild the
packaged native modules with the current dependency set. Electron 42.2.0 was
tested, but `better-sqlite3@12.10.0` does not compile against Electron ABI 146.
Revisit the pin when `better-sqlite3` ships support or prebuilds for that ABI.

## Validation

```bash
pnpm exec turbo run typecheck --filter=@bb/desktop --filter=bb-app
pnpm exec turbo run build --filter=@bb/desktop
pnpm exec turbo run test --filter=@bb/desktop --filter=bb-app --force
pnpm exec turbo run dev --filter=@bb/desktop
```

## Packaging

```bash
pnpm exec turbo run desktop:build --filter=@bb/desktop
pnpm exec turbo run smoke:packaged --filter=@bb/desktop
```

Artifacts are written under `apps/desktop/release/`. The macOS build is Apple
Silicon arm64-only; Intel Macs are not a target. Without signing secrets, local builds
sign with a code-signing identity auto-discovered from the keychain and skip
notarization. A valid signature matters even for local builds: macOS
provenance-tracks unsigned apps, forcing syspolicyd to evaluate every exec in
the app's process tree, which can stall process launches system-wide. On
machines with no keychain identity (or with `CSC_IDENTITY_AUTO_DISCOVERY=false`,
as CI sets for workflow-artifact-only builds), artifacts remain unsigned and
macOS shows the normal Gatekeeper warning on first launch.

### Linux (AppImage, x64)

Linux packaging targets x64 glibc-based distributions. Install `python3`,
`make`, and `g++` so node-gyp can build node-pty during dependency installation.

From the repo root, build an unpacked app, an AppImage distribution, or smoke
test the current packaged output with:

```bash
pnpm --filter @bb/desktop run package:linux
pnpm --filter @bb/desktop run dist:linux
pnpm --filter @bb/desktop run smoke:packaged
```

Running an AppImage normally requires FUSE and, on some distributions, the
`libfuse2` compatibility package. If FUSE is unavailable, launch it with
`--appimage-extract-and-run` instead.

CI builds Linux artifacts on the pinned `ubuntu-22.04` runner. The AppImage
links against the build machine's glibc, so that pin sets the oldest
distribution that can run a published build. Raise it deliberately.

Linux gets both update paths, but they are not equivalent:

- The JSON version feed (`desktop-version-linux.json`) is polled on every Linux
  install and reports that a newer release exists.
- Self-installing auto-update runs only inside an AppImage whose directory the
  app can write to. electron-updater detects the AppImage through the `APPIMAGE`
  environment variable, and its install step unlinks the running file *before*
  moving the replacement in — so a read-only directory would delete the app and
  leave nothing behind. Both the startup check and the install handler verify
  write and search access on the parent directory first.
- Everything else — an extracted directory, a distribution package, or an
  AppImage in a read-only location — reports new versions without installing
  them.

The Linux AppImage is unsigned, and electron-updater performs no signature
check on Linux: it verifies only the SHA-512 recorded in the update metadata
that ships beside it. macOS installs through Squirrel, which additionally
requires the replacement to satisfy the running app's code-signing
requirement. Write access to the release assets is therefore sufficient to
push code to Linux clients. Treat the release token accordingly.

## Releasing

`bb-app` and `@bb/desktop` versions are LOCKED in lockstep. The desktop package
depends on `bb-app: workspace:*`, and the displayed release version string must
match `packages/bb-app/package.json`.

To bump for a release:

```bash
node scripts/bump-version.mjs <new-version>
```

Then commit and ship through the normal `sawyer-next` → `main` flow. You can also
use `--patch`, `--minor`, or `--major` instead of an explicit version.

CI enforces this lockstep. Direct edits that leave
`packages/bb-app/package.json` and `apps/desktop/package.json` with different
versions fail the build. Never edit either package version directly for a
release; use `scripts/bump-version.mjs` so both files move together.

The desktop release tag uses the locked version: `desktop-v<version>` for
immutable releases and `desktop-latest` for the moving pointer.

`build-desktop.yml` builds macOS and Linux in parallel jobs, then publishes
both from one job. The moving release resets all of its assets on each publish,
so a single publisher is what keeps one platform from deleting the other's
binaries. Each platform has its own update feed file inside the same release
tag:

| Platform | Artifacts               | electron-updater metadata | Version feed                 |
| -------- | ----------------------- | ------------------------- | ---------------------------- |
| macOS    | `.dmg`, `.zip` (arm64)  | `latest-mac.yml`          | `desktop-version.json`       |
| Linux    | `.AppImage` (x64)       | `latest-linux.yml`        | `desktop-version-linux.json` |

macOS keeps the unsuffixed feed name because released macOS builds already
request it. Linux artifacts are unsigned; only the macOS binaries wait on the
Apple signing secrets.

## Nightly channel

The scheduled `publish-bb-app.yml` workflow runs from `main` every day at
3:00 AM Pacific (`America/Los_Angeles`, including daylight-saving changes). It
derives a unique version such as `0.34.1-nightly.<run-id>.<attempt>` without
committing that version, publishes `bb-app` with the npm `nightly` dist-tag,
and builds the desktop app from that same lockstep version.

To publish or dry-run the channel manually from `main`, dispatch the same
workflow with `npm_tag=nightly`. A non-dry run publishes both npm and desktop;
a dry run validates only the npm package path.

A stable release also refreshes the channel. A non-dry `npm_tag=latest` run
publishes the release, then derives the next nightly version from the release
commit and publishes npm and desktop nightly again. Without this step the
nightly channel stays below `latest` until the next scheduled run.

The nightly desktop is a separate installation:

- product name: `bb Nightly`
- bundle identifier: `dev.bb.desktop.nightly`
- Linux binary name: `bb-nightly`, so it never shadows stable `bb` on PATH
- app/update release: `desktop-nightly`
- update metadata: `nightly-mac.yml` and `nightly-linux.yml`
- version feeds: `desktop-version.json` (macOS) and
  `desktop-version-linux.json` (Linux)
- icon: `assets/icon-nightly.icns` and `assets/icon-nightly.png`

Download it from
[`desktop-nightly`](https://github.com/get-bb/bb/releases/tag/desktop-nightly)
or run the CLI build with:

```bash
npx bb-app@nightly
```

Stable and nightly desktop bundles can coexist. Electron-owned preferences,
window state, and process supervision use separate application data
directories; the embedded bb runtime still uses the normal `~/.bb` data and
default server port unless the corresponding environment variables are
overridden.

Nightly builds set `BB_DESKTOP_RELEASE_CHANNEL=nightly` at build time. The value
is baked into the Electron main/preload bundles and selects the nightly product
identity, yellow icon, and update URLs. Omit the variable (or set it to
`latest`) for stable and local builds.

## macOS signing + notarization

The desktop package is ready for Developer ID signing and Apple notarization.
Local builds with no secrets sign via keychain auto-discovery and skip
notarization. To activate signed and notarized release artifacts, add these
GitHub Actions secrets:

| Secret                       | Value                                                                                                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MACOS_CERTIFICATE_P12`      | Base64-encoded `.p12` exported from Keychain Access for a `Developer ID Application` certificate and its private key. On macOS: `base64 -i DeveloperID.p12 -o certificate.base64.txt`. |
| `MACOS_CERTIFICATE_PASSWORD` | Password used when exporting the `.p12`.                                                                                                                                               |
| `MACOS_CERTIFICATE_NAME`     | Optional certificate common name, without the `Developer ID Application:` prefix. Leave unset when the `.p12` contains a single usable identity and electron-builder can derive it.    |
| `APPLE_ID`                   | Apple ID email for the Developer Program account.                                                                                                                                      |
| `APPLE_APP_PASSWORD`         | App-specific password from `appleid.apple.com` under Sign-In and Security.                                                                                                             |
| `APPLE_TEAM_ID`              | Developer Team ID from `developer.apple.com/account` membership details.                                                                                                               |

Once those secrets are present, the next `Build Desktop` workflow run with
`publish=true` and `release_channel=stable` signs the `.app`, notarizes it, and
publishes the signed `.dmg` / `.zip` assets to `desktop-latest`. If no required
signing secrets are configured, the workflow still builds unsigned artifacts, but
the release job publishes only `desktop-version.json` and withholds unsigned
binaries from `desktop-latest`. If only some required signing secrets are set,
the workflow fails before packaging so a misconfigured release cannot silently
produce unsigned or signed-but-not-notarized artifacts.

## Auto-update

The renderer update toast keeps using `desktop-version.json` as the lightweight
feature surface. The installer path uses `electron-updater` against the same
`desktop-latest` release asset directory and reads `latest-mac.yml`. These
checks run in parallel on launch, hourly, and when the app becomes active: the
JSON feed can show "update available" even when CI has published metadata only,
while the Electron updater only flips the toast to "ready to install" after a
signed update has actually downloaded. Local dev builds skip Electron auto-update
unless `BB_DESKTOP_AUTO_UPDATE=1` is set.

`bb Nightly` follows the equivalent isolated `desktop-nightly` release and
`nightly-mac.yml`; it never reads or moves the stable feed. The scheduled
workflow requires the complete signing/notarization secret set before
publishing nightly desktop assets.

To verify a downloaded or unpacked build:

```bash
spctl --assess --verbose /path/to/bb.app
codesign --verify --deep --strict --verbose=2 /path/to/bb.app
```

## Debugging

Use the View menu to toggle DevTools. To open them automatically on launch, set
`BB_DESKTOP_OPEN_DEVTOOLS=1`:

```bash
BB_DESKTOP_OPEN_DEVTOOLS=1 apps/desktop/release/mac-arm64/bb.app/Contents/MacOS/bb
```

When the desktop app spawns `bb-app`, server and daemon logs land under
`~/.bb/logs/` or `$BB_DATA_DIR/logs/` when `BB_DATA_DIR` is set.

To verify attach-if-found manually, start a compatible bb first, then launch the
desktop app:

```bash
npx bb-app@latest
pnpm exec turbo run dev --filter=@bb/desktop
```

The desktop supervisor handles normal quits plus `SIGINT` and `SIGTERM`, and it
writes a PID file so the next launch can reap a stale Electron-owned `bb-app`
launcher. Hard crashes such as process aborts, segfaults, or kernel-level kills
cannot run cleanup in the crashing process; the startup PID-file reap is the
recovery path for those cases.
