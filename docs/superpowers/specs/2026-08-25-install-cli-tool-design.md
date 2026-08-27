# Install CLI Tool: putting the app's `bb` on your PATH

## Problem

The desktop app bundles a complete `bb` CLI at
`<app>/Contents/Resources/app.asar.unpacked/node_modules/bb-app/host-daemon/dist/bb`.
It is on `PATH` for agent subprocesses the app spawns (`runtime-shell-env.ts`
prepends the daemon bundle directory and sets `BB_CLI`), and on `PATH` nowhere
else. A user with only the desktop app installed has no `bb` in their own
terminal.

The in-repo comment at `plugins/automations/src/script-runner.ts:44-47` already
names this: "the server process does not reliably inherit a `PATH` containing
bb: on a packaged install bb lives in the daemon bundle directory, which is on
no shell `PATH`."

## Scope: which distribution modes actually need this

| Distribution mode | `bb` on PATH today? | Needs this? |
| --- | --- | --- |
| `npm i -g bb-app` | Yes, npm links the `bb` bin | No |
| `npx bb-app` | Ephemeral by design | No |
| Local dev checkout | `pnpm bb:dev`, or `./bin/bb` (appendix A) | No |
| Agent subprocess inside bb | Yes, via `runtime-shell-env.ts` | No |
| **Packaged macOS `.app`** | No | **Yes** |
| **Packaged Linux AppImage** | No | **Yes** |

Two cells of six. **The feature is scoped to packaged desktop installs**, and
every surface it adds is gated on `app.isPackaged`. Dev builds install nothing;
see "Deferred: `bb-dev`" for why that is a decision rather than an oversight.

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

## Design

The user-visible feature is one directory, `~/.bb/bin`, added to `PATH` once.
Everything else exists to keep that one line working.

Two things are worth stating before the layer descriptions, because the layer
names otherwise imply a uniformity that does not exist:

- **Layer 1 is macOS-only.** On Linux there is no stable path inside the
  bundle, so layer 2 uses a different mechanism there. "Layer 2 wraps layer 1"
  is true on macOS and false on Linux.
- **Layer 1 is not primarily a user-facing affordance.** Its job is to keep the
  exec incantation and the bundle-internal path *inside the bundle*, versioned
  with the app, so that a layer-2 wrapper written months ago does not need to
  know today's internal layout. Putting the bundle's `bin` directory on `PATH`
  directly is a supported side effect, not the reason it exists (see Risk 3).

### Layer 1: `bin/<name>` inside the bundle (macOS)

electron-builder ships a wrapper script at `<app>/Contents/Resources/bin/<name>`
via `extraResources`. The script locates itself with `$0` plus a symlink walk,
walks up to the bundle root, and execs the app's own Electron as node:

```sh
#!/usr/bin/env bash
SELF=$(resolve_symlinks "$0")
APP=$(dirname "$(dirname "$(dirname "$(dirname "$SELF")")")")
export BB_NODE_OPTIONS="$NODE_OPTIONS"; unset NODE_OPTIONS
exec env ELECTRON_RUN_AS_NODE=1 \
  "$APP/Contents/MacOS/<executable>" \
  "$APP/Contents/Resources/app.asar.unpacked/node_modules/bb-app/host-daemon/dist/bb" "$@"
```

Because the wrapper lives inside the bundle, it needs no resolution chain, no
recorded install path, and no refresh. It moves with the app, and it is the
single place that knows the internal layout.

This mirrors VS Code's `Contents/Resources/app/bin/code`, generated from
`resources/darwin/bin/code.sh` by `build/gulpfile.vscode.ts`.

**Verified working** (spike, against the installed `bb Nightly.app`): direct
invocation, invocation via `PATH`, and invocation through a symlink in a
separate directory all return the correct version.

`<name>` and `<executable>` are templated at build time from the release
channel.

**Hand-roll the symlink walk; do not depend on `realpath(1)`.** It is the BSD
variant on macOS and was not always present. VS Code hand-rolls the walk in
`code.sh` for this reason, and `bin/bb` in this repo already does (appendix A).

**The `NODE_OPTIONS` stash is required.** With `NODE_OPTIONS` set in the
environment, Electron prints
`ERROR:electron/shell/app/node_main.cc:153 Node.js environment variables are
disabled because this process is invoked by other apps` to stderr on every
invocation. It does not fail (exit code is 0 either way), but the noise would
appear on every single command. Stash rather than discard, so the CLI can
re-apply it to any node child it spawns; VS Code does the same via
`VSCODE_NODE_OPTIONS`.

#### Packaging surface, unverified

`apps/desktop/electron-builder.config.json` has **no `extraResources` key
today**. Layer 1 adds one, plus a build step to template the channel name into
the script. Two things to confirm during implementation rather than assume:

