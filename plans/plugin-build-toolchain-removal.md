# Plan: Remove the bundled plugin build toolchain

> **SUPERSEDED — rejected.** Replaced by
> [plugin-deps-and-lazy-toolchain.md](plugin-deps-and-lazy-toolchain.md).
>
> This plan proposed publishing `@bb/plugin-build` and making plugins build
> themselves. It was rejected after three review rounds: it bought a permanent
> npm-publishing burden, a coordinated author migration on every pre-1.0 SDK
> minor (`plugin-runtime.ts:823-829` treats 0.x minors as breaking), and a
> large artifact-validation apparatus — all to save the same ~20MB that a
> lazy toolchain fetch saves with none of it.
>
> Kept for the reasoning, which the replacement plan builds on.

## Goal

Stop shipping `esbuild`, `@tailwindcss/node`, and `@tailwindcss/oxide` inside the bb server, CLI, and desktop app. Plugins bring their own copy as a devDependency on a published `@bb/plugin-build`. bb keeps ownership of the build *configuration*; it stops shipping the *compiler*.

## Decision (r2)

bb still builds `git:` and `path:` sources at install. It just uses the plugin's own toolchain instead of a bundled one. `npm:` plugins arrive prebuilt, as today.

This reverses r1's prebuilt-git rule. r1 was rejected because `plugin-runtime.ts:816` requires an **exact** SDK version match while `PLUGIN_SDK_MAJOR` is 0. A prebuilt git tag would break permanently on every host SDK bump, and a pinned ref cannot repair itself. Git installs clone rather than fetch release assets (`managed-plugin-artifacts.ts:377`), so authors would have to recommit `dist/` on every SDK release. Building at install makes git plugins self-healing against SDK drift — the property a pinned ref is supposed to provide.

**The security constraint is preserved by splitting validation from building:**

- **update check** — clone, parse manifest, check compatibility. No `npm install`, no build, no plugin code execution. `plugin-updates.ts:195` calls `stageGitCandidate` on this path, so it must stay inert.
- **install and update apply** — `npm install` then `npm run build`, behind the confirmation the install prompt already shows.

Cost: a check can no longer fully validate a candidate, so "update available" is optimistic and apply can fail. Apply already snapshots and rolls back (`plugin-activation.ts:193-334`), so this is a handled path.

**Corollary: git artifacts keep their `node_modules`.** No pruning. This preserves the source fallback at `plugin-runtime.ts:847`. The cost is disk, bounded by existing artifact GC. Keeping `node_modules` does not by itself break hashing, rollback, or GC — those break only if a later rebuild mutates an already-promoted directory, which the derived-artifact rule below forbids.

**All managed plugins ship both halves built.** (Decided r3.) `npm:` must publish `dist/server.js` + `server.meta.json` as well as the app bundle; `git:` gets both from the install-time build. The source fallback at `plugin-runtime.ts:847` therefore has no remaining consumer among managed sources and is removed. This inverts the stated intent in the comment at `plugin-runtime.ts:820` ("so consumers never need npm or node_modules") for `git:` — update that comment rather than leaving it contradicting the code.

**Rebuilds produce a new derived artifact; they never mutate a promoted one.** `plugin-runtime.ts:891` gates rebuild-on-load to `path:`/`builtin:` only, so extending it to `git:` is new behavior, not preserved behavior. An in-place rebuild would change bytes after `managed-plugin-artifacts.ts:419` recorded their hash, and would silently retarget any rollback snapshot pointing at that directory. Instead: build in staging, hash, promote, and activate through the existing snapshot path. Git cache identity becomes commit + build contract (SDK version, builder version, runtime contract version), not commit alone. `plugin-artifact-gc.ts:20` treats the commit directory as the whole git artifact root and needs a new root rule to match.

**The plugin picks its builder; bb never overrides it.** (Decided r3.)

The consequence is explicit: **git plugins are not self-healing across SDK bumps while the SDK is pre-1.0.** `plugin-runtime.ts:823-829` requires an exact SDK version match because at 0.x a minor bump is breaking. A plugin pinned to `@bb/plugin-build` built against SDK 0.4.1 goes incompatible when bb ships 0.4.2, and rebuilding does not help — the pinned builder stamps 0.4.1 again.

Mitigation is an explicit author action, not a silent override:

- Add `bb plugin upgrade <id>`, which writes the host-matching `@bb/plugin-build` and `@bb/plugin-sdk` versions into the plugin's `package.json` and lockfile, then rebuilds.
- On detecting a stale builder, report `needs-update` naming that command. Do **not** retry the build on every load; bound attempts per artifact.

This resolves at SDK 1.0, when `isPrebuiltServerSdkCompatible` (`plugin-runtime.ts:810-817`) accepts any matching major. Until then, every SDK minor release is a coordinated event requiring `bb plugin upgrade` across all git and path plugins. That is an argument for reaching 1.0 before adding further 0.x surface.

## Why

1. `esbuild` (a Go binary) and `@tailwindcss/oxide` (a napi module) are platform-specific. `apps/server/package.json:7`, `apps/cli/package.json:10`, `packages/bb-app/package.json:71-81`, and `apps/desktop/package.json:31-32` all carry them. Every desktop target ships them. This is the win.
2. Authors get a normal `npm run build` that works in CI and without a bb server running. Today `bb plugin dev` refuses unless the directory is already registered with a live server.
3. Plugin lifecycle scripts move off the update-check path and behind an explicit confirmation.

## What must NOT change

`RUNTIME_SLOT_BY_SPECIFIER` (`packages/plugin-build/src/build-plugin-app.ts:52-73`) lists 20 specifiers that must never be bundled: react x5, `@bb/plugin-sdk/app`, `@pierre/diffs` x2, the 10 portaling radix families, `sonner`, `vaul`. A plugin bundling its own React produces "Invalid hook call" in the *host* app. Two radix portal worlds break focus traps and dismissable layers.

Today this is impossible to get wrong because authors never see the esbuild config. After this change it becomes a contract that must be validated. **Phase 1 ships that validation before anything else.**

## Native dependencies

Unsupported, and this plan does not change that. `build-plugin-server.ts:145` keeps `better-sqlite3` external because plugins get sqlite from the host via `bb.storage`. Installs use `--ignore-scripts`, so gyp never runs. `plugin-runtime.ts:1109-1112` detects `ERR_DLOPEN_FAILED` and reports it.

In-process native modules would require matching Electron's ABI: either `@electron/rebuild` on user machines (a compiler — the thing this plan deletes) or per-platform Electron-ABI prebuilds from every author. Neither is acceptable.

A child process under plain Node is the escape hatch, but it is **not** ABI-free. The binary must match the user's OS, architecture, Node version, and ABI, and a desktop user may have no system Node at all. Author-side compilation does not produce portable binaries for remote users. Document that a plugin needing a native child must satisfy one of:

- ship prebuilds for every supported OS/arch/ABI target, or
- provision the binary at first use on the user's machine (see below), or
- use a non-native implementation.

## Post-install hooks: rejected

Some plugins need a platform-specific runtime artifact (a CUA driver, an LSP server, a browser binary). Do not add a declared post-install hook.

A plugin backend already runs full-trust in the server process and can provision from its factory. A hook adds no capability; it only moves execution earlier, back onto the update-check path this plan just cleared. VS Code omits the hook for the same reason — rust-analyzer and Pylance provision on first activation.

The sanctioned pattern is a background service that provisions on first use, reporting `status.needsConfiguration()` while unavailable. This is also more correct than install-time provisioning: install runs once per data dir, but the artifact depends on the machine that runs it.

**Follow-up, non-blocking:** `PluginStorage` exposes KV and sqlite but no filesystem path, so there is nowhere sanctioned to put a binary. Add `experimental_cacheDir` resolving to `<dataDir>/plugins/<id>/cache/`, created on demand, deleted on uninstall, with an entry in `docs/api_to_audit.md`. Audit before stabilizing: whether uninstall should preserve it (`data.db` and kv rows currently survive removal), and whether GC should bound its size.

**Out of scope:** a driver that must run on an enrolled host rather than the server machine. `PluginHosts` (`backend-contract.ts:624-641`) covers only shared-port tunnels; plugin backends have no host-daemon execution path. Separate architectural gap.

## Current build call sites

