# CI performance

The main CI workflow keeps build/typecheck/lint, server tests, three app test
shards, integration tests, package tests, plugin tests, fork checks, and package
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

## Setup budgets

CI installs Node and the checksum-verified pnpm executable before restoring
caches. Optional pnpm and Turbo restores share a one-minute step budget. A
timeout falls back to a cold install after removing partial restores. Individual
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
before successful CI jobs save them. macOS smoke jobs still omit Turbo caching.

## Test balancing and measurement

The former catch-all packages job is split into `bb-plugin-*` tests and all
remaining tests outside app/server/integration. Negative filters make new
packages enter one of these jobs automatically. Both retain four concurrent
Turbo tasks. Only the non-plugin job installs Electron's runtime libraries.

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
