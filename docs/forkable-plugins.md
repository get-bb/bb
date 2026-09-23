# Forkable built-in plugins

A built-in plugin is forkable when a copy of its directory, taken out of this
repository, installs, typechecks, tests, and builds with public dependencies
only:

- the published `@get-bb/plugin-sdk`;
- npm packages;
- the plugin's own files;
- UI components from bb's component registry (`packages/plugin-registry`),
  imported through the scaffold's `@/components/ui/*` and `@/lib/*` aliases.

Forking is for someone who wants to diverge from a built-in instead of using
bb's extension points.

## The list

[`scripts/forkable-plugins.json`](../scripts/forkable-plugins.json) names the
built-ins held to this rule. Two checks read it:

- The `bb/forkable-plugin-imports` lint rule, run by each listed plugin's own
  `lint` script, rejects imports of workspace packages (`@bb/*` and any other
  package in this repository except `@get-bb/plugin-sdk`), relative imports
  that leave the plugin directory, and `@/` paths no registry item provides.
- `pnpm check:plugin-forks` (CI job "Plugin Fork Check") copies each listed
  plugin to a temporary directory the way a fork would, with the rewrite in
  [`scripts/lib/plugin-fork.mjs`](../scripts/lib/plugin-fork.mjs): it writes
  the registry items the plugin imports into the copy, points `@/*` at `./*`,
  installs the packed SDK and npm packages with `--legacy-peer-deps`, and runs
  the copy's typecheck, tests, and `bb plugin build`. Pass plugin directories
  to check only those, `--keep` to keep the copies, and `--concurrency=<n>` to
  change how many run at once.

## What a listed plugin looks like

- **UI through the registry alias.** Components come from `@/components/ui/*`
  and helpers from `@/lib/*`. The plugin's `tsconfig.json` maps `@/*` onto
  `packages/shared-ui/src`, the source the registry is generated from, and
  `@/components/ui/icon` onto the registry's host-backed icon
  (`packages/plugin-registry/flavors/components/ui/icon.tsx`); a plugin that
  imports `@/components/ui/question-form-host` maps it onto that item's flavor
  the same way. tsc, esbuild, and
  vitest follow the mapping, and `apps/app/vite-forkable-plugin-paths.ts`
  applies it when app tests and Ladle stories import the plugin.
  `@bb/shared-ui` stays in `package.json` so pnpm links it; the fork replaces
  it with the registry items' packages. A shared-ui component a plugin needs
  becomes a registry item in `packages/plugin-registry/registry.json`.
  Plugin-only logic moves into the plugin.
- **Its own test config.** `vitest.config.ts` uses `defineConfig` from
  `vitest/config` with `resolve: { tsconfigPaths: true }`, not
  `vitest.shared.ts`, which a copy does not have. Vite maps `@/` only in
  files the tsconfig includes, so `include` names every file that imports
  `@/`; tsc reaching a file through an import is not enough. The tsconfig has
  no `customConditions: ["source"]`, which only resolves inside this
  repository. With `tsconfigPaths`, it also maps nothing onto
  `@get-bb/plugin-sdk`: vitest follows `paths` at runtime, so an entry
  pointing at the SDK's bundled declarations loads a module with no exports.
  The package's `types` condition already gives tsc those declarations.
- **Declared test dependencies.** The fork installs without npm's peer
  resolution, so `devDependencies` lists everything the tests load, including
  the SDK test harness's optional peers the plugin uses: `better-sqlite3`,
  `@types/better-sqlite3`, `hono`, and `cron-parser` for `createTestPluginHost`;
  `@testing-library/react`, `@testing-library/dom`, `jsdom`, `react`,
  `react-dom`, and their `@types` for `renderSlot`.
- **Portable tests.** Tests use the SDK test harness and plugin-local fixtures.
  They do not import app or workspace source, and they do not assert on host
  behavior. Tests of the plugin's own components live in the plugin. Host
  tests that load a listed plugin import it by a resolved path at runtime, as
  `apps/app/src/components/sidebar/sidebar.bench.test.tsx` does: a literal
  import would pull the plugin's `@/` imports into the host's own type
  program, where `@/` means the host's source. For the same reason, Ladle
  stories either live in the plugin directory, are listed in
  `apps/app/.ladle/config.mjs`, and import nothing outside the plugin (they
  lay out their own rows, and a story whose host components need app data
  asks for it in its Ladle `meta`: `modelPickerCatalog` seeds the model
  picker catalog, read by `apps/app/.ladle/components.tsx`), or live in the
  app and load the plugin with `import.meta.glob`, as
  `apps/app/src/components/thread/pending-interactions/InteractionStates.stories.tsx`
  does.
- **Turbo entries.** `turbo.json` gives the plugin's `typecheck` and `test`
  tasks the registry flavors as inputs, and `test` depends on
  `@get-bb/plugin-sdk#build`, because vitest resolves the SDK's built entries.
- **Names unchanged.** A listed plugin keeps its CLI command, storage keys,
  routes, and provider ids. A copy loaded next to the built-in collides with it
  until it renames them; the list only guarantees that the copy builds.
- **SDK floor.** `engines.bbPluginSdk` names the SDK version that introduced
  the newest hook the plugin calls.