- that the executable bit survives packaging (electron-builder is expected to
  preserve mode, but a non-executable wrapper is a classic and silent failure)
- that the templating step runs for both channels and for both arches

### Layer 2: `~/.bb/bin`, refreshed on launch

On startup the app writes a small generated wrapper to `~/.bb/bin/<name>`.

**This is the layer that matters to users.** It is added to `PATH` exactly
once, by hand, and then never touched again: it is independent of where the app
is installed, which channel is installed, and whether the app has since moved or
updated. That makes it dotfiles-portable, which a bundle-internal path is not.

```sh
export PATH="$HOME/.bb/bin:$PATH"
```

It self-heals: moving the app, renaming it, or an electron-updater update are
all corrected on the next launch.

`~/.bb/` is already the app's data directory, so this writes nothing outside
territory the app already owns. No privilege escalation, ever.

**The path is anchored to `$HOME`, not to the configured data directory.**
`BB_PROD_DATA_DIR_NAME` is `.bb` (`packages/config/src/runtime.ts:81`) and that
is the default, but a user can point the app's data directory elsewhere. The
`PATH` line has to be a fixed, predictable string that survives a data-directory
change, so layer 2 always writes `join(homedir(), ".bb", "bin")`.

**What it points at differs by platform:**

| | Layer 2 target |
| --- | --- |
| macOS `.app` | the layer-1 wrapper at `<app>/Contents/Resources/bin/<name>` |
| Linux AppImage | the recorded `$APPIMAGE` path, plus a bootstrap sidecar |

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
code path for generation, refresh, and the not-installed diagnostic, even though
the exec line inside differs.

### Layer 3: settings row

A `CliCommandSettingsSection` beside `CliSkillsSettingsSection` in the General
bucket (`apps/app/src/views/SettingsView.tsx:1100`), reusing the
`SettingsSection` / `SettingsWithControl` shell and the existing status-badge
vocabulary.

It shows:

- whether `~/.bb/bin` is on the user's login `PATH`
- the resolved command name and the version it reports, next to the app's own
  version, so skew is visible rather than silent
- every `bb` on `PATH`, flagging when the app's own entry is not first
- the `export` line, and an action to append it to the detected shell profile

Gated on `getBbDesktopInfo()?.cliCommand !== undefined`, matching the
feature-detect idiom used by `getDesktopBrowserApi()` in
`apps/app/src/lib/bb-desktop.ts`, so web and older desktop shells simply do not
render it.

**Login-PATH probing needs no new mechanism.**
`apps/desktop/src/desktop-shell-path.ts` exports `ensurePackagedUserShellPath`,
which main.ts already calls at startup on packaged builds. It runs the login
shell with `-ilc 'printf "%s" "$PATH"'` and **assigns the result to
`process.env.PATH`**. So by the time any IPC handler runs, the main process's
own `process.env.PATH` *is* the user's login `PATH`. The settings row reads it
directly; no read-only probe has to be extracted.

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

Channel-suffixed:

| Channel | Command installed |
| --- | --- |
| stable | `bb` |
| nightly | `bb-nightly` |
| dev (unpackaged) | none, by design |

This matches the policy already established for Linux executables at
`apps/desktop/scripts/desktop-release-channel.mjs:37-39`, which names the
nightly executable `bb-nightly` "so both channels can be installed at once
without one shadowing the other on PATH."

**Divergence from VS Code, deliberate.** VS Code always names the in-bundle file
`code` regardless of product, because only the `/usr/local/bin` symlink name
varies. Because layer 1 supports adding the bundle's `bin` directory to `PATH`
directly, ours must be per-channel; otherwise putting both channels' `bin`
directories on `PATH` means one silently shadows the other.

### Ships with this feature: a `bb-cli` skill note

`apps/server/src/services/skills/global-skill-install.ts:21` installs the
built-in `bb-cli` skill into `~/.agents/skills` and `~/.claude/skills`, telling
agents outside bb to run `bb`. On a nightly-only machine that command is
`bb-nightly`, so the skill names something that is not there.

**Templating the skill per channel is the wrong mechanism, and this is a
correction to an earlier reading of it.** The skill is a content-hashed tree:
`resolveGlobalCliSkills` resolves it to a `treeHash`, and the daemon pulls the
tree bytes back over the internal skill-tree route. Three things follow:

- Varying the bytes per channel varies the hash, which turns one shared tree
  into N and defeats the status comparison the settings row depends on.
- The command name is a property of the desktop app on a given *machine*. The
  server installs to many machines and does not know each one's channel.
- A single machine can have both channels installed, so there is no one right
  answer to template in.

**The v1 answer is a static sentence in the skill**, telling agents that a
nightly install names the command `bb-nightly` and that `command -v bb ||
command -v bb-nightly` disambiguates. No templating, no hash variance, correct
on every machine. Per `docs/cli-guide-and-skill.md` the same note belongs in the
guide chapter.

