# CI performance

The main CI workflow keeps build/typecheck/lint, two server test shards, three app test
shards, integration tests, three package test groups, plugin tests, three fork
check shards, and package
smokes independent. Node 24/26 compatibility smokes run on main and manual runs.

## Fork checks

On pull requests, the fork checker compares the checked-out merge commit with
the event's base SHA. When every changed path belongs to a listed forkable
plugin, only those plugins run. Renames include both old and new paths. Any
shared, unknown, or unlisted-plugin change runs the complete list. Missing
history also runs the complete list. Main and manual runs always check all
plugins, including fresh resolution of published dependencies.

Use `node scripts/check-plugin-forks.mjs --changed-from=<sha> --list` to inspect
the selection without installing or building anything. Remove `--list` to run
it. Explicit plugin directories and `--changed-from` are mutually exclusive.

CI partitions the selected plugins over three runners using `--shard=1/3`,
`--shard=2/3`, and `--shard=3/3`. Each plugin runs exactly once. Selection happens
before partitioning, so small plugin-only changes leave unused shards empty;
those shards skip setup. Each runner retains at most four concurrent plugin
checks. `--list` reports the same shard selection used for execution.

## Setup budgets

CI installs Node and the checksum-verified pnpm executable before restoring
caches. Optional pnpm and Turbo restores share a one-minute step budget. A
timeout falls back to a cold install using fresh cache directories. Individual
download segments also have a one-minute limit. Bun downloads directly instead
of waiting for its executable cache.

Dependency installation has a five-minute step budget in CI. Individual package
fetches have a 30-second timeout with two retries and 1–5-second backoff. pnpm
handles transient fetch failures; the workflow does not repeat the entire
install, including lifecycle scripts, three times. The shared setup action used
by other workflows reuses these tools and fetch settings, but does not impose
the CI workflow's outer step budgets.

pnpm can restore the most recent store for the same OS and architecture when a
lockfile changes. The frozen install still resolves the exact lockfile contents
and verifies store integrity. Turbo caches are pruned after restoration and
before successful CI jobs save them. Windows restores the pnpm store for both
jobs and Turbo build outputs for app smoke, capped at 256 MB to bound transfer
and storage costs. Windows installs retain `--ignore-scripts`; foundation tests
still run with `--force`. macOS smoke jobs still omit Turbo caching.

PR runs cancel superseded work. Main concurrency groups include the commit SHA,
so different main commits can run concurrently and each successful job saves its
cache. The old shared main group delayed job creation by up to three minutes in
the October 1 sample. Runner provisioning and fleet capacity remain external
limits; removing workflow serialization does not guarantee immediate starts.

## Test balancing and measurement

Server tests split by file into two Vitest shards. Turbo hashes the shard
arguments, preventing one shard's result from satisfying the other.

Package tests split by package, because some packages use Bun or Node test
runners that do not accept Vitest's shard arguments:

- `packages-host`: host daemon, CLI, agent runtime, provider parity, and database.
- `packages-build`: templates, bb-app, demo server, desktop, and plugin build.
- `packages-other`: every remaining non-plugin package outside app, server, and
  integration. Negative filters automatically include new packages.

The `plugins` group runs `bb-plugin-*`. All groups retain four concurrent Turbo
tasks. Only `packages-build` needs Electron's runtime libraries and Xvfb.

The October 1 investigation sampled 35 completed runs. The 26 successful runs
without retries finished in a median 3m48s. Windows smoke finished last in 15 of
20 runs containing it, with median install/build/package steps of 53s/71s/38s.
Fork checking took a median 2m46s inside its main step; packages and server test
steps took about 2m16s and 2m07s. These are baseline measurements, not projected
improvements. After merge, compare cold and warm runs separately and check that
additional runners do not increase capacity waits or cache eviction.

The September 29, 2026 cold run [36597970177](https://github.com/get-bb/bb/actions/runs/36597970177)
spent five minutes in the original catch-all test step. Its logged Vitest
durations summed to approximately 392 seconds for plugin packages and 579
seconds for other packages. These are aggregate task durations, not predictions
of the new jobs' wall-clock time.

A local Linux arm64 benchmark pinned to four CPUs compared four concurrent
Turbo tasks across `bb-plugin-thread-list`, `bb-plugin-tasks`,
`bb-plugin-account-pool`, and `bb-plugin-provider-codex`. All six runs passed:

| Vitest workers per package | First run | Second run |
| -------------------------- | --------: | ---------: |
| Default                    |     24.5s |      24.9s |
| 2                          |     26.5s |      26.3s |
| 1                          |     41.6s |      41.0s |

The workflow keeps Vitest's defaults. This is a representative local comparison,
not a measurement of the new full workflow on Blacksmith. To repeat it, run
`pnpm exec turbo run test` with the four package filters above,
`--concurrency=4 --force --summarize`, and optionally `-- --maxWorkers=1` or
`-- --maxWorkers=2`.

Every test job uploads `.turbo/runs/*.json` as a `test-timings-<shard>-<attempt>`
artifact retained for seven days. Use execution durations and cache status to
compare cold jobs separately from warm jobs. Compare workflow attempts
separately: a rerun can reuse earlier successful jobs, making the span between
the earliest and latest job misleading. Keep failed and canceled attempts out
of successful-run latency percentiles, but track their frequency separately.

## Cache maintenance

`CI Cache Maintenance` reports GitHub-visible storage by family and runs daily.
It deletes only recognized pnpm store caches:

- On the default branch, preserve the current lockfile and the two newest
  entries per OS/architecture. Older entries must be at least three days old
  and unused for three days to be eligible.
- On closed pull requests, entries must be at least one day old and unused
  for one day. Open PR caches and other branches are preserved.
- Turbo caches and unrecognized keys are reported but never deleted by this
  workflow. Blacksmith-managed storage may differ from GitHub's inventory.

Manual dispatch defaults to a dry run. Locally, set `GITHUB_REPOSITORY`,
`GITHUB_DEFAULT_BRANCH`, and `GITHUB_TOKEN`, then run
`node scripts/cleanup-actions-caches.mjs`. Add `--apply` to delete the reported
entries. Run from the repository root at the default branch's current commit.
The script finishes paginating and validating inventory and PR states before
issuing any deletion. API requests time out after ten seconds; the maintenance
job has a five-minute budget and is independent of PR checks.