| Site | Purpose | Disposition |
|---|---|---|
| `managed-plugin-artifacts.ts:183` | install-time build, **inside the `manifest.appEntry !== undefined` branch at :169** | spawn `npm install --include=dev` + `npm run build`, and **move build preparation outside the frontend condition** — a headless git plugin still needs deps, `dist/server.js`, and `server.meta.json`. Artifact validation stays conditional by artifact kind |
| `plugin-runtime.ts:901` | rebuild on load; gated to `path:`/`builtin:` at `:891` | extend to `git:` as a **derived staged artifact**, not an in-place rebuild |
| `plugin-service.ts:1399` | builtin source watch loop | unchanged; monorepo dev only |
| `apps/server/scripts/copy-builtin-plugins.ts:99,106` | build bundled plugins into the app | unchanged; build-time script |
| `scripts/build-official-plugins.mjs:45` | build official plugins for release | unchanged; build-time script |
| `apps/cli/src/commands/plugin.ts:708,721` | `bb plugin build` | spawn `npm run build` |
| `apps/cli/src/commands/plugin.ts:776` | `bb plugin dev` rebuild | spawn `npm run build` |

## Phases

Ordered so each release is safe against the previously shipped one.

### Phase 1 — Runtime fingerprint, read-only

Lands alone. No behavior change beyond a warning.

1. Store an **app runtime contract**, not a bare hash. A hash supports equality only; it cannot express the directional export rule below. App metadata carries the canonical slot map and export sets as structured data, with an optional hash over that structure for integrity and quick identity. The builder derives it from the exact slot and export data used for *that build*, not from a statically named constant — `build-plugin-app.ts:101` can discover SDK exports from the installed SDK package, so serializing `RUNTIME_EXPORT_MANIFEST` unconditionally would record data the build did not use.
2. Canonical serialization: sorted specifiers, sorted export lists, explicit `fingerprintFormatVersion`, and an assertion that the slot-map and export-map key sets are equal.
3. Two comparison rules over the structured contract, not one:
   - **slot map** — exact equality. A changed slot *value* is as breaking as a changed key.
   - **exports** — directional. The host's export set must *contain* the artifact's. An old bundle cannot use an export that did not exist when it was built, so exact equality would disable every plugin frontend on any harmless React/radix/SDK export addition.
4. Stamp and validate the fingerprint on **app artifacts only**. `createPluginArtifactMeta` (`plugin-artifact-meta.ts:7`) is shared with `build-plugin-server.ts:151`; a frontend fingerprint is meaningless for a server artifact and would let a frontend change reject a valid server bundle. Use a separate app-metadata creator or an explicit artifact kind.
5. Bump `artifactFormatVersion` to 2. The host reads both formats. A missing or mismatched contract logs a warning and loads. Nothing is rejected in this phase.
6. Bound rebuild attempts. A stale builder reproduces the same mismatch forever, so a mismatch must not drive an unbounded rebuild loop.
6. Document it honestly: **stale-builder detection, not bundle-content proof.** The metadata records what the builder claims; it does not prove a bundle excluded React. Acceptable — plugins are full-trust, so the threat model is author error, not author malice.

### Phase 2 — Publish the builder

1. Give `@bb/plugin-build` a real version, a `dist/`, and a `bin`: `bb-plugin`. `bb-plugin build` runs `buildPluginServer` + `buildPluginApp` against `process.cwd()`.
2. Resolve the workspace dependency on `@bb/plugin-sdk`. `build-plugin-app.ts:101` resolves `@bb/plugin-sdk/app` to discover exports, so inlining three `@bb/domain` symbols is insufficient. Choose: publish `@bb/plugin-sdk`, or generate the export manifest fully at builder-publish time so the builder needs no SDK resolution. This choice interacts with phase 1 step 1 — see open question 1.
3. Version contract:
   - Both build functions take a `bbVersion`. A standalone binary has no host to ask. Replace it with the builder's own version, recorded as `builtWith.builderVersion`.
   - The builder pins an exact target SDK version and declares its supported host range, because `plugin-runtime.ts:816` demands exact SDK equality while the major is 0.
   - The fingerprint is checked **independently** of SDK-major compatibility. `app-bundle.ts:281` validates only the major today. They fail differently and must report differently.

### Phase 3 — Author surfaces and server compatibility

