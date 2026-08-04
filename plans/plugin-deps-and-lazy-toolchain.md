# Plan: git plugin dependencies + lazy toolchain fetch

Two independent changes. Part A ships first and stands alone. Part B removes ~20MB of platform binaries from every shipped artifact.

Supersedes [plugin-build-toolchain-removal.md](plugin-build-toolchain-removal.md), which proposed publishing `@bb/plugin-build` and making plugins build themselves. That plan was rejected: it cost a permanent npm-publishing burden, a coordinated author migration on every pre-1.0 SDK minor, and a large validation apparatus — all to save the same ~20MB this plan saves without any of it.

**Non-goal:** making authors build their own plugins. bb keeps owning the build. Authors who *want* a standalone build already have one (see Part C).

---

## Part A — git plugins can have third-party dependencies

### Problem

A `git:` plugin today can only use Node built-ins, the shimmed host packages, and whatever it commits into its own tree. `installGitSource` (`managed-plugin-artifacts.ts:290-482`) runs only `git clone`, `git checkout`, and `git rev-parse` — there is no `npm install`. `build-plugin-app.ts:256-268` resolves dependencies from `rootDir/node_modules`, which in a fresh clone is empty.

`docs/configuration.md:568-571` already documents the opposite:

> Git plugins without prebuilt frontend artifacts also use npm with lifecycle scripts disabled, then discard their installed dependencies after bundling.

That describes behavior the code does not have. This part makes the doc true.

### Why this is safe

The distinction that matters:

- `npm install --ignore-scripts` downloads tarballs and writes files. **It executes nothing.** bb already does exactly this for `npm:` plugins (`installNpmCandidate`, `managed-plugin-artifacts.ts:104-119`).
- Bundling parses and concatenates. esbuild never evaluates a module.

So no plugin code runs at any point — not at install, and not on the update-check path where `plugin-updates.ts:195` stages git candidates. The trust surface is identical to what already ships for `npm:` sources.

### Change

In `validateInstallDir` (`managed-plugin-artifacts.ts:148-226`), for `kind === "git"` only:

1. **Install dependencies, if any.** Read the staged `package.json`. If `dependencies` is absent or empty, skip entirely — a dependency-free git plugin must keep installing with only `git` on PATH, as it does today. Otherwise run, in `rootDir`:

   ```
   npm install --ignore-scripts --omit=dev --omit=optional --no-audit --no-fund
   ```

   Use `runInstallCommand` (`install-sources.ts:384`) with a `notFoundHint` naming git specifically: npm is now required for git plugins *that declare dependencies*.

2. **Build both bundles.** Today only the app is built, and only inside the `manifest.appEntry !== undefined` branch at `:169`. Hoist build preparation out of that condition and add `buildPluginServer`, so a headless git plugin gets its dependencies inlined too.

3. **Prune `node_modules`** after both builds, before hashing. With both bundles built, nothing needs it at runtime.

4. **Require the server artifact for git.** `:219-224` currently calls `validateArtifact("server", false)`. Once bb builds it, make it required for `kind === "git"`. This also aligns `resolveServerEntry` with its stated intent at `plugin-runtime.ts:818-820` — *"Managed (git:/npm:) installs prefer a fresh, SDK-compatible prebuilt `dist/server.js` so consumers never need npm or node_modules"* — which is currently unreachable for git.

Order is load-bearing: install → build → prune → `hashInstallDir` → `promoteImmutableDir`. Hashing already runs post-build today, so artifact identity does not change shape.

### Explicitly not touched

- `path:` sources. The author owns that directory and its `node_modules`. Never install into it, never prune it.
- `npm:` sources. Already prebuilt, already dependency-complete.
- Lifecycle scripts stay disabled everywhere.

### Consequences

- A git plugin built against this exact SDK now always has a valid `dist/server.js`, so `isPrebuiltServerSdkCompatible` (`plugin-runtime.ts:810-817`) passes and the source fallback at `:847` stops being reached for git.
- Pruning is safe *because* step 2 builds the server bundle. If step 2 is dropped, step 3 must be dropped with it — otherwise the source fallback loads a module whose imports cannot resolve.
- A git plugin pulling a native module fails at load rather than install, since `--ignore-scripts` compiles nothing. `plugin-runtime.ts:1109-1112` already reports this clearly. Same behavior `npm:` plugins have today.

### Costs

- `npm` becomes required for git plugins that declare dependencies. Dependency-free plugins are unaffected.
- Offline installs break for those plugins.
- Slower installs: one dependency download per git plugin.
- Larger staging directories during install; promoted artifacts stay small because of the prune.

### Tests

- A git plugin with a third-party runtime dependency installs, and the dependency is inlined in both bundles.
- A git plugin with no `dependencies` installs with `npm` absent from PATH.
- A headless git plugin (no `bb.app`) gets `dist/server.js` + `server.meta.json`.
- The promoted artifact contains no `node_modules`.
- An update *check* on a git plugin executes no plugin code.
- A `path:` install leaves the source directory's `node_modules` untouched.
- Install failure leaves the previously installed version running and deletes staging (`managed-plugin-artifacts.ts:476`).

---

## Part B — fetch the build toolchain on demand

### Problem

