# Worktree startup performance

Run `pnpm start:worktree` as before. It builds and serves the production
frontend, runs React Compiler, generates the complete plugin SDK declarations,
packages bundled plugins, and checks native modules before starting the server
and host daemon. The checkout-specific ports, data, and runtime policy are
unchanged.

## Scope

This PR caches bundled-plugin packaging through Turbo and builds independent
plugins with at most four workers, resolving the pinned toolchain once.
The frontend compiler, compression settings, SDK declarations, and runtime
contracts are unchanged. The earlier custom React Compiler cache prototype
was reverted; its performance numbers do not describe this PR.

## Measurements

Measured on September 8, 2026, on a Mac with 16 available logical CPUs, Node
22.23.1, pnpm 9.15.0, and Turbo 2.8.3.

| Full `pnpm start:worktree` launch              | Before |  After |
| ---------------------------------------------- | -----: | -----: |
| Unchanged checkout, warm build caches, run 1   | 10.87s |  4.80s |
| Unchanged checkout, warm build caches, run 2   | 10.58s |  4.42s |
| Frontend edit requiring a fresh frontend build | 35.75s | 21.27s |

Warm startup improved about 57% across these two runs. The frontend edit run
improved about 41%, while the frontend itself still compiled normally.
These are individual observations on a shared development host, not a
statistical performance guarantee. Cold builds and SDK edits remain expensive.
The earlier isolated packaging comparison measured 7.02s sequentially and
5.10s with four workers; that comparison does not include the full launcher.

Times run from command invocation until both the server and host-daemon health
endpoints respond successfully, polled every 100ms. They exclude browser
navigation and completion of lazily started provider workers. Comparisons used
the same checkout and isolated dev database, with benchmark launches sequential.
Installed dependencies, the plugin toolchain, and OS filesystem caches remained.

The baseline restores `scripts/start-bb.mjs` and
`apps/server/scripts/copy-builtin-plugins.ts` from `06aeaa9949`, retaining the
same Turbo configuration for both sides. Each side was primed before measuring
warm launches. Different trailing-newline edits to `apps/app/src/main.tsx`
ensured the measured frontend edits missed the app task cache on both sides.
Turbo reported 8/9 cached tasks before and 9/11 after for those edit runs;
the after run also executes the intentionally uncached cleanup task.
An initial after-edit run reused the baseline edit's app cache and was excluded.
All temporary source changes were restored.

## Cache boundaries and restoration

`@bb/server#build:plugins` owns `dist/builtin-plugins`. It depends on the plugin
SDK build and `@bb/server#clean:plugins`. That cleanup task always runs after
the server build and removes the old packaged-plugin tree before either a cache
restore or a fresh packaging run. The server build excludes that subtree from
its own cached outputs. This ordering prevents server cleanup from deleting
new plugin output and prevents deleted plugins or assets from surviving an
overlaid Turbo cache restore.

Plugin sources, manifests, assets, build tooling, dependency versions, and
upstream task hashes invalidate the packaging cache. Packaging runs from the
same repository-root working directory as the original launcher. A plugin edit
still rebuilds the whole plugin packaging task. Turbo shares its local task
cache between worktrees of the same repository on this host; no new cache
service or custom transform-cache format is introduced.

## Verification

- A real Turbo regression fixture builds A, builds B with an additional plugin
  and asset, then restores cached A. It asserts a cache hit and that only A's
  files remain. Disabling cleanup makes this test fail on the obsolete plugin.
- The actual packaged-plugin cache restored all 244 files byte for byte after
  an obsolete plugin directory and asset were inserted into existing output.
- All 1,520 frontend files (including compressed assets) and 244 plugin files
  matched the baseline byte for byte after the final startup.
- All 244 plugin files matched the earlier sequential/parallel comparison.
  A plugin-source edit changed the packaging task hash from hit to miss.
- Launcher and cache regression tests: 5 passed. Bundled-plugin lifecycle
  tests: 31 passed. Server and scripts typechecks passed.
- The final app passed server/daemon health checks and browser smoke checks for
  Automations plugin details and its packaged UI, including a reload.

Commands:

```sh
pnpm exec turbo run test --filter=@bb/scripts -- test/plugin-build-cache.test.mjs test/start-bb.test.mjs
pnpm exec turbo run test --filter=@bb/server -- test/services/plugins/builtin-plugins.test.ts
pnpm exec turbo run typecheck --filter=@bb/server --filter=@bb/scripts
```

Detailed benchmark logs and temporary experiments are retained under
`/tmp/bb-start-timing.9Yzrro` on the measurement host. The reported edit result
uses `startup-safe-after-edit-uncached.json`; warm results use
`startup-safe-{before,after}-warm-{1,2}.json`.