## Platform matrix

| | Layer 1 (in-bundle `bin/`) | Layer 2 (`~/.bb/bin`) |
| --- | --- | --- |
| macOS `.app` | Works, stable path | Wrapper to layer 1 |
| Linux AppImage | **Not possible** | Wrapper to `$APPIMAGE` + bootstrap |

An AppImage self-mounts at `/tmp/.mount_bbXXXX`, a different ephemeral path
every launch, so no path inside it is stable enough to put on `PATH`. Layer 1
does not exist on Linux. Layer 2 covers it: at launch the app writes a wrapper
into `~/.bb/bin/<name>` that re-invokes the AppImage file recorded from
`process.env.APPIMAGE`. Moving the AppImage breaks the command until the app is
next launched, at which point it self-heals.

The consequence for implementation: layer 2's generator has two exec-line
templates, and layer 1 is a macOS-only build artifact.

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

### The automations plugin's own bb resolver

`plugins/automations/src/script-runner.ts` has a third resolution path:
`resolveBbBinary` walks a stat-ed candidate list (`bbBinaryCandidates`) to put
bb on an automation script's `PATH`, returning null rather than throwing.

Once `~/.bb/bin` exists it becomes a candidate that resolver can find, which is
probably an improvement. **Confirm the ordering during implementation**: if the
expanded `PATH` yields `~/.bb/bin/bb` ahead of the daemon bundle's own binary,
an automation running inside a nightly app could resolve stable's wrapper. The
`BB_CLI` re-exec above should correct it, but that composition has not been
exercised.

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
surprising while working on bb.

The answer for v1 is `./bin/bb` from the checkout (appendix A) or
`pnpm bb:dev`. The docs must say so plainly, because this is the one case where
the version-lock promise points at an app the developer did not mean.

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

## Testing

- Wrapper generation: snapshot per platform and channel.
- Wrapper resolution: exec a generated wrapper from a temp directory, directly
  and through a symlink, and assert it reports the expected version.
- `NODE_OPTIONS` hygiene: assert stderr is clean when `NODE_OPTIONS` is set.
- Layer 2 refresh: idempotent on repeated launch; corrects a stale link;
  leaves a foreign file untouched and reports it.
- Layer 1 packaging: assert the shipped wrapper is present and executable in a
  built bundle, for both channels.
- `bb install-cli` self-location: resolves the bundle from a packaged CLI path
  and errors clearly when run from an npm-global install with no app.
- Path computation follows the `apps/desktop/test/app-paths.test.ts` pattern.

## Risks

1. ~~`ELECTRON_RUN_AS_NODE` through an AppImage `AppRun` is unverified.~~
   **Retired.** Spiked against the published x86_64 AppImage in an amd64
   OrbStack machine; environment and arguments both pass through, headless, and
   the full wrapper works end to end. See "Linux mechanism, verified" above.
2. **Layer 1 changes the packaging surface.** `extraResources` is a net-new key
   in `electron-builder.config.json`, plus a build step to template the channel
   name into the script, plus an unconfirmed assumption about the executable
   bit. This touches the release pipeline and is worth review from whoever owns
   it.
3. **Putting the bundle's `bin` on `PATH` directly is a sharp edge.** The
   `PATH` line would contain `/Applications/bb.app`, so moving or renaming the
   app breaks the user's shell until they edit their rc. Layer 2 exists so that
   nobody has to do this, and the docs should not present it as an option;
   layer 1 is an implementation detail with a usable side effect, not a
   recommended setup.
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

## Deferred: `bb-dev`

**Not in v1.** A dev-channel command is the most optional part of this design
and the least resolved, and cutting it is what lets the rest be scoped cleanly
to packaged installs.

Why it is categorically different from `bb` and `bb-nightly`, and therefore
cannot simply be a third row in the Naming table: those are app-owned, one
bundle each, self-refreshed on launch. There is no single dev app to own
`bb-dev`, because a developer has N checkouts, each with its own instance. If
the dev desktop app wrote `~/.bb/bin/bb-dev` pointing at itself, whichever
checkout was launched last would hijack every other one. Any `bb-dev` must
therefore resolve from `$PWD` at call time, which makes it a different kind of
artifact from everything else here.

What already covers the need:

- `./bin/bb` from a checkout (appendix A), pinned to the checkout it lives in
- `eval "$(scripts/bb-dev-app env)"; pnpm bb:dev`
- `ln -s /path/to/checkout/bin/bb ~/.bb/bin/bb-<name>` for a per-checkout command

**Precedent.** VS Code deliberately ships no working install-in-PATH for source
builds. The palette entry appears (the action has no dev gate) but fails,
because `getShellCommandLink()` resolves `<appRoot>/bin/code` and `bin/code`
only exists as a build artifact. Their documented answer is
`./scripts/code-cli.sh`, run from the repo.

