# Timeline pagination verification

Measured on 2026-09-08 using the copied provider corpus and isolated in-memory
server databases. Baseline: origin/main `56a4e459ea` (including large-output
sidecars). No code from the rejected streaming projection was used.

The test calls the real Hono endpoint, serializes and validates each response,
and prepends it using the real client merge. Its oracle is a full-history
canonical build with the same summary and retained-output preview policy.
Oracle construction and corpus loading are outside the request timer. Each
walk requests distinct pages; this is not a repeated route-cache benchmark.
The separate latest profile clears the scalar ordering-context cache first.

| Copied thread    | Events | Main merged / canonical unique rows | Fixed merged / canonical unique rows | Main latest / walk ms | Fixed latest / walk ms | Fixed page p95 ms |
| ---------------- | -----: | ----------------------------------: | -----------------------------------: | --------------------: | ---------------------: | ----------------: |
| `thr_cdfq9maj8q` |  63853 |                         2161 / 2162 |                          2162 / 2162 |         48.7 / 1468.8 |         132.8 / 5027.3 |             132.8 |
| `thr_gcuc46ug4j` |  42033 |                           710 / 698 |                            698 / 698 |         57.0 / 1943.2 |          90.6 / 2834.8 |             154.7 |
| `thr_m9gz6riv9t` |  32384 |                           952 / 952 |                            952 / 952 |           8.5 / 831.6 |          43.5 / 1671.0 |              73.2 |
| `thr_kbjzy5zdu7` |  22940 |                           427 / 428 |                            428 / 428 |          14.2 / 683.5 |          74.3 / 1835.0 |             154.6 |

All four fixed walks matched complete row content and order. The original
canonical builder emits one exactly repeated delegation row in `thr_kbjzy5zdu7`;
the oracle removes exact duplicate rows (429 raw rows, 428 unique). It does not
remove merely matching IDs or differing content. Main loses one additional
unique row there. In `thr_gcuc46ug4j`, main misses 301 canonical IDs and introduces
313 fragment IDs; row counts alone conceal the damage.

Correctness costs more than the old incomplete windows. These are single-run
wall times on a shared machine, not an isolated latency SLA or a speedup claim.
Complete turns and lifecycle context are decoded on demand for each page;
completed groups are not frozen. Latest cold profile costs were:

| Thread suffix | Loaded events | Loaded event bytes | Group context ms | Ordering context ms | Grouping ms |
| ------------- | ------------: | -----------------: | ---------------: | ------------------: | ----------: |
| `cdfq9maj8q`  |          4018 |            3375964 |             54.0 |                 2.6 |        12.0 |
| `gcuc46ug4j`  |          1942 |            2016707 |             50.3 |                 5.9 |        10.3 |
| `m9gz6riv9t`  |          1515 |             504350 |             26.0 |                 1.3 |         2.5 |
| `kbjzy5zdu7`  |           970 |             843460 |             50.8 |                 0.9 |         4.4 |

Grouping parents before looking up their last child avoids multiplying repeated
parent events by child events. Existing indexes suffice. Only the resulting
ordering-boundary scalar is memoized for an unchanged snapshot; no projected
rows, ingestion work, or persistent timeline index are introduced.

Run the corpus check from the repository root (the corpus is not committed):

```sh
BB_PROVIDER_CORPUS_DIR=/path/to/copied-corpus \
BB_TIMELINE_PAGINATION_REPORT=/tmp/timeline-pagination.json \
pnpm exec turbo run test --env-mode=loose --force --filter=@bb/server -- \
  test/provider-corpus/timeline-pagination-correctness.test.ts
```

`BB_TIMELINE_PAGINATION_THREAD` optionally selects one of the four fixture IDs.
The report contains timing/count metadata; optional `/tmp/timeline-diff-*.json`
diagnostics contain copied conversation content and should remain local.

Focused checks cover tiny event and 512-byte targets, oversized turns and detail
walks, straddling items, nested and late delegation events, context clears,
appends between actual endpoint requests, edited history, same-sequence suffix
replacement after database reopen, stable-ID child merges, and an in-flight
older response arriving after the app has switched snapshots. Relevant Turbo
server, database, client, app, CLI and SDK tests and typechecks pass.

Browser verification used a fresh source dev store and a synthetic 45-turn
conversation. Mouse-wheel paging loaded all 45 user messages exactly once;
expanding the oldest summary displayed its 20 commands. Source CLI
`thread log --all --format verbose` walked the same conversation. Provider
execution, mobile Safari, and live-provider scroll behavior were not verified.
The verification inventory reports an existing unmapped `browser` CLI family;
that unrelated baseline was not rewritten to hide the failure.

See [the pagination contract](timeline-pagination.md) for snapshot replacement,
legacy cursor handling, soft response targets and detail continuation semantics.
