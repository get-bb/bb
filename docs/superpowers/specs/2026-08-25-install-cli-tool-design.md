# Install CLI Tool: putting the app's `bb` on your PATH

## Problem

The desktop app bundles a complete `bb` CLI at
`<app>/Contents/Resources/app.asar.unpacked/node_modules/bb-app/host-daemon/dist/bb`.
It is on `PATH` for agent subprocesses the app spawns (`runtime-shell-env.ts`
prepends the daemon bundle directory and sets `BB_CLI`), and on `PATH` nowhere
else. A user with only the desktop app installed has no `bb` in their own
terminal.

The in-repo comment at `plugins/automations/src/script-runner.ts:15-20` already
names this: "on a packaged install bb lives in the daemon bundle directory,
which is on no shell `PATH`."

## Scope: which distribution modes actually need this

| Distribution mode | `bb` on PATH today? | Needs this? |
| --- | --- | --- |
| `npm i -g bb-app` | Yes, npm links the `bb` bin | No |
| `npx bb-app` | Ephemeral by design | No |
| Local dev checkout | `pnpm bb` / `pnpm bb:dev` | No |
| Agent subprocess inside bb | Yes, via `runtime-shell-env.ts` | No |
| **Packaged macOS `.app`** | No | **Yes** |
| **Packaged Linux AppImage** | No | **Yes** |

Two cells of six. The feature is scoped to packaged desktop installs.

**Windows is out of scope and cannot be in scope.**
`apps/desktop/scripts/desktop-release-channel.mjs:25` throws on any platform
other than darwin and linux, `electron-builder.config.json` declares no Windows
target, and `packages/bb-app/package.json` declares `os: ["darwin", "linux"]`.

### Relationship to `npm i -g bb-app`

`bb-app` is published with a `bb` bin, so a global npm install already puts `bb`
on `PATH`. This feature exists anyway because an npm-global `bb` drifts from the
app you actually have open. The value proposition is version lock: the `bb` you
type is the `bb` your app runs. That promise is the whole feature, and any
design that lets it silently become false is worse than shipping nothing.

## Design: three layers

### Layer 1: `bin/bb` inside the bundle

electron-builder ships a wrapper script at `<app>/Contents/Resources/bin/<name>`
via `extraResources`. The script locates itself with `$0` plus `realpath`, walks
up to the bundle root, and execs the app's own Electron as node:

```sh
#!/usr/bin/env bash
SELF=$(realpath "$0")
APP=$(dirname "$(dirname "$(dirname "$(dirname "$SELF")")")")
export BB_NODE_OPTIONS="$NODE_OPTIONS"; unset NODE_OPTIONS
exec env ELECTRON_RUN_AS_NODE=1 \
  "$APP/Contents/MacOS/<executable>" \
  "$APP/Contents/Resources/app.asar.unpacked/node_modules/bb-app/host-daemon/dist/bb" "$@"
```

Because the wrapper lives inside the bundle, it needs no resolution chain, no
recorded install path, and no refresh. It moves with the app.

This mirrors VS Code's `Contents/Resources/app/bin/code`, generated from
`resources/darwin/bin/code.sh` by `build/gulpfile.vscode.ts`.

**Verified working** (spike, against the installed `bb Nightly.app`): direct
invocation, invocation via `PATH`, and invocation through a symlink in a
separate directory all return the correct version.

The snippet above is illustrative; `<name>` and `<executable>` are templated at
build time from the release channel. Note that `realpath(1)` is the BSD variant
on macOS and was not always present on older releases. VS Code hand-rolls a
symlink walk in `code.sh` rather than depending on it. Either confirm the
minimum supported macOS ships `/bin/realpath` or hand-roll the walk; do not
assume GNU `realpath` semantics.

**The `NODE_OPTIONS` stash is required.** With `NODE_OPTIONS` set in the
environment, Electron prints
`ERROR:electron/shell/app/node_main.cc:153 Node.js environment variables are
disabled because this process is invoked by other apps` to stderr on every
invocation. It does not fail (exit code is 0 either way), but the noise would
appear on every single command. Stash rather than discard, so the CLI can
re-apply it to any node child it spawns; VS Code does the same via
`VSCODE_NODE_OPTIONS`.

