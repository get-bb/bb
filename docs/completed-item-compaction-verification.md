# Completed-item compaction verification

Storage and maintenance measured on 2026-09-16 in an isolated worktree based on `5aca5733a5`,
including PR1 (`c663ff1911`, #3766). The final measurements include the
output-order safeguard and exclusion of compaction from synchronous per-thread
cleanup. These are observations from private sanitized SQLite copies. The reader section below supersedes the earlier 30-page timing samples and compares the rebased implementation with main.

## Correctness and storage

| Check                              | Result                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Physical events                    | 2,082,639 → 1,080,655 (1,001,984 removed)                                                                                 |
| All table rows                     | 2,571,187 → 1,569,205 (net 1,001,982 removed)                                                                             |
| Combined owners                    | 793,715                                                                                                                   |
| Internal metadata                  | 182,920,304 bytes                                                                                                         |
| Allocated SQLite btree bytes       | 5,634,584,576 → 4,411,314,176 (1,223,270,400 saved)                                                                       |
| Database file bytes                | 6,006,726,656 before and after; freed pages are reusable                                                                  |
| Independent logical reconstruction | All 2,082,639 records match across 2,326 threads, except 119,716 eligible empty command-delta text markers                |
| Complete visible timelines         | All 2,326 match, including all 2,223 non-null context values                                                              |
| Highwater and provider recovery    | All 2,326 match                                                                                                           |
| Existing side tables               | All 46 non-event/non-cursor/non-migration tables match, including output, search and attachment ownership                 |
| Complete large-thread pagination   | Three largest threads: all 3,816 rendered rows match after complete traversal at a 1,000-row budget; baseline used 10,000 |
| Other consumers                    | 2,326 latest-output checks, ten large outlines and 100 rollback-only output mutations match                               |

There are no added tables or indexes and no full VACUUM. The two-row difference
between physical and total removals is migration/cursor bookkeeping. The worker
performs actual discovery and mutation on a fresh clone.

The output-order safeguard leaves 93 more owners ordinary, retaining 175 rows
that the first revision removed. Assistant items crossing another assistant
completion or manager output must stay ordinary: otherwise moving the completion
can make the output API, plugin summaries and child notifications choose an older
message. Both cases were reproduced through the actual server output helper and
now pass regression tests. Existing user-message/context-clear exclusions and
bounded support/input discovery remain in place.

## Timing and catch-up

Heavy measurements ran sequentially. The host was shared; these observations do
not establish cold-I/O bounds or a maximum event-loop stall.

| Measurement                                             | Result                                            |
| ------------------------------------------------------- | ------------------------------------------------- |
| Full completed-item worker pass                         | 120,866 advances; 304.50 seconds                  |
| Background advance median / p99 / maximum               | 1.90 / 15.18 / 372.18 ms                          |
| Final live wrapper, 2,500 calls                         | median 0.288 ms; p99 5.46 ms; maximum 322.25 ms   |
| PR1 live wrapper, same 2,500-call workload              | median 0.243 ms; p99 5.28 ms; maximum 87.34 ms    |
| Compaction calls / event deletions in final live sample | zero / zero                                       |
| Actual background sweep, 100 calls                      | 1,565 total advances; 313 completed-item advances |
| Maximum sweep / advance in that sample                  | 216.46 / 177.78 ms                                |

The original 270 ms live compaction stall was independently reproduced at 249 ms.
An isolated replay attributed the delay to transaction commit. Disabling automatic
checkpointing on a disposable copy reduced that compaction call to 1.53 ms;
an explicit checkpoint immediately afterwards took 333.05 ms for 1,002 WAL frames.
That experiment moved the cost; it was not a fix. No checkpoint settings change
in this PR.

Completed-item compaction now runs only in the existing idle background sweep.
The synchronous per-thread rotation retains PR1's four policies. This removes
compaction writes from ingestion and turn-completion handlers, but does not
eliminate SQLite checkpoint stalls from existing writes. The final live maximum
occurred during the existing usage policy with zero event deletions; cursor
transactions still write. The PR1 comparison also exceeded 50 ms. These samples
do not prove identical worst-case latency or quantify a regression from the
individual maxima. No sub-50 ms guarantee is made.

The live harness includes the real wrapper, transaction, generation checks and
in-process notification/logging calls. The background sample explicitly marks
its private copy idle. No server or provider runs on a research copy.

At 3.13 completed-item advances per sweep and the existing ten-second cadence,
the latest sample extrapolates to about **107 idle hours** for first-pass catch-up.
The initial revision's sample estimated 84 hours. Actual processing time remains
about five minutes; scheduling, activity and I/O determine elapsed catch-up.
These are short-sample estimates, not an end-to-end scheduled run. Checkpoint
stalls and multi-day idle catch-up remain limitations. Reader performance was
subsequently fixed and measured separately below.

## Automated and UI verification

Earlier maintenance follow-up checks (reader-pass checks follow below):

- Turbo DB tests: 44 files, 591 tests pass, using migrated real SQLite.
- Turbo affected server tests: 14 tests pass, including the previously failing
  scheduler test and cached timeline refresh through the actual idle sweep.
- Live cleanup leaves the completion ordinary; idle background cleanup combines
  it and invalidates the warmed timeline. Raw output still excludes metadata.
- Turbo DB/server typechecks pass.
- Full-copy comparisons and pagination listed above were rerun after the fixes.

The initial revision additionally passed 200 selected server tests and 73 Plugin
Guide tests, small-budget traversal tests at budgets 1/2/5/20 with 512-byte
responses, 34 real fork cases (2,638 copied records), and 24 real edit-boundary
rewinds. Fresh synthetic Chromium verification proved command output, file diffs,
reasoning, answers and durations survive background rewriting and reload. A
rewrite with unchanged highwater refreshed the open browser automatically. Those
UI/fork/edit checks were not rerun in the follow-up; renderer, fork and edit code
are unchanged, and compaction eligibility is narrower.

The initial verification inventory reported pre-existing unmapped `browser`
CLI-family drift. No iOS or provider-resume claim is made. Dev processes/browser
from the initial verification were stopped.

Initial evidence remains under implementing thread `thr_mwh5k9hti7` in
`pr2-start-position`. Follow-up scripts, full comparisons, timings and logs are
under parent thread `thr_vmdgc3ke5y` in `pr2-review/final`. Copies are private and
mode 0600, with Connect plugin records verified absent. No live database or copied
Connect configuration was used; nothing was merged or deployed.

## Full-copy reader performance (2026-09-17)

Compared main `0bb64f3789` (including #3874 and #3876) with implementation
`820e4e5bfc`. Later main commits were checked for changes to the measured DB and
timeline paths. The source fix makes the timeline budget count reconstructed
records, selects metadata with the physical rows, passes already parsed payloads
to projection, and reuses reconstruction in a bounded per-connection cache.
Cache hits require identical stored metadata and completion payloads. Limits are
8 million accounted text characters and 10,000 reconstructed records; this is
not a byte-exact heap cap. There are still no new tables or indexes.

The benchmark uses the complete sanitized pre-compaction database and its
compacted counterpart: all 2,326 threads, with every older cursor followed to the
end. Each request runs both versions and compares the complete response,
including pagination and context. Three alternating warm samples per version
follow the first call. The measured interval is the complete server timeline
builder, including selection, reconstruction and projection; it excludes HTTP,
network and browser rendering. SQLite uses production cache/mmap settings.

| Workload | Matching pages | Main / PR2 median warm page time | Median paired change | Sum of warm page medians |
| --- | ---: | ---: | ---: | ---: |
| Product settings | 3,027 | 9.73 / 8.78 ms | −1.14 ms | 43.49 / 38.22 s (12.1% lower) |
| Expanded stress settings | 2,733 | 11.77 / 10.87 ms | −1.13 ms | 58.45 / 51.78 s (11.4% lower) |

Product settings use the 1,500-event budget, 20 segments, lazy nested rows,
32,000 inline output characters, and saved provider display/diagnostic settings.
The stress workload uses a 10,000-event budget, expanded nested rows, collapsed
completed turns and 8,000 inline characters. These are two complete traversals
of the same database, not 5,760 distinct stored pages. Every response matches.
Neither census has a warm elapsed-time case more than both 5 ms and 10% slower.
Warm process CPU totals are 12.5% lower for product settings and 11.7% lower for
the stress workload. Among the 93 product-setting requests taking at least 50 ms
on main, the median paired improvement is 11.75 ms.

First visits are noisier: product-setting median paired elapsed change is
+0.15 ms, with summed first-call time 7.2% higher but CPU 3.0% lower. Stress
first-call elapsed and CPU totals are lower. This does not establish that every
first read is faster. Cases crossing the 5 ms / 10% threshold in elapsed or CPU,
plus controls, were selected for repeated cold-application-cache and warm checks.
A cold application cache means a fresh DB wrapper and empty per-connection JS
caches, not a cold OS disk cache.

All 457 selected product-setting requests and 78 stress requests match in six
alternating samples per version and cache mode. None exceeds both elapsed-time
thresholds in either mode. Median paired changes are −1.39 / −2.37 ms for product
cold/warm checks and −1.05 / −1.85 ms for stress cold/warm checks. Three CPU-only
outliers were repeated with twelve samples per version and mode; all three then
have lower PR2 elapsed and CPU medians. All original samples remain in the
artifacts rather than being discarded.

The two originally blocking large-page regressions now measure 214.11 → 200.16 ms
and 191.56 → 151.21 ms in the repeated warm stress checks. Fresh application-cache
medians also improve: 214.22 → 193.46 ms and 204.57 → 185.67 ms. Their responses
remain identical.

Before backfill, both versions were also run against the same uncompacted copy
for 45 requests from large threads. All responses match across nine alternating
samples per version and cache mode. Median paired elapsed overhead is +0.88 ms
with fresh application caches and +0.76 ms warm; no elapsed case exceeds both
5 ms and 10%. Summed warm elapsed medians increase 2.7%, and CPU medians 3.4%.
Two CPU-only cases cross the threshold in different cache modes; this is a small
pre-backfill cost, not a claim of zero overhead before any rows are compacted.

The inherited benchmark mixed a CommonJS Drizzle driver with the app's ES-module
schema. Profiling exposed extra generic row-mapping overhead. The final harness
uses the same ES-module driver as `createConnection` and asserts matching driver
and native SQLite constructors. Only the corrected `production-*` artifacts
support these timing results; earlier timing samples are superseded. Earlier
response-equality checks are supplemented by the complete corrected traversals.

Final source validation: 611 DB tests, 198 affected server tests, and DB/server
typechecks pass through Turbo. Added tests cover logical work budgets, metadata
selection, parsed payloads, malformed JSON, cache invalidation, scope/snapshot
filtering, eviction and oversized-entry bypass. Migration 0127 adds only the
metadata column; events indexes match the preceding main snapshot.

These measurements address the observed reader regression. They do not establish
a maximum event-loop stall, a cold-disk latency bound, or a new catch-up estimate.
The historical maintenance/checkpoint measurements above remain separate.
Scripts, raw samples and the final report are in parent thread storage
`pr2-perf-fix/`.