### What a follow-up would have to resolve

A spike derived ports from `$PWD` and matched `scripts/bb-dev-app status`
exactly for two live checkouts (offsets 1470 and 7817). That is real, but it is
narrower than it looks, and three things block turning it into a design:

- **The derivation is not `realpath`-based.** `scripts/bb-dev-app:167` hashes
  `path.resolve(repoRoot)`, which does not resolve symlinks, and
  `packages/config/src/runtime.ts:104` hashes whatever string it is handed. A
  symlinked checkout path, or anything under macOS's `/tmp`, can therefore
  derive a different instance than the tooling it is meant to match. The two
  checkouts that matched had no symlink in their paths.
- **Ports are not enough.** `resolveCurrentDevProcessEnv`
  (`packages/config/src/runtime.ts:341`) produces a full environment: data
  directory, instance id, `NODE_ENV`, `BB_SERVER_URL`. A standalone `bb-dev`
  would need to reproduce all of it, and nothing has established which parts the
  CLI actually depends on.
- **It would be a third implementation of the same derivation.** See below.
  Shelling out to `scripts/bb-dev-app env` avoids that but reintroduces the
  problem of finding a checkout's script from a checkout-agnostic command.

### Noticed, out of scope

`scripts/bb-dev-app` reimplements the port derivation in shell, duplicating
`resolveDevInstanceConfig` in TypeScript. **These are already out of sync**, not
merely at risk of drifting: `resolvePorts` emits `cloudPort` (through
`reservePackagedAppPorts`) and `cloudWorkerPort`; the shell version emits only
app, server, and daemon. Worth a separate issue.

## Appendix A: `<repo>/bin/bb` (local dev, already landed)

Not part of this feature. Recorded here because the design references it as the
in-checkout answer, and because the reasoning behind its shape is reused by
layer 1.

The repo ships `bin/bb` at its root, run as `./bin/bb`. It exists because the
obvious shortcuts are both wrong. `pnpm bb:dev` is correct but pays pnpm and
turbo startup on every invocation and must be run from the repo.
`apps/cli/bin/bb` is already present and is *not* equivalent: it execs
`apps/cli/dist/index.js` directly and never sets the dev environment, so it
targets the packaged app rather than the checkout's dev instance.

`bin/bb` delegates to `packages/scripts/dist/commands/run-cli.js`, which is what
applies the dev instance environment via `resolveCurrentDevProcessEnv`
(`packages/config/src/runtime.ts:341`). `run-cli.ts` applies it whenever
`NODE_ENV !== "production"`, and `bin/bb` leaves `NODE_ENV` unset, so behavior
matches `pnpm bb:dev`. Missing builds are handled with `cli:prepare`, mirroring
the existing `apps/cli/bin/bb`.

**A symlink to `apps/cli/bin/bb` would not have worked.** That script derives
its paths from `dirname "$0"` without resolving symlinks, so invoking it through
a link at the repo root computes `CLI_ENTRY` as `<repo>/dist/index.js` and
`REPO_ROOT` as two levels above the repo. It fails, and it fails confusingly.
`bin/bb` therefore walks symlinks by hand rather than depending on `realpath(1)`,
which is the BSD variant on macOS and has not always been present. This is the
same reason VS Code hand-rolls the walk in `code.sh`, and the same reason layer
1 does.

The walk also makes one pattern deliberate rather than accidental: `bin/bb`
resolves via `$0` with symlinks resolved, so it is pinned to the checkout it
lives in, no matter where it is invoked from or symlinked to. A hypothetical
`bb-dev` would resolve via `$PWD` instead, meaning whichever checkout you are
standing in. The two are easy to confuse and should not share a naming scheme.

So `ln -s /path/to/checkout/bin/bb ~/.bb/bin/bb-main` yields a command
permanently bound to that checkout.

**Do not add `<repo>/bin` to `PATH`.** It provides `bb`, which would shadow a
packaged app's `bb` depending on order. That is the silent-wrong-version failure
this design exists to prevent. Symlink it under another name instead.

`apps/cli/bin/bb` is intentionally left alone. Adding symlink resolution there
would be a real fix, but it is the published npm `bin` entry and carries its own
blast radius.

**Verified:** correct version from the repo root, from an unrelated working
directory, and through absolute, relative, and chained symlinks. Confirmed to
target the checkout's dev instance by observing the request land on
`127.0.0.1:26817/api/v1/projects`, the port derived for that repo root, rather
than the packaged app's 38886.

## Open questions

Both are small and can be answered during planning.

- Does `bb install-cli` need an uninstall counterpart in v1, or is deleting the
  file sufficient?
- Should layer 2 refresh happen on every launch, or only when the resolved
  target differs from what is already written? Every launch is simpler and the
  cost is one read plus an occasional rewrite.