A user can stop here:

```sh
export PATH="/Applications/bb.app/Contents/Resources/bin:$PATH"
```

### Layer 2: `~/.bb/bin`, refreshed on launch

On startup the app writes a small generated wrapper to `~/.bb/bin/<name>`
pointing at its own layer-1 wrapper.

**This is the layer that matters most to users.** It is added to `PATH` exactly
once, by hand, and then never touched again: it is independent of where the app
is installed, which channel is installed, and whether the app has since moved or
updated. That makes it dotfiles-portable, which a bundle-internal path is not.
Everything else in this design exists to make this one line keep working:

```sh
export PATH="$HOME/.bb/bin:$PATH"
```

It self-heals: moving the app, renaming it, or an electron-updater update are
all corrected on the next launch.

`~/.bb/` is already the app's data directory, so this writes nothing outside
territory the app already owns. No privilege escalation, ever.

**A generated wrapper, not a symlink, on both platforms.** A symlink would be
the obvious macOS choice, but when the app is deleted a dangling symlink reports
`command not found` in both zsh and bash (verified). That is misleading: the
file is present, so the user goes looking in the wrong place. A wrapper can say
what actually happened and exit 127:

```
bb: the bb app is no longer installed at /Applications/bb.app
bb: reinstall it, or remove ~/.bb/bin/bb
```

Using a wrapper on both platforms also collapses macOS and Linux into a single
code path instead of two.

### Layer 3: settings row

A `CliCommandSettingsSection` beside `CliSkillsSettingsSection` in the General
bucket (`apps/app/src/views/SettingsView.tsx:1100`), reusing the
`SettingsSection` / `SettingsWithControl` shell and the existing status-badge
vocabulary.

It shows:

- whether `~/.bb/bin` is on the user's login `PATH`, probed with the existing
  `apps/desktop/src/desktop-shell-path.ts` mechanism
- the resolved command name and the version it reports, next to the app's own
  version, so skew is visible rather than silent
- the `export` line, and an action to append it to the detected shell profile

Gated on `getBbDesktopInfo()?.cliCommand !== undefined`, the existing
feature-detect idiom in `apps/app/src/lib/bb-desktop.ts:111-117`, so web and
older desktop shells simply do not render it.

## Where the code lives

This is desktop IPC, not a server route. The cli-skills feature goes UI to
server route to daemon RPC, fanning out per machine, which is correct for
per-machine skill files. "Put this bundle's `bb` on `PATH`" is about the machine
the Electron shell runs on, so routing it through the server would cross the
boundary `AGENTS.md` warns about.

```
packages/desktop-contract/src/info.ts  BbDesktopApi.cliCommand?  (optional, feature-detected)
apps/desktop/src/desktop-cli-ipc.ts    channel constants, mirroring desktop-update-ipc.ts
apps/desktop/src/preload.ts            contextBridge -> ipcRenderer.invoke
apps/desktop/src/main.ts               registerDesktopCliIpc(), beside registerDesktopUpdateIpc()
apps/desktop/src/cli-link.ts           layer 2 refresh, called on startup
```

Per `AGENTS.md`, a `bb install-cli` CLI command ships alongside. This is not
circular: an agent running inside bb already has `bb` on `PATH`, so it is
exactly the command an agent can run to fix the user's outside-the-app case.
There is deliberately **no SDK method and no server route**, because this is a
host-local action rather than a server resource.

## Naming

Channel-suffixed, no bare-`bb` opt-in:

| Channel | Command |
| --- | --- |
| stable | `bb` |
| nightly | `bb-nightly` |
| dev | `bb-dev` (see below) |

This matches the policy already established for Linux executables at
`apps/desktop/scripts/desktop-release-channel.mjs:37-39`, which names the
nightly executable `bb-nightly` "so both channels can be installed at once
without one shadowing the other on PATH."

**Divergence from VS Code, deliberate.** VS Code always names the in-bundle file
`code` regardless of product, because only the `/usr/local/bin` symlink name
varies. Because layer 1 supports adding the bundle's `bin` directory to `PATH`
directly, ours must be per-channel; otherwise putting both channels' `bin`
directories on `PATH` means one silently shadows the other.

