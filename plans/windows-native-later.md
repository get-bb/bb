# Native Windows, later

The rest of Rodion Mostovoi's ([@rodion-m](https://github.com/rodion-m)) proposal: [#1206](https://github.com/get-bb/bb/issues/1206). Not required to land [#1426](https://github.com/get-bb/bb/pull/1426).

Related: `plans/windows-native.md` is the work that ships first.

Status (2026-08-14, review #3): parked. Sawyer has not signed #1206. First-cut land 0 is done (`dist:linux` / AppImage). Docs no longer claim UNC. First-cut bumped the protocol for adding `win32` to `hostPlatformSchema` (that enum is on the session wire; `origin/main` does not have it).

## Credit

This file follows Rodion's #1206 design and verification attachments. The phases, seams, `pathKey` model, no-WSL proof, CI matrix, and definition of done are his. The first-cut vs later *split* is #1426's, not his — he asked why that PR is not the entire program. Items below are that program minus what the first-cut PR already covers.

## Why this file exists

#1206 is the only product-level Windows plan on the repo. The blast radius is the whole host, desktop, CI, and release pipeline.

#1426 is the first cut, the same way #1392 shipped a Linux AppImage without signing, CI, or a download button. Rodion asked on #1426 why we are not doing all of #1206. This file is the answer. The items below stay on one roadmap so nobody invents a second one.

## Map

| #1206 | In `windows-native.md` | Here |
| --- | --- | --- |
| 0 foundation, `bb-dev-app`, honest CI |  | Dev supervisor, CI skeleton |
| 1 host identity, daemon-owned paths, `pathKey` | Labels, preview, containment, server-side join | Path identity |
| 2 process, env, Git, setup, open | Launch spec, spawn, stop, terminal, Explorer | Registry PATH, `.ps1` hook |
| 3 ConPTY, providers, watcher, native `bb-app` | Watcher test, hide `curl \| bash`, log viewer | No-WSL beta, provider matrix |
| 4 signed Desktop and update | Unsigned NSIS already in #1426 | Signing, `latest.yml`, uninstall |
| 5 persistent host and required CI |  | `install-machine.ps1`, port collision |

#1392 already widened Desktop `platform` to `macos | linux` and parameterized `afterPack`, update gating, and packaged PATH. Anything here must keep that path green.

## Deliberate gaps vs #1206

#1426 accepts UNC input. #1206 defers UNC. Keep accept-on-input. Do not document UNC as supported. `docs/platform-support.md` and `packages/bb-app/README.md` already dropped UNC. Do not add it back. Do not add device-namespace work.

`os: win32` on `bb-app` lets `npx` install on Windows. It does not by itself publish a Desktop artifact. `@bb/desktop` on this branch replacing `linux` with `win32` is the #1501 publisher break. Keep Desktop `os` as `darwin` plus `linux` plus `win32` after rebase, and do not add Windows to the required publish job until there is a feed. #1206 section 6 still wants the native suite green before advertising npm Windows.

This checkout has #1392/#1501 Linux AppImage again (`dist:linux`, builder `linux` block). Keep that path green. A further rebase is only needed if `main` moved.

Item 11 in the first plan runs `.bb-env-setup.sh` through Git `sh.exe`. #1206 forbids Git Bash as bb's own runtime and wants `.bb-env-setup.ps1`. Do not add more Git-Bash surfaces. The PowerShell hook is below.

Items 8 and 15 still join and compare on the server. #1206 wants the daemon to return `{ path, pathKey }`. Path identity below replaces both.

#1206 verification requires WSL disabled. The first plan proves a source checkout on a machine that may have WSL installed. It must not spawn `wsl.exe`. It must not claim GA.

#1206 makes Windows a required CI gate before the support claim. We do not, until the skeleton below is green.

## Rules that survive

Five seams only: host paths, executable and env discovery, process launch and stop, terminal and shell, open and reveal.

WSL stays a separate Linux host identity. No silent fallback.

Server does not construct host filesystem paths. Daemon returns `{ path, pathKey }`.

Desktop contract name is already `"windows"` on this branch (`desktopPlatformFromNode("win32")`). Remaining gap is updater / version-feed, not the enum.

Do not claim sandbox parity. Claude sandbox is macOS, Linux, and WSL today. Cursor native install is upstream-gated. Show a capability message, not a doomed button.

Pin a known-good Windows runner image. Do not float blindly on `windows-latest`.

Bump the protocol on every wire change.

## Work

Follows Rodion's #1206 phases. Section numbers below are his.

### Path identity

#1206 sections 4.3 to 4.5. Replaces the interim join and containment in the first plan.

`CanonicalHostPath { path, pathKey }`. Persist `path_key` on `project_sources` and `environments`. The daemon canonicalizes with `fs.realpath.native` and a case-insensitive key for ordinary NTFS. Reject `\\.\` and unsafe `\\?\GLOBALROOT`. Do not persist `\\?\`.

The provision command stops taking a server-computed target path. The daemon derives `%USERPROFILE%\.bb\worktrees\...`. Per-directory NTFS case-sensitive mode stays out of contract.

Protocol bump required.

### Registry PATH

#1206 §5.4. GUI-launched Desktop has a stripped PATH. #1392 solved this on Linux with a login-shell `-ilc`. Windows reads HKCU/HKLM environment, not `pwsh -ilc`.

Extend the packaged PATH hydrator that #1392 already parameterized. Do not add a third spawn helper.

### PowerShell setup hook

#1206 §5.6. First-class `.bb-env-setup.ps1`, with timeout, stream, and cancel through the shared tree-kill helper.

### Dev supervisor

#1206 phase 0. Replace `scripts/bb-dev-app` (`screen`, `lsof`, `ps`) with a Node supervisor so source-dev on Win11 does not need Git Bash.

### CI skeleton

#1206 phase 0. A non-required job first: install, typecheck, and host-sensitive package tests on a pinned Windows x64 image. Keep npm and Desktop `os` gates until that job is green. Ubuntu stays the required gate.

A later required Windows gate is GA, not #1426.

### No-WSL beta

#1206 phase 3. Clean Win11 x64 standard user, WSL feature disabled. `npx bb-app`, project on `C:\` and `D:\`, ConPTY, watcher, Codex and Claude native start, zero `wsl.exe` descendants.

First time docs may call native Windows a beta runtime. Landing CTA stays WSL until then (#341).

### Provider matrix

#1206 §5.9. Native installers where upstream has a verified `.exe`. Fake `.exe` and `.cmd` launch tests in CI. No install button for an unverified upstream. ACP launch spec stays `{ command, args, env, cwd }`. Spaces in paths. PATHEXT for ACP lives here.

### Signed Desktop

#1206 phase 4. Azure Artifact Signing if eligible, else EV on a cloud HSM. `latest.yml`, blockmap, `publisherName` exact match. Stop the process tree before update so files are not locked. Standard-user NSIS install, use, N to N+1, use, uninstall. No unsigned fallback on stable.

### Persistent host

#1206 phase 5 and #1121. `install-machine.ps1`, Task Scheduler at logon. Desktop's child-owned runtime stays separate. An enrolled daemon must not crash-loop on `38887` when Desktop already holds it.

## Out of contract

From #1206 §13, unchanged:

- WSL as an automatic fallback
- Desktop Local / WSL environment selector
- A bb-owned Windows agent sandbox
- Windows ARM64 artifacts
- Windows 10
- UNC, device, and network-share guarantees
- MSI, MSIX, Store, and per-machine install
- A machine-wide Windows service
- Bundling Git, Node, or provider CLIs
- WinGet until a stable installer history exists

Idle non-Codex process reclaim is #1604. It is not a Windows item.

## Sources

Searched `get-bb/bb` for native Windows, Win11, win32, WSL2, NSIS, ConPTY, PATHEXT. Generic `windows` matches timeline windows. There is no `windows` label.

| Item | State | Role |
| --- | --- | --- |
| [#1206](https://github.com/get-bb/bb/issues/1206) | open | Rodion Mostovoi ([@rodion-m](https://github.com/rodion-m)). [Design](https://github.com/user-attachments/files/30864012/Native.Windows.11.support.for.bb.and.bb.Desktop.md). [Verification](https://github.com/user-attachments/files/30910457/Native.Windows.11.support.for.bb.and.bb.Desktop.-.Verification.md). |
| [#1426](https://github.com/get-bb/bb/pull/1426) | open | This branch. No formal review. Rodion asked why it is not all of #1206. |
| [#1392](https://github.com/get-bb/bb/pull/1392) | merged | Linux AppImage. Shared packaging helpers. Sawyer tested on WSL. |
| [#341](https://github.com/get-bb/bb/pull/341) | merged | README and landing say Windows needs WSL2. |
| [#1121](https://github.com/get-bb/bb/issues/1121) | closed | Desktop holds `38887`. A second enrolled daemon crash-loops. |
| [#1604](https://github.com/get-bb/bb/issues/1604) | open | Idle non-Codex agents are never reaped. |

#892 and #367 already shipped the folder picker and remote path selector. #1206 prefers those plus text entry over `IFileDialog`.

No issue exists for `.bb-env-setup.ps1`, registry PATH, `pathKey`, Authenticode, WinGet, ARM64, ConPTY, PATHEXT, or the `bb-dev-app` rewrite. Those live only in the #1206 attachments.