1. `bb plugin new` (`plugin.ts:638`) scaffolds `@bb/plugin-build` in `devDependencies` and `"build": "bb-plugin build"`, then runs `npm install` before printing next steps.
2. `bb plugin build` and `bb plugin dev` spawn `npm run build`. `createPluginDevLoop` (`plugin-dev-loop.ts:29`) already injects `buildApp`; swap the call at `plugin.ts:776`. Watcher, debounce, and reload POST unchanged. `bb plugin dev` stays in the CLI because it resolves the plugin id from the server's installed rows (`plugin.ts:761-770`).
3. **Compatibility fallback, CLI *and* server.** A CLI-only fallback is insufficient: phase 4 makes the *server* run `npm run build`, and a plugin installed under phase 3 may have no build script and no builder dependency. Both `bb plugin build`/`dev` and server install/rebuild fall back to the bundled builder, with a warning naming the removal release. Phase 4 may remove it only after that period.
4. **Migrate active git artifacts.** Existing git artifacts have no `node_modules` at all, because the current git path never runs `npm install`. Create new derived artifacts for them while the bundled builder is still available. Do not modify or replace the directories that existing rollback snapshots reference.
4. Migrate every plugin in `official-plugins/` to the new script.
5. Update `packages/templates/src/templates/bb-guide-plugins.md:220` and `apps/server/src/services/skills/builtin-skills/bb-plugin-authoring/SKILL.md:49`, which document automatic `path:`/`git:` builds. Add the native-dependency guidance above.

### Phase 4 — Server switches to the plugin's toolchain

Ships after phase 3 has been out long enough for authors to migrate.

1. In `validateInstallDir` (`managed-plugin-artifacts.ts:148-226`), replace the `buildPluginApp` call with a spawned `npm install --include=dev` + `npm run build`, and hoist it out of the `manifest.appEntry` branch at `:169` so headless git plugins are covered. Build **both** bundles, so `dist/server.js` and `server.meta.json` always exist for managed git sources — `:219` does not require them today.
   - Use `--include=dev` explicitly: a production server may set `NODE_ENV=production`, under which a plain `npm install` omits `devDependencies` including the builder.
   - Define the lockfile policy (`npm ci` when a lockfile is present, else `npm install`) and the standard flag set.
   - **Lifecycle scripts run on this path.** That is deliberate and is why it sits behind the install/apply confirmation and never on the check path.
2. Keep `node_modules` in the promoted artifact. This preserves the source fallback at `plugin-runtime.ts:847` and keeps rebuild-on-load viable.
3. Split the update path. `stageGitCandidate` under a *check* does clone + manifest parse + compatibility check only. Building moves to apply. Verify no plugin code executes on the check path.
4. Validate the **exact** server SDK version during install and update **apply, before hashing and promotion** — not at update selection. A check does not build, so the candidate commit has no server artifact to validate; a check can only verify manifest engine ranges and static source identity. Today `app-bundle.ts:281` checks the major and `plugin-runtime.ts:816` checks exact, so an unvalidated candidate can pass and then fail after promotion, forcing a rollback.
   - Keep **separate check and apply functions**. A shared `promote` boolean on `stageGitCandidate` makes it too easy to reach `validateInstallDir` from the check path by accident.
5. Promote the phase 1 contract mismatch to a **frontend-only** failure for `npm:` artifacts, which cannot rebuild. For `git:`/`path:`, a mismatch triggers a rebuild instead.
   - `validatePluginArtifactMeta` (`apps/server/src/services/plugins/app-bundle.ts:270-292`) returns an error string that managed install rejects at `managed-plugin-artifacts.ts:208`. Keep that for install.
   - For an installed plugin, route the result into frontend bundle compatibility, not whole-plugin status. `plugin-frontend.ts:164` derives `needs-update` solely from `bundle.compatible`, and `packages/server-contract/src/api/plugins.ts:132` carries no reason. Add a reason field.
   - `plugin-runtime.ts:798` validates the packaged-builtin server artifact and then the app artifact, and a bad app artifact marks the whole plugin incompatible. Split these: a bad app fingerprint disables the frontend only; the backend keeps running.
6. Surface build failures with the failing step named. A raw `npm ERR!` reaching a user who just wanted to try a plugin is the main UX risk in this change. Keep diagnostics in a separate bounded directory with explicit cleanup — do **not** retain staging directories, which `managed-plugin-artifacts.ts:476` deletes on failure and which `plugin-artifact-gc.ts:40` cannot reclaim without a database record.

### Phase 5 — Drop the dependencies

Prerequisites, all required before this phase starts:

- The phase 3 compatibility fallback has been removed after its stated release.
- Open question 2 (`path:` policy) is decided.
- No server or CLI code path can still invoke a bundled builder.

Then:

