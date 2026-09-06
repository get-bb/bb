# Decisions — bb wn (native Windows 11 x64 port)

Each entry records what was decided, what was rejected, and why. Made without
consulting a human, as instructed. Date: 2026-09-06.

---

## D1. The Windows machine is GitHub Actions `windows-latest`

**Context.** The work was driven from a Contabo VPS running Ubuntu 24.04. There
is no Windows on it and never will be.

**Checked, not assumed.** The operator's Windows workstation is on the same
tailnet and answers ICMP (71 ms, direct connection). Ports 22, 5985, 5986 and
3389 were probed: **all four closed**. No SSH server, no WinRM, no RDP;
Tailscale SSH does not support Windows as a server. It cannot be automated, and
the operator explicitly asked that it not be used.

**Decision.** Windows truth comes from `windows-latest` runners on the fork
`zqkra/bb-wn`. The runner reports **Windows Server 2025, build 10.0.26100** —
the same build number as Windows 11 24H2, hence the same kernel and the same API
surface for ConPTY, NSIS, Job Objects and path semantics.

**Cost.** Zero: the fork is public, and Actions minutes are free on public
repositories, Windows runners included.

**What this does not prove, stated plainly.** Server 2025 is not Windows 11
Desktop. It does not prove double-click launch on a real desktop, the NSIS
installer against SmartScreen or Defender, or behaviour with a genuine
interactive user. That belongs in `qa/CHECKLIST-WIN11.md`, for a human to run.

---

## D2. Platform is **injected**, never ambient

**Decision.** Every function whose behaviour depends on the operating system
takes `platform` as a parameter instead of reading `process.platform` internally.

**Why.** This is not purism. It is the only way to make Windows behaviour
**testable from Linux**, which is where every line of this port was written. A
function that reads `process.platform` internally can only be tested on Windows,
and each Windows CI round trip costs about eleven minutes. One that receives it
is tested in a second, on both branches, locally.

This decision shaped the quality of the result more than any other.

**The cost it carried, and the correction.** One worker made the parameter
*required*, which broke every caller it did not own. The fix was not an ambient
default: `@bb/domain` also runs in the browser, where `process` does not exist,
and more importantly the path being validated belongs to a **host**, which may
be a different machine than the one validating. A browser on macOS can register
`C:\project` on a Windows host. The contract-level schema therefore validates
*shape* permissively, and the host daemon — which knows its own platform — does
the strict check. That split is what the repository's own `AGENTS.md` prescribes.

---

## D3. Contracts widen; they do not break

`HostPlatform` goes from `"darwin" | "linux" | "wsl" | "unknown"` to include
`"win32"`. `BbDesktopInfo["platform"]` gains `"windows"`.

This is **additive**, not a reshaping. Previously every Windows host collapsed to
`"unknown"`, which is precisely the bug.

`HOST_DAEMON_PROTOCOL_VERSION` goes 183 → 184 because `statusResponse.platform`
is a wire field whose value domain changed — required by the repository's own
`AGENTS.md`. This was centralised in the coordinator: the thirteen workers were
forbidden from touching that constant, because thirteen parallel increments
collide.

---

## D4. Windows `appId` and `productName` are injected, not rewritten

**The problem.** `appId` and `productName` are global in electron-builder.
Setting `cl.bb.wn` / `bb wn` directly in `electron-builder.config.json` would
also change the identity of the macOS and Linux artifacts — breaking their
updater — and would fail `test/electron-builder-config.test.ts`, which pins the
current values.

**Decision.** They are injected as a **Windows-only** override in
`scripts/run-electron-builder.mjs`, which already generates a merged
`.electron-builder.generated.json` from the base config plus release-channel
logic. macOS and Linux are untouched.

---

## D5. Thirteen parallel workers with disjoint file ownership

**Rejected:** a single shared checkout. Thirteen agents running `git add -A` over
one tree step on each other.

**Decision.** One git worktree per worker, explicit file ownership, and a ban on
touching anything outside one's own list. What a worker needs from someone
else's files goes into "needs coordination" in its report and the coordinator
routes it. This prevented a real collision: one worker began editing another's
native folder picker and was stopped mid-flight.

**Forbidden to workers:** adding or removing dependencies, and touching
`pnpm-lock.yaml`. A lockfile change desynchronises every worktree and the
Windows runner simultaneously.

**Result:** all eleven branches merged with zero conflicts.

---

## D6. Probe Windows first, write code second

**Decision.** Before distributing any work, a CI probe was pushed with
`continue-on-error` on every step, so that **a single run returned the entire
failure surface** instead of stopping at the first error.

**Immediate return.** It found three things no amount of reading on Linux would
have produced:

1. `packages/bb-app/package.json` carried the same `os: ["darwin","linux"]`
   allowlist as `apps/desktop` — blocking the very package the desktop app
   bundles.
2. `plugin-build` rejected **every** builtin plugin on Windows because of
   `startsWith(rootDir + "/")` with a hardcoded slash, in six places. It broke
   the entire build.
3. `plugin-registry` collided `components\ui\toggle.tsx` with
   `components/ui/toggle.tsx` by mixing separators.

None of these were guessable. This is what justified opening the plugin-build
task on evidence rather than intuition.

---

## D7. Machine load is a hard constraint

**What happened.** Eleven agents each running `turbo` on six vCPUs drove the load
average to 17.7. The `herdr` service died and cut the operator's session
mid-session. It was not memory exhaustion — 8.6 GB were free. It was CPU.

**Decision.** At most four concurrent workers, agents reniced to +10, and a
mandatory `check.sh` wrapper that takes a global `flock` and **refuses any turbo
invocation without `--filter`**. Serialising builds costs seconds; losing the
machine cost twenty minutes of recovery.

**Corollary learned the hard way:** after a `herdr` restart the panes come back
with fresh agent processes that have lost their `CBDS_*` environment, so they can
never report. The files survive, the processes do not — commit defensively.

---

## D8. Prior art is adapted, not reinvented

Two MIT-licensed repositories were cloned locally as reference:
[`stablyai/orca`](https://github.com/stablyai/orca) (an Electron desktop app for
agent fleets, with Windows support in production) and
[`traycerai/traycer`](https://github.com/traycerai/traycer). Both MIT, like bb,
so adaptation is legally clean.

Rules imposed: understand and adapt rather than copy wholesale, cite the source
in the report and never in the code, and never add a dependency because the
reference uses one.

Two findings came from this that the team would not have reached alone:

- The `cmd.exe /c` path with caret-escaped arguments **causes Microsoft Defender
  for Endpoint to score the command line as obfuscation**; Orca had a real
  incident with `codex.cmd`. Reading the shim body that npm and pnpm generate and
  spawning `node.exe <script>` directly avoids cmd.exe entirely.
- **`wmic` was removed in Windows 11 24H2**, and turning "could not read the
  process table" into an empty array cost Orca a PTY tree that survived its own
  teardown. That is exactly the bug bb had with `if (win32) return []`.
