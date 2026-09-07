# Worktree startup performance

Run `pnpm start:worktree` as before. It still builds and serves the production
frontend, runs React Compiler, generates the complete plugin SDK declarations,
packages bundled plugins, and checks native modules before starting the server
and host daemon. The checkout-specific ports, data, and runtime policy are
unchanged.

## Measurements

Measured on September 7, 2026, on a Mac with 16 available logical CPUs, Node
22.23.1, pnpm 9.15.0, and Turbo 2.8.3. The baseline is commit `06aeaa9949`;
the prototype consists of `d918568f00`, `506b3d6f06`, and `c90641a07a`.

| Full `pnpm start:worktree` launch     | Before |  After | Reduction |
| ------------------------------------- | -----: | -----: | --------: |
| Unchanged checkout, warm build caches | 10.06s |  3.39s |       66% |
| Frontend edit, otherwise warm caches  | 27.06s |  6.63s |       75% |
| Forced build, empty compiler cache    | 31.34s | 26.59s |       15% |

Times run from command invocation until both the server and host-daemon health
endpoints respond successfully, polled every 100ms. They do not include a
browser navigation or promise that every lazily started provider worker has
finished initializing. The comparisons used the same checkout and isolated
dev database, with no concurrent benchmark jobs. These are individual runs,
not statistical medians; an additional warm prototype launch took 3.37s.

For the edit comparison, an extra newline in `apps/app/src/main.tsx` forced
the frontend build without changing its behavior. The original launch/config
files were temporarily restored from the baseline commit, then the prototype
files were restored. For the cold comparison, all Turbo tasks were forced to
execute and the prototype's compiler cache was moved aside. Installed npm
dependencies, the plugin toolchain, OS filesystem caches, and the dev database
were retained. All temporary source changes were restored.

The frontend build alone took 3.67s with cached compiler transforms, including
Vite and compression. Sequential plugin packaging took 7.02s; packaging with
four workers took 5.10s. First-time compilation and SDK declaration generation
remain substantial costs. Experiments with four or eight declaration workers
were slower than the existing worker pool and were not adopted.

## Changes and cache boundaries

`@bb/server#build:plugins` owns the packaged `dist/builtin-plugins` output. It
depends on the server and plugin SDK builds, so server cleanup finishes before
plugins are restored or built. The server build excludes that subtree from its
own cached outputs. Plugin sources, manifests, assets, build tooling, dependency
versions, and upstream task hashes invalidate the packaging cache. Packaging
runs from the same repository-root working directory as the original launcher,
preserving generated source paths and artifact digests. Independent plugins
build with at most four workers, sharing one resolved toolchain.

The React Compiler cache lives in
`apps/app/node_modules/.vite/app/react-compiler`. It stores transformed code
and source maps, keyed by module contents and identity, transform options,
environment name, build mode, production state, Node version, relevant Babel
environment values, lockfile, and compiler/config implementation. It is enabled
only for Vite build commands; development serving keeps the existing compiler
path. Cache writes are atomic. Invalid entries and
unavailable cache storage fall back to compilation. Absolute module identities
keep source maps from being reused for a different checkout path.

Turbo's `--force` bypasses task results but still allows the compiler transform
cache to work. To investigate an entirely uncached frontend compilation, move
that compiler-cache directory aside before forcing the app build through Turbo.
The cache is optional and can be deleted while builds are stopped.

## Verification

- All 1,520 frontend output files, including compressed assets, matched the
  original byte for byte after both cold and cached compiler builds.
- All 244 packaged plugin files matched between sequential and parallel
  builds, and after a Turbo cache restore into a missing output directory.
- Editing a plugin source changed the packaging task hash from a cache hit to
  a miss.
- The compiler-cache tests cover source and mode invalidation, reuse of code
  and source maps, malformed entries, and unavailable storage: 3 tests passed.
- The existing bundled-plugin lifecycle suite passed all 31 tests. The startup
  launcher tests, app and server typechecks, and app lint passed. App lint
  reported existing warnings and no errors.
- Browser smoke checks passed for home navigation, the plugin catalog, installed
  plugins, plugin details, and the packaged Automations panel after reload. The
  source CLI reported 16 running and 7 intentionally disabled plugins, with no
  failed states. Server and daemon health checks passed and the host connected.
- The verification inventory reported a pre-existing unmapped `browser` CLI
  family before these changes; that unrelated inventory drift was not changed.

Detailed benchmark logs and temporary experimental outputs were retained under
`/tmp/bb-start-timing.9Yzrro` on the measurement host, outside the repository.