`esbuild` (~12MB, a Go binary) and `@tailwindcss/oxide` (~3MB, napi) are platform-specific and shipped everywhere: `apps/server/package.json:7`, `apps/cli/package.json:10`, `packages/bb-app/package.json:71-81`, and `apps/desktop/package.json:31-32` (which carries both darwin arches). Roughly 20-25MB per artifact, for a capability most users never invoke — only `git:` and `path:` plugins with a frontend are ever built locally.

### Why it is cheap

Both are **already dynamic imports**: `build-plugin-app.ts:466` and `build-plugin-server.ts:132` do `await import("esbuild")`. The only static reference is `import type { Plugin }` at `build-plugin-app.ts:13`, erased at compile time. Nothing needs restructuring — only the resolution target changes.

### Change

1. **Toolchain resolver.** New module owning `<dataDir>/plugins/toolchain/`. Ensures a pinned set (`esbuild`, `@tailwindcss/node`, `@tailwindcss/oxide`, `tailwindcss`) is present; if absent, installs it there with `--ignore-scripts` at versions bb hardcodes, then returns resolved module paths. Concurrency-safe via the existing artifact lock.
2. **Thread the paths through.** `buildPluginApp` and `buildPluginServer` take resolved specifiers instead of importing bare names. Callers in the server and CLI pass the resolver's output.
3. **Monorepo build scripts keep the workspace copy.** `copy-builtin-plugins.ts` and `build-official-plugins.mjs` are build-time only; esbuild stays a devDependency there and is never shipped.
4. **Drop the shipped dependencies.** Remove the four packages and their `--external` flags from server, CLI, and `bb-app`. Drop `@esbuild/*` optional deps from `apps/desktop/package.json:31-32`, and update `apps/desktop/scripts/prepare-native-modules.cjs:13` and the runtime-externals list in `scripts/build-utils.mjs:25`. Desktop packaging tests assert these are present and must be updated.
5. **`apps/host-daemon` bundles the CLI** (`bundle-manifest.mjs:79`) and regenerates the runtime export manifest (`build-bundles.mjs:16`). Both need updating.

### What this deliberately keeps

- bb owns `RUNTIME_SLOT_BY_SPECIFIER` and `RUNTIME_EXPORT_MANIFEST`. Bundling a second React stays impossible by construction, so no runtime-contract metadata, no directional export comparison, no artifact format bump.
- Rebuild-on-drift (`plugin-runtime.ts:877-923`) keeps working. No `bb plugin upgrade`, no pre-1.0 SDK coordination.
- No npm publishing, no author migration, no changes to official plugins.
- Build errors stay bb's own.

### Costs

- One ~20MB fetch the first time a user installs a source plugin with a frontend. Needs progress reporting; an install that appears to hang is the main UX risk.
- Offline first-build breaks.
- bb pins toolchain versions explicitly and must bump them deliberately.
- Wire no server/daemon message, so no `HOST_DAEMON_PROTOCOL_VERSION` bump — bump only if implementation changes a daemon message or result.

### Tests

- With an empty data dir and no toolchain, installing a `path:` plugin with a frontend fetches and builds.
- A second install reuses the cached toolchain and performs no network work.
- Two concurrent installs fetch once.
- `npm:` plugin installs and builtin loads never trigger a fetch.
- No bundled runtime code imports `esbuild` or `@tailwindcss/*` (assert in a test).
- The packaged desktop app contains no esbuild or oxide binaries.

---

## Part C — document the author build path

No code change. It already works and is undocumented.

`bb-app` is published (`packages/bb-app/package.json`, `publishConfig.access: public`) and its `bin` block exposes `bb`. `bb plugin build` makes no server calls (`apps/cli/src/commands/plugin.ts:697-730`). So an author can already do:

```jsonc
"devDependencies": { "bb-app": "^0.35.1" },
"scripts": { "build": "bb plugin build" }
```

and run `npx bb plugin build` in CI with no bb server or daemon.

Add this to `packages/templates/src/templates/bb-guide-plugins.md` and the `bb-plugin-authoring` builtin skill. Note the version-alignment property: depending on `bb-app@X` builds with exactly that release's shim map, so a mismatched config is not possible.

Under Part B this keeps working — the CLI uses the same resolver and fetches on first run. Worth noting in the docs that CI should cache the toolchain directory.

Only `bb plugin dev` needs a running server, because it POSTs to `/plugins/reload` and resolves the plugin id from installed rows (`plugin.ts:761-770`).

---

## Sequencing

Part A and Part B are independent and can land in either order. Part A is smaller and has user-visible value on its own; Part B is pure infrastructure. Part C is documentation and can go with either.

## Open questions

1. **Prune or keep `node_modules` in git artifacts?** The plan prunes, which requires building the server bundle. Keeping them instead is simpler but makes artifacts much larger and leaves the source fallback in play. Prune is recommended and matches the existing doc.
2. **Toolchain version bumps.** When bb upgrades esbuild or Tailwind, existing cached toolchains are stale. Version the directory (`toolchain/<hash-of-pins>/`) and let GC reclaim old ones, or overwrite in place. Versioned is safer with concurrent installs.
3. **Should Part A extend to `path:`?** Currently no — the author owns that directory. If a path plugin has uninstalled dependencies, the build fails with a resolution error. Consider whether that error should name `npm install` explicitly.
