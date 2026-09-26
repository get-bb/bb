# Search performance comparison

Run the manual CI workflow on a candidate branch with `search-profile-base` set
to its comparison commit. Builds and measurements run remotely:

```sh
gh workflow run ci.yml --ref <candidate-branch> \
  -f search-profile-base=<base-commit>
```

The optional profiling job builds both revisions through Turbo, then runs their
packaged servers and enrolled host daemons sequentially on the same runner in
before/after/after/before order. It uses one SQLite fixture copied for each
process and one workspace containing 10,000 files. No production data or agents
are used.

The artifact preserves the exact harness, revision and runtime archive hashes,
fixture identity, runtime versions, machine information, individual measurements,
result hashes, logs, CPU profiles, and a percentile summary. Download it with
`gh run download <run-id> --name search-profile-<candidate-sha>`. CI retains
artifacts for 90 days; copy evidence that must outlive that retention window.

| Measurement                                | Samples per revision | Meaning                                                                 |
| ------------------------------------------ | -------------------- | ----------------------------------------------------------------------- |
| Server startup and first search            | 10                   | Fresh process and SQLite connection; OS page cache remains warm         |
| Warm search and concurrent health response | 40                   | Three query shapes; health request starts 15 ms after search            |
| File suggestion bursts                     | 20 × 5 queries       | Real HTTP, server-to-daemon transport, discovery, and ranking           |
| Plugin mention first/all results           | 20                   | Real provider endpoints with deterministic 20 ms and 1,600 ms providers |

File bursts wait 2.1 seconds between sequences and 80 ms between successive
queries. Each revision uses its own frontend request topology for plugin
mentions: one aggregate request before, independent provider requests after.
These API measurements exclude frontend debounce, DOM rendering, and remote
Connect latency. Use Browser Automation separately for keystroke-to-render
measurements; do not call API time an end-to-end UI latency.

CPU profiles come from separate runs and are excluded from latency percentiles.
Open `.cpuprofile` files in a compatible profiler; `results/cpu-summary.json`
lists sampled self-time by function. Worker profiles must be considered with
the main-server profile: moving SQLite work to a worker can improve server
responsiveness without reducing total query CPU time.

The harness verifies equivalent result hashes across revisions. Read individual
samples and query shapes alongside p50/p95 values. A slower packaged cold start,
stale results, missing profiles, or an unsuccessful process shutdown is evidence
to investigate, not a successful benchmark.