### Known consequence: the `bb-cli` skill

`apps/server/src/services/skills/global-skill-install.ts` generates a
`bb-cli` skill installed into `~/.agents/skills` and `~/.claude/skills`, telling
agents outside bb to run `bb`. On a nightly-only machine that command does not
exist. The generated skill must be templated with the command name the app
actually installs. Cheap now, annoying later.

## Platform matrix

| | Layer 1 (in-bundle `bin/`) | Layer 2 (`~/.bb/bin`) |
| --- | --- | --- |
| macOS `.app` | Works, stable path | Generated wrapper |
| Linux AppImage | **Not possible** | Generated wrapper |

An AppImage self-mounts at `/tmp/.mount_bbXXXX`, a different ephemeral path
every launch, so no path inside it is stable enough to put on `PATH`. Layer 1
does not exist on Linux. Layer 2 covers it: at launch the app writes a wrapper
into `~/.bb/bin/<name>` that re-invokes the AppImage file recorded from
`process.env.APPIMAGE`. Moving the AppImage breaks the command until the app is
next launched, at which point it self-heals.

### Linux mechanism, verified

Spiked against the published `bb-0.40.0-x86_64.AppImage` in an amd64 OrbStack
Ubuntu 24.04 machine. All of the following were run, not reasoned about.

**`AppRun` passes environment and arguments through.** It is a bash script
ending in `exec "$BIN" "${args[@]}"` with no `env -i`, so inheritance is
structural rather than incidental. Confirmed empirically: with
`ELECTRON_RUN_AS_NODE=1` set, `AppRun -e '...'` runs as plain Node and exits 0.

**No display is required.** `ELECTRON_RUN_AS_NODE` skips Chromium
initialization, and every test ran with `DISPLAY` unset. X11 forwarding is
irrelevant to this feature; it only matters for testing the GUI itself.

**Both `APPDIR` and `APPIMAGE` are visible to the Node process.** `APPDIR` is
the ephemeral mount, `APPIMAGE` the stable file path. This is what makes the
design possible, because it lets an external bootstrap find the CLI inside a
mount whose path it could not otherwise know:

```
APPDIR=/tmp/.mount_bb.AppGtuCFR
APPIMAGE=/home/user/bb.AppImage
```

**Shape.** The wrapper hardcodes the recorded AppImage path and delegates
resolution of the internal path to a bootstrap module beside it:

```sh
exec env ELECTRON_RUN_AS_NODE=1 "$APPIMG" "$HOME/.bb/bin/bb-bootstrap.mjs" "$@"
```

```js
// bb-bootstrap.mjs
const dir = process.env.APPDIR;
await import(join(dir, "resources/app.asar.unpacked/node_modules/bb-app/host-daemon/dist/bb"));
```

Note the Linux internal path has no `Contents/` segment, unlike macOS.

End-to-end results: `bb --version` returned `0.40.0`; `bb --help` returned real
CLI help with arguments passed through; renaming the AppImage produced the
intended diagnostic and exit 127.

### Two Linux runtime prerequisites

Neither is caused by this design, but both determine whether the command works
and both should be surfaced rather than discovered.

**`libfuse2`.** AppImage type 2 requires it, and Ubuntu 24.04 ships only fuse3.
Without it the AppImage refuses to run at all, GUI included, with `AppImages
require FUSE to run`. Note `/dev/fuse` and `fusermount3` being present is not
sufficient. `APPIMAGE_EXTRACT_AND_RUN=1` is the escape hatch, at the cost of
extracting the whole image per invocation.

**Chromium's shared libraries.** Even in `ELECTRON_RUN_AS_NODE` mode the
Electron binary still dynamically links the GUI stack. On a minimal system it
fails with `error while loading shared libraries: libnspr4.so`. Running it
required `libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64
libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1
libasound2t64 libgtk-3-0t64`. A user running the desktop app already has these;
a container or headless server does not. "It's just Node" is not true on Linux.

### `dist/bb` is not self-contained

