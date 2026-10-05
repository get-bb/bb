# CI performance

The main CI workflow keeps build/typecheck/lint, two server test shards, three app test
shards, integration tests, three package test groups, plugin tests, three fork
check shards, and package
smokes independent. Node 24/26 compatibility smokes run on main and manual runs.
Windows runs the nine host packages, an app smoke, and seven test shards that
cover the remaining suites; see [windows-ci.md](windows-ci.md).

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
before successful CI jobs save them. Windows restores the pnpm store for every
job, and Turbo outputs for app smoke and the Windows test shards, capped at
256 MB per job to bound transfer and storage costs. Windows installs retain
`--ignore-scripts`; foundation tests still run with `--force`. macOS smoke jobs
still omit Turbo caching.

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

## October 5 declaration-generation investigation

A sample of the 20 most recent successful runs on each sampled day, excluding
reruns using the run API's `run_attempt`, showed these workflow durations:

| Date            | First-attempt runs |  Median |
| --------------- | -----------------: | ------: |
| October 1, 2026 |                 16 |   4m26s |
| October 4, 2026 |                 18 | 4m50.5s |
| October 5, 2026 |                 15 |   7m36s |

These are small time-window samples, not whole-day percentiles. The October 5
sample ends at run [37387186039](https://github.com/get-bb/bb/actions/runs/37387186039).
Full Windows test coverage was added on October 2 in PR #4776. Retain that
coverage when optimizing the now-longer critical path.

In first-attempt run [37386205651](https://github.com/get-bb/bb/actions/runs/37386205651),
the Windows server shards spent 179.3s and 149.8s in
`@get-bb/plugin-sdk#build:types`; the other-packages shard spent 170.5s there.
All three were cache misses. Server shard 1 then spent 124.0s running tests.

The shared declaration emitter compared TypeScript's forward-slash source
filenames against a Windows backslash workspace prefix. That selected no
workspace roots, causing repeated compiler-program construction as declaration
sources loaded. Normalize both paths before selecting roots and checking
program membership. The regression exercises real TypeScript emission and
bounds source-file reads across five entry points, including an equivalent
workspace path with a trailing separator. Before the fix that case read the
first entry six times; afterward it reads it twice. Existing coverage checks
inferred types, ambient declarations, and different compiler options.

The controlled Windows [benchmark run 37389733655](https://github.com/get-bb/bb/actions/runs/37389733655)
compared baseline and fixed emitters on the same Blacksmith four-vCPU Windows
Server 2025 runner, with Node 22.23.2, unchanged dependencies, and Turbo
`--force`. Each build started without the generated declaration directory.
The execution order was baseline, fixed, fixed, baseline:

| Emitter  | First task duration | Second task duration |     Mean |
| -------- | ------------------: | -------------------: | -------: |
| Baseline |            156.813s |             132.999s | 144.906s |
| Fixed    |             18.720s |              20.083s |  19.402s |

Declaration generation was 7.47 times faster (86.6% less task time). All four
runs were cache misses, and SHA-256 manifests for all 17 declaration bundles
matched exactly. The benchmark script and workflow are preserved in commit
`f6abf8ad78` on `bb/ci-windows-declaration-benchmark-thr_jis82m9hmh`; its artifact
contains per-round timings, output hashes, and Turbo execution summaries.

The regular [PR CI run 37389645615](https://github.com/get-bb/bb/actions/runs/37389645615)
passed all 26 active jobs. Its uncached Windows declaration tasks took 20.133s
(server-1), 25.816s (server-2), and 35.365s (packages-other). The full workflow
took seven minutes; the task speedup is not an equivalent whole-workflow
speedup because other test jobs remain on the critical path.

Infrastructure also contributes: run
[37381624894](https://github.com/get-bb/bb/actions/runs/37381624894) had a 118s
maximum job provisioning wait, and its Windows server-1 checkout spent 122s in
the shallow Git fetch. Later-starting jobs in multi-attempt runs must not be
counted as provisioning delays from the original workflow creation time.

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
