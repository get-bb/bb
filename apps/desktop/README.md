# @bb/desktop

macOS Electron shell for bb. The desktop app loads the existing bb web UI and
uses the packaged `bb-app` launcher for server and host-daemon lifecycle.

## Development

```bash
pnpm exec turbo run dev --filter=@bb/desktop
```

The dev script builds `bb-app`, compiles the Electron main/preload files, and
opens an unpacked Electron Builder app against `http://127.0.0.1:38886`.
Using the unpacked app keeps native dependencies rebuilt for Electron's bundled
Node runtime.

Electron is pinned to `38.4.0` for now because Electron 42's Node/V8 ABI does
not rebuild `better-sqlite3@12.10.0`. Revisit the pin when `better-sqlite3`
ships support or prebuilds for the newer Electron ABI.

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
```

Artifacts are written under `apps/desktop/release/`. v1 builds are unsigned and
macOS-only.

## Debugging

The Turbo dev task opens DevTools automatically. For a packaged app, run the
binary with `BB_DESKTOP_OPEN_DEVTOOLS=1`:

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
