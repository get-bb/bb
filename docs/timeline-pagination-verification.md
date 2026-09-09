# Timeline pagination verification

Measured on 2026-09-08 using copied provider threads and isolated in-memory
server databases. The paired comparison restores main's timeline builder,
event queries, and client merge from `682f0d2c5d`. Each thread runs main, fixed,
fixed, main in one process, with a fresh database and route cache each time.
The table reports the mean of the two runs per implementation.

Every page goes through the real Hono endpoint, response serialization/schema
validation, and the actual client merge. Canonical oracle construction and
corpus loading are outside request timers. The fixed rows are compared against
full-history canonical content and order with identical output-retention rules.
These are distinct-page walks, not repeated warm route-cache measurements.

| Copied thread    | Events | Main latest / walk ms | Fixed latest / walk ms | Fixed page p95 ms | Fixed canonical unique rows |
| ---------------- | -----: | --------------------: | ---------------------: | ----------------: | --------------------------: |
| `thr_cdfq9maj8q` |  63853 |         55.1 / 1836.9 |          50.4 / 1334.3 |              46.2 |                        2162 |
| `thr_gcuc46ug4j` |  42033 |         52.4 / 2154.9 |          54.1 / 1763.1 |             136.6 |                         698 |
| `thr_m9gz6riv9t` |  32384 |           8.0 / 745.3 |           20.6 / 766.4 |              35.8 |                         952 |
| `thr_kbjzy5zdu7` |  22940 |          13.1 / 677.6 |           16.1 / 715.9 |              79.6 |                         428 |

All eight fixed walks matched canonical row content and order. Main fails on
three of four threads. The canonical builder itself emits one exactly repeated
delegation row in `thr_kbjzy5zdu7`; the oracle removes that exact duplicate
(429 raw, 428 unique), never merely matching IDs or differing content.

The first PR implementation took 1.7–5.0 seconds per walk and was rejected as
too slow. The revised implementation scopes payload context to selected groups,
selects turn IDs before fetching full bodies, avoids redundant request lookups,
and directs turn, parent and interruption queries to existing selective indexes.
The previous whole-thread sequence scans were unnecessary.

The cache contains compact request-to-turn IDs and an ordering boundary for an
exact snapshot, not projected rows or event payloads. Appends invalidate the
latest snapshot; completed groups are never frozen. There is no ingestion
projection, backfill, or persistent timeline index. The separate latest profile
clears this context cache before measuring, including its construction cost:

| Thread suffix | Loaded events | Loaded bytes | Group context ms | Ordering context ms | Other selection/query ms | Grouping ms |
| ------------- | ------------: | -----------: | ---------------: | ------------------: | -----------------------: | ----------: |
| `cdfq9maj8q`  |          1521 |      1816838 |             10.3 |                 9.6 |                      6.0 |         5.7 |
| `gcuc46ug4j`  |          1167 |      1828904 |             16.4 |                 8.9 |                      4.8 |         7.6 |
| `m9gz6riv9t`  |           419 |       216335 |              2.4 |                 7.9 |                      5.3 |         2.4 |
| `kbjzy5zdu7`  |           372 |       670021 |              2.6 |                 2.4 |                      2.8 |         4.1 |

The two largest walks are faster than main; the other two are within 6%.
Cold latest requests still cost about 3 ms and 13 ms more on two threads.
Shared-machine timings are not a latency SLA, and these four threads are not
proof of performance across the entire 1,132-thread corpus.

Run the committed fixed endpoint/client corpus check from the repository root:

```sh
BB_PROVIDER_CORPUS_DIR=/path/to/copied-corpus \
BB_TIMELINE_PAGINATION_REPORT=/tmp/timeline-pagination.json \
pnpm exec turbo run test --env-mode=loose --force --filter=@bb/server -- \
  test/provider-corpus/timeline-pagination-correctness.test.ts
```

`BB_TIMELINE_PAGINATION_THREAD` optionally selects one of the four fixture IDs.
The report contains timing/count metadata; optional `/tmp/timeline-diff-*.json`
diagnostics contain copied conversation content and should remain local.
The paired run uses the same test with restored main source modules and a spy
that switches the route builder; it alternates the corresponding client merge.

Focused checks cover tiny event/512-byte targets, oversized turns/details,
nested and late events, straddling items, snapshot appends, edited history,
suffix replacement after reopen, same-ID child merging and stale in-flight
pages. New regressions check that one-group pages do not decode unrelated
history, and acceptance after another conversation boundary preserves content.

Browser verification used a fresh source store and a synthetic 45-turn
conversation. Mouse-wheel paging loaded every message exactly once; expanding
the oldest summary displayed 20 commands. The source CLI verbose walk returned
all 45 messages exactly once. Owned processes and the fixture store were cleaned
up. Provider execution, mobile Safari and live-provider scroll behavior were
not verified. The verification inventory has an existing unrelated unmapped
`browser` CLI family; its baseline was not rewritten to hide that failure.

See [the pagination contract](timeline-pagination.md) for lifecycle semantics.

A follow-up replaces the request-by-turn overlap loop with an ordered scan.
Six database-backed cases cover accepted turns, overlapping alternatives and
expired spans. The history-edit revision table and its triggers were subsequently removed
when pagination across edits became best effort.

A separate paired comparison against `51e0dc78d2` ran baseline/new/new/baseline
with fresh databases and route caches. All 16 endpoint/client walks matched
canonical content and order. Two-run means were:

| Thread suffix | Previous latest ms | Scan latest ms | Previous walk ms | Scan walk ms |
| ------------- | -----------------: | -------------: | ---------------: | -----------: |
| `cdfq9maj8q`  |               60.9 |           49.5 |           1328.8 |       1337.9 |
| `gcuc46ug4j`  |               56.3 |           55.1 |           1763.5 |       1778.7 |
| `m9gz6riv9t`  |               21.7 |           18.9 |            784.0 |        734.9 |
| `kbjzy5zdu7`  |               16.6 |           40.0 |            717.7 |        807.4 |

These measurements do not establish a general endpoint latency improvement.
The scan removes quadratic overlap comparisons without changing page content;
query, decoding and grouping costs remain. An additional allocation-based leaf
measurement experiment was discarded after mixed walk timings.

Pagination now continues across history edits, suffix replacement, deleted
anchors and reduced sequence tips. The endpoint regression expects continuation
rather than HTTP 400. Canonical parity is required for unchanged history and
walks with later appends; it is deliberately not guaranteed across edits.
There is no revision table, event trigger or database migration in the final
change. Existing message-edit notifications still invalidate request caches.