As of 0.40.0 the CLI bundle is code-split: `dist/bb` is 43 KB beside a
`dist/bb-chunks/` directory. Referencing it in place, as this design does, is
fine. Copying `dist/bb` alone to another location would not be.

## Interference with existing modes

Putting `~/.bb/bin` on `PATH` introduces a `bb` where there may already be
others. Each case below was checked against the code or reproduced.

### Agent shells inside bb: already handled, and it composes

Not a new problem, and the existing mechanism absorbs this design for free.
`prepareRuntimeShellEnv` (`apps/host-daemon/src/runtime-shell-env.ts`) prepends
the daemon bundle directory to the agent shell's `PATH` **and** sets an absolute
`BB_CLI`. `maybeReexecViaBbCli` (`apps/cli/src/bb-cli-reexec.ts`) then hops to
`BB_CLI` when the running binary differs, guarded against loops by
`BB_CLI_REEXEC=1`. The header comment states the intent directly: "When agent
shells rewrite PATH, a user-global or stale `bb` may win over the daemon-managed
binary."

Two consequences worth stating:

- `~/.bb/bin/bb` resolves through the wrappers to `<app>/.../host-daemon/dist/bb`,
  which is exactly what `BB_CLI` names. `tryRealpath` compares them equal, so
  there is **no re-exec hop** in the common case.
- If a *nightly* agent shell picks up *stable's* `bb` from `PATH` first, the
  paths differ and it re-execs to nightly automatically. The correct binary wins
  without this design doing anything.

### A globally installed `bb-app` (npm/pnpm)

Both provide `bb`; `PATH` order decides, and the loser is invisible. This is the
"silently runs the wrong bb" failure that the design is most concerned with, so
it must be **detected and displayed, not documented away**: the settings row
runs the equivalent of `which -a bb` and shows every match, flagging when the
app's own entry is not first.

Note the npm route is not necessarily the more stable one. On a mise-managed
node, `npm prefix -g` resolves inside a version-scoped directory
(`~/.local/share/mise/installs/node/<version>`), so a global `bb` silently
disappears on a node version switch. `~/.bb/bin` has no such coupling.

### Inside a dev checkout

With `~/.bb/bin` on `PATH`, typing `bb` in a checkout runs the **packaged app's**
CLI against the packaged app's server and `~/.bb` data directory, not the
checkout's dev instance. That is the correct and predictable behavior, but it is
surprising while working on bb. This is what `bb-dev` is for, and the docs must
say so plainly.

### Both channels installed

No collision. Channel-suffixed names mean `bb` and `bb-nightly` are distinct
files in the same directory.

### The app is uninstalled

`~/.bb/bin/<name>` survives, because the app is not present to clean it up. This
is why layer 2 is a wrapper rather than a symlink: a dangling symlink reports
`command not found` (verified in zsh and bash), which sends the user looking in
the wrong place. The wrapper reports the real cause.

### Non-interactive shells

`~/.bb/bin` reaches `PATH` via a shell profile, so `cron`, LaunchAgents, and
GUI-launched processes will not see it. This is inherent to any `PATH`-based
approach and is not something this design can fix. Callers that need a
guaranteed absolute path should use `BB_CLI`.

## Safety

- The app writes only inside `~/.bb/bin` and its own bundle. It can never
  overwrite a Homebrew or npm-global `bb`.
- Files carry a marker line identifying them as ours. Anything else found at a
  target path is left alone and surfaced in the UI rather than replaced.
- No privilege escalation. VS Code shells out to
  `osascript -e "do shell script ... with administrator privileges"` to write
  `/usr/local/bin`; we deliberately do not, which is the main reason for
  choosing `~/.bb/bin` over `/usr/local/bin`.

## `bb-dev` (assumption, needs confirmation)

`bb-dev` is categorically different from `bb` and `bb-nightly`. Those are
app-owned: one bundle each, self-refreshed on launch. There is no single dev app
to own `bb-dev`, because a developer has N checkouts, each with its own
instance. If the dev desktop app wrote `~/.bb/bin/bb-dev` pointing at itself,
whichever checkout was launched last would hijack every other one.