1. Remove `esbuild`, `tailwindcss`, `@tailwindcss/node`, `@tailwindcss/oxide` from `apps/server/package.json`, `apps/cli/package.json`, and `packages/bb-app/package.json:71-81`. Drop the matching `--external` flags.
2. Drop the per-architecture `@esbuild/*` optional dependencies from `apps/desktop/package.json:31-32`. Update `apps/desktop/scripts/prepare-native-modules.cjs:13` and the runtime-externals list in `scripts/build-utils.mjs:25`. Desktop packaging tests assert these are present and must be updated.
3. `apps/host-daemon` bundles the CLI (`bundle-manifest.mjs:79`) and regenerates the runtime export manifest (`build-bundles.mjs:16`). Both need updating.
4. Assert in a test that no bundled runtime code imports the removed packages.
5. Build-time esbuild in the monorepo, desktop build scripts, and host-daemon development stays.
6. This change alters no server/daemon wire message, so it does not require a `HOST_DAEMON_PROTOCOL_VERSION` bump on its own. Bump if implementation changes any daemon message or result.

## Accepted costs

- **`npm` becomes required for `git:` installs.** They need only `git` today. bb already shells out to a bare `npm` for npm installs (`managed-plugin-artifacts.ts:276`), so this is not a new class of dependency, but it is new for that path.
- **Larger, slower git installs.** Full devDependencies per git plugin, retained in the artifact.
- **Offline `git:` installs stop working.**
- **Slower dev rebuilds.** In-process esbuild (~100ms) becomes a spawned `npm run build` (~500ms+). Measure before optimizing. If bad, add an incremental `bb-plugin dev-build` holding an esbuild context open, talking to `bb plugin dev` over stdio.
- **First run needs `npm install`.** Mitigated by phase 3 step 1.
- **Optimistic update checks.** A check can report "update available" for a candidate that later fails to build.
- **The runtime contract is advisory.** It catches stale builders, not adversarial ones.

## Open questions

All four r2 questions are decided. Remaining:

1. **Publish `@bb/plugin-sdk`, or route it through `bb-app`?** (r3: publish is the leaning.) Publishing is the smaller step and the SDK is already every plugin's peer dependency. Routing through `bb-app` gives authors one dependency instead of two but pulls the app package into their tree. Revisit if the two-dependency requirement proves annoying.
2. **Timing of SDK 1.0.** Not strictly part of this plan, but the pre-1.0 exact-match rule is what makes builder pinning painful. If 1.0 is near, some of the `bb plugin upgrade` machinery is short-lived.

## Decisions (r3)

| Question | Decision |
|---|---|
| Who picks the builder version | The plugin. bb suggests `bb plugin upgrade`, never overrides |
| SDK distribution | Publish `@bb/plugin-sdk` to npm |
| `path:` install-time build | bb keeps building it, by spawning the plugin's `npm run build` |
| Meaning of "prebuilt" | Both halves, for every managed source. Source fallback removed |

## Validation

- `build-plugin-app.test.ts` and `runtime-export-manifest.test.ts` still pass.
- Fingerprint: changing a slot *value* changes it; adding a host export does **not** invalidate an older artifact; removing a host export does.
- A contract mismatch on an `npm:` plugin disables the frontend only; the backend stays `running`.
- A contract mismatch on a `git:` plugin triggers a rebuild.
- An update *check* on a git plugin executes no plugin code and writes nothing outside staging.
- A candidate whose server SDK version is incompatible is rejected during apply, before hashing and promotion.
- An update check never reaches `validateInstallDir`.
- A rebuild produces a new artifact directory; the directory an existing rollback snapshot references is byte-identical afterward.
- A headless git plugin (no `bb.app`) gets `node_modules`, `dist/server.js`, and `server.meta.json`.
- A server running with `NODE_ENV=production` still installs the plugin's devDependencies.
- A plugin whose declared builder range excludes every host-compatible builder fails once with a clear message and does not retry on subsequent loads.
- A legacy format-1 git artifact restarts, rolls back, and survives GC.
- A `git:` plugin whose build fails leaves the previously installed version running.
- Manual: install a `git:` plugin with a frontend on a machine with no bb toolchain; confirm one React.
- Manual: `bb plugin new` -> `bb plugin install .` -> `bb plugin dev`, clean machine.
- The packaged desktop app contains no `esbuild` or oxide binaries.
