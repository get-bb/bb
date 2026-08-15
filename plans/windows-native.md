# Native Windows

Finish the source-checkout path on Windows 11 so #1426 is mergeable.

Related:

- `plans/windows-native-later.md` is the rest of #1206. Do not start it to land this PR.
- [#1206](https://github.com/get-bb/bb/issues/1206) is the product program, written by Rodion Mostovoi ([@rodion-m](https://github.com/rodion-m)). Sawyer has not signed it.
- [#1426](https://github.com/get-bb/bb/pull/1426) is this branch.
- `.windows-native/` is a local proof tracker. It does not ship.

## Credit

Five seams, `pathKey`, verification IDs, and the GA definition of done come from Rodion's #1206 design and verification attachments.

The first-cut vs GA *split* is this PR's answer to Rodion asking why #1426 is not the entire #1206. Same move as #1392 (Linux AppImage without signing, CI, or a download button). Do not credit the split to #1206.

Interim preview and lexical containment here are not his `pathKey` model. That stays in `windows-native-later.md`.

## Goal

A Win11 checkout runs `npx bb-app`, the `bb` CLI, server, host-daemon, web UI, a `C:\` project, a worktree, a terminal, and one already-installed provider. Node never `spawn`s a `.cmd`. Preview and path dialogs understand drive letters.

This is not published support. No signed installer, no Windows CI gate, no landing-page CTA.

## Current state

#1426 already made `win32` a `HostPlatform`, accepted drive-letter and UNC input, shipped ConPTY, PATHEXT lookup, `taskkill` stop, Git `sh.exe` setup hooks, and an unsigned NSIS recipe. Desktop contract `platform` already includes `"windows"`. Linux `dist:linux` / AppImage from #1392/#1501 is back on this branch. `bb-app` still lists `os: win32` (npm install gate, no Windows CI). Docs and landing already rolled back published-support and UNC claims.

`origin/main` still has `hostPlatformSchema` = `darwin | linux | wsl | unknown`. This branch added `win32` to that enum, and the value rides `HostDaemonSessionOpenRequest.platform`. That is a wire change. Protocol is still `123` on both sides.

`.windows-native/TRACKER.md` and `INVENTORY.md` are a 2026-08-12 snapshot. Do not plan from them.

Do not mark any `WIN-*` ID from #1206 done.

## Recommendation

One launch spec. `jsEntryPath` is always the JS bundle. `shellPath` is `bb.cmd` on win32 and the same JS file on Unix. Node spawn is `process.execPath` plus `jsEntryPath`. Agent shells get `BB_CLI=shellPath`. Reject `shell: true` on every spawn.

Do not introduce a `HostPath` type or `pathKey` here. Preview helpers and case-folded containment unblock merge. Daemon-owned paths live in the later plan.

There is no implementation DAG left. Items 1–4 sequential, “11 after 10”, and “15 after 8” are history. Shapes 2, 10, and 15 exist. Finish the leftovers below in any order, then run Verify.

## Rules

Server owns product policy. Daemon owns host primitives. Desktop owns the Electron shell.

Five seams, from Rodion's #1206, and only those: host paths, executable and env discovery, process launch and stop, terminal and shell, open and reveal. If a helper already exists, call it.

Bump `HOST_DAEMON_PROTOCOL_VERSION` when a session payload, host RPC, or provision path string changes meaning. Adding `win32` to `hostPlatformSchema` is such a change. CLI spawn and UI labels do not bump. Do not switch join to `getDaemonPlatformForHost` (`null`/`unknown` would force posix). Keep `hostPathKindFromDataDir`.

`execFile("npm")` on Windows is `npm.cmd`. Tests that need `taskkill` or Git Bash use `it.skipIf`. An early `return` that still marks the test green is a bug.

Do not spawn `wsl.exe`. WSL is a separate Linux host.

```
pnpm exec turbo run typecheck --filter=@bb/app --filter=@bb/host-daemon --filter=bb-app --filter=@bb/desktop --filter=@bb/config --filter=@bb/host-workspace --filter=@bb/domain --filter=@bb/server --filter=@bb/process-utils --filter=@bb/local-open-targets
```

Run that after every item, plus the filter named in the item. Do not call package scripts directly.

## Land

Status after leftover pass (2026-08-14): review #3 leftovers P/5/7/9/13 are in the tree. Fable was unavailable (`claude` not logged in). Companion Sol hit `ENAMETOOLONG`; raw `codex exec` is the receipt.

| # | Status | Note |
| --- | --- | --- |
| 0 rebase linux | done | `dist:linux` + AppImage coexist with `dist:win` |
| 1 labels | done | `win32` → `"Windows"` on both maps |
| 2 launch spec | done | `BbCliLaunchSpec` + `spawnArgv` — do not redesign |
| 3 Node spawn | done | launcher + reexec use `execPath` + JS |
| 4 PATHEXT shim | done | probe is JS; `BB_CLI` is `bb.cmd` on win32 |
| 5 absolute path | done | helpers + drive-letter preview href / `file://` |
| 6 watcher test | done in tree | pack remains the copy proof |
| 7 docs | done | README lead names Windows; published-support rollback stays |
| 8 containment | done | lexical; junctions/UNC later |
| 9 spawn/env | done | `host-watcher` `git status` sets `windowsHide` |
| 10 process stop | done | `readIdentity` + `killWindowsProcessTree` |
| 11 terminal/Git | done | command-mode `cmd /d /s /c` tested; spawn-helper tests use `skipIf` |
| 12 provider | done | UI hides `curl \| bash`; RPC install path is later |
| 13 log viewer | done | incremental read uses `bytesRead` and holds a split UTF-8 suffix |
| 14 dialog/open | done | Explorer is folder-only (`openFile: false`) |
| 15 host path join | done | kind from `dataDir`. Wire bump is the `win32` enum, not this join |
| P protocol | done | `HOST_DAEMON_PROTOCOL_VERSION` is 124 |

## Leftovers (review #3)

P, 4, 5, 7, 9, 11, 13, and 14 are in the tree.

- **4.** Probe stays `execPath` + JS. Injected `BB_CLI` is `bb.cmd` on win32 (`bbShellPathForResolvedJs`).
- **11.** `it.skipIf` replaced green `return`. Command-mode `cmd.exe` asserts `/d /s /c`.
- **14.** Explorer advertises `openFile: false` and rejects a file path. Folder open is `explorer.exe <directory>`.

Do not mark any `WIN-*` ID done.

## Verify

On this Win11 checkout, after leftovers P/5/7/9/13 (now in tree):

1. `pnpm exec turbo run build --filter=@bb/host-daemon --filter=bb-app --filter=@bb/cli`
2. Protocol constant is greater than `123`. A session open with `platform: "win32"` parses.
3. Inside a spawned agent env, `echo %BB_CLI%` is a path that exists.
4. Launcher spawn is `node` plus `host-daemon/dist/bb`, not `bb.cmd`.
5. `bb --version` works through the `.cmd` shim. A repo-local `node.exe` in cwd is not used.
6. Connected win32 host label is `Windows`.
7. Preview of `C:\repo\docs\a.md` resolves `./other.md` under `C:\repo\docs`. Mixed `C:/repo` vs `C:\repo\file` is inside the workspace.
8. Project path dialog placeholder is a drive-letter example.

`package:win` on this machine (unit tests do not close these):

1. Owned runtime stop kills grandchildren (`taskkill /T`).
2. `git status` from the packaged host does not flash a console.
3. Opening the log viewer does not block pino-roll rename. A non-ASCII line is not mojibake.

Do not mark a verification ID from Rodion's #1206 plan done. Those need WSL disabled, packed artifacts, and a separate Linux/macOS/WSL lane. See `plans/windows-native-later.md`.