**Assumption taken, pending confirmation:** `bb-dev` ships as a static,
checkout-agnostic repo script (`scripts/bb-dev-cli`), **copied** into
`~/.bb/bin/bb-dev` once. It is never rewritten, because it resolves at call
time. The settings row is hidden when `app.isPackaged === false`.

Copied rather than symlinked, for the same reason layer 2 is a wrapper: the
script is self-contained and checkout-agnostic, so a symlink into one particular
checkout would break `bb-dev` for *every* checkout the moment that one is
deleted, and would break it with a misleading `command not found`.

It resolves the target instance from `$PWD` by walking up for a bb checkout,
then reproducing the derivation in `scripts/bb-dev-app:160-200`:

```
hash   = sha256(realpath(repoRoot))
offset = parseInt(hash[0:8], 16) % 8000
app = 11000+offset   server = 19000+offset   daemon = 27000+offset
```

**Verified working** (spike): resolves correctly from a checkout root, from deep
inside a checkout, and through a relative/symlinked path; errors cleanly outside
any checkout. Derived ports matched `scripts/bb-dev-app status` exactly for two
live checkouts (offsets 1470 and 7817).

It should probe the derived server port and report "no dev server for this
checkout, run `pnpm dev`" rather than surfacing a raw connection error.

**Precedent note:** VS Code deliberately ships no working install-in-PATH for
source builds. The palette entry appears (the action has no dev gate) but fails,
because `getShellCommandLink()` resolves `<appRoot>/bin/code` and `bin/code`
only exists as a build artifact. Their documented answer is
`./scripts/code-cli.sh`, run from the repo. `bb-dev` is a deliberate improvement
on that precedent, justified by bb's multi-checkout tooling, and it is the most
optional part of this design: `eval "$(scripts/bb-dev-app env)"; pnpm bb:dev`
already works.

## Testing

- Wrapper generation: snapshot per platform and channel.
- Wrapper resolution: exec a generated wrapper from a temp directory, directly
  and through a symlink, and assert it reports the expected version.
- `NODE_OPTIONS` hygiene: assert stderr is clean when `NODE_OPTIONS` is set.
- Layer 2 refresh: idempotent on repeated launch; corrects a stale link;
  leaves a foreign file untouched and reports it.
- `bb-dev` resolution: derived ports match `bb-dev-app` for a set of fixture
  paths; clean error outside a checkout.
- Path computation follows the `apps/desktop/test/app-paths.test.ts` pattern.

## Risks

1. ~~`ELECTRON_RUN_AS_NODE` through an AppImage `AppRun` is unverified.~~
   **Retired.** Spiked against the published x86_64 AppImage in an amd64
   OrbStack machine; environment and arguments both pass through, headless, and
   the full wrapper works end to end. See "Linux mechanism, verified" above.
2. **Layer 1 changes the packaging surface** (`extraResources`, plus a build
   step to template the channel name into the script), which touches the release
   pipeline. Worth review from whoever owns it.
3. **Layer 1 without layer 2 has a sharp edge**: the `PATH` line contains
   `/Applications/bb.app`, so moving or renaming the app breaks the user's shell
   until they edit their rc. This is visible and self-inflicted rather than
   mysterious, and it is the reason layer 2 exists.
4. **Linux runtime prerequisites are outside our control.** `libfuse2` and
   Chromium's shared libraries determine whether the command works at all. The
   settings row and `bb install-cli` should detect and report these rather than
   emitting a raw loader error, since both failures are confusing out of
   context.
5. **The AppImage path is recorded, not discovered.** Unlike macOS, where the
   in-bundle wrapper always knows where it is, Linux depends on `$APPIMAGE`
   captured at launch. Moving the AppImage while the app is closed leaves a
   wrapper pointing at nothing until the app is next launched. The wrapper
   reports this clearly, but it cannot self-repair without the app running.

## Open questions

- Confirm the `bb-dev` assumption above, and confirm hiding the settings row in
  dev builds.
- Does `bb install-cli` need an uninstall counterpart in v1, or is deleting the
  file sufficient?
- Should layer 2 refresh happen on every launch, or only when the resolved
  target differs from what is already written? Every launch is simpler and the
  cost is one read plus an occasional rewrite.
