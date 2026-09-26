# Direct projection of settled items

This executable prototype compares normalized settled items with the encoded
history design from closed PR #3815. It covers commands, assistant text,
reasoning and file edits. Automatic cleanup remains disabled. The application's
production readers do not accept `item/summary`; never start BB against a
prototype database.

## Representation

A visible settled item becomes one versioned `item/summary` record containing
its normalized `thread-view` message. The completion keeps its row ID, ownership
and creation timestamp; its physical sequence moves to the first lifecycle
record. The normalized message preserves its own source span, timing, parent,
status and content. Output appears once.

Ordinary events still run through event projection. Settled messages join the
projection before grouping, nesting, display collapse and rendering. They never
expand into starts, deltas or synthetic completions. There are no new tables,
columns, indexes or reconstruction caches.

Completely empty assistant/reasoning lifecycles retain their original completion
byte-for-byte and delete redundant empty starts/deltas. They need no summary
because they produce no visible message.

Two small pieces of semantic metadata accompany the message when applicable:

- Command output-retention metadata preserves original length, retained head/tail
  lengths and expiry timing. Production output adapters still need integration.
- Assistant visibility and file-edit positions preserve when the existing
  projector flushes an ordinary tool cell. Without these positions, 17 real
  threads changed delegation interruption/status behavior. The reader applies
  the transition at its original position without reconstructing an event.

The versioned codec validates terminal kinds, source spans, transition positions
and retention fields. Changes to stored semantics need a deliberate versioning
policy. Presentation-only grouping and formatting remain read-time decisions.

## Eligibility

The offline writer derives normalized messages from a complete thread. It
requires unique compatible item lifecycles, a preceding turn start and a retained
later turn completion. Reused IDs, reopened turns, ambiguous messages, late output
and user/context-boundary crossings remain ordinary. Command output must match
its completion. Discovery limits each lifecycle to 500 records and non-command
content/non-output command details to 256,000 characters.

This is an offline discovery algorithm, not a bounded server maintenance worker.
It rewrites a new sanitized copy only and refuses an existing output file.

## Comparable storage result

All formats use the same sanitized September 16 production snapshot: 2,082,639
events in 2,326 threads. The previous-format copy is the verified PR #3815 worker
output. It is not a fresh capture of the live database.

| Measurement           | Previous encoded history | Direct settled items |
| --------------------- | -----------------------: | -------------------: |
| Item kinds            |                 All four |             All four |
| Event rows removed    |                1,001,984 |              994,410 |
| Remaining event rows  |                1,080,655 |            1,088,229 |
| Allocated bytes saved |            1,223,270,400 |        1,296,994,304 |
| New events columns    |                      One |                 None |
| New tables/indexes    |                     None |                 None |

The new format removes 7,574 fewer event rows but frees about 73.7 MB more
allocated storage. Both cover all four kinds; conservative eligibility differs.
This is a comparison of the complete candidate sets each implementation accepts,
not an identical-item-cohort experiment. All copied DB files remain 6,006,726,656
bytes; free pages are reusable and a separate repack would shrink the files.

The new copy contains 476,386 normalized summaries. Their combined 2,204,504,582
payload bytes include canonical output/text/diffs and are not metadata overhead.

## Correctness

All 2,326 threads match exactly in flat, collapsed/lazy and collapsed/expanded
modes: 6,978 complete-thread comparisons. The final writer performs these checks
against the untouched baseline after applying each thread's candidates.
A final read-only pass independently regenerates all candidates and verifies
every summary payload/position, exact deletion set and unchanged empty completion.

An independent SQLite audit verifies unchanged schema/indexes, all 50 non-event
tables, surviving ordinary rows, owner identity/scope/timestamps, command output
and retention metadata, all per-thread highwater values and foreign-key results.
The copies are mode 0600. Seven plugin-ID tables contain zero Connect records;
no server, client or provider runs against either copy.

The thread-view suite and typecheck pass through Turbo: 429 tests. New coverage
includes all four kinds, interleaving, empty reasoning, nested details, mutable
output, malformed codec data and unsafe candidates. A reused-delegation
regression fails without the visibility transition and passes with it.

## Paired page comparison

`compare-settled-pages.mts` uses this same source revision (based on main
`d81d3d1f8a5c55d7dafbd86b61d086aced02df90`) for ordinary events,
prior-format reconstructed events and direct summaries. It loads the previous
codec, bounded reconstruction cache and decoded-event cache from commit
`f312cf6e451969cd4604ed07027b3497d42ca610`.

The current server walks every latest/older page in every thread. The harness
captures each actual projection input and uses it to construct identical logical
page contents for all three formats. Each measurement includes targeted SQLite
payload reads through the existing primary-key index, inline output truncation,
decoding/reconstruction and `thread-view` projection. Trial order rotates, with
one initial sample and three measured samples per format. Every result must equal
the original page projection.

Production row selection, logical-to-physical benchmark manifests, shared head
state/context retrieval, output-preview decoration, pagination assembly, HTTP
and browser rendering are outside the measured interval. The captured production
request supplies those contexts. This comparison isolates the storage/read
representation; it is not an end-to-end production request benchmark. The
precomputed ID lists belong to the benchmark, not a product lookup requirement.

Normal cases use the saved provider display settings, 1,500-event budget,
20-segment pages, 32,000 inline characters and lazy children. Stress cases use a
10,000-event budget, collapsed turns, expanded children and 8,000 inline
characters. Both walk the whole corpus rather than sampling 30 pages. SQLite
uses production cache/mmap settings. This is a shared-host warm-cache benchmark,
not a cold-disk latency or event-loop guarantee.

The normal run completes all 3,027 page requests (3,035 projection cases,
including skipped empty windows), with zero mismatches.

| Normal-page read stage      | Ordinary events | Previous history | Direct summaries |
| --------------------------- | --------------: | ---------------: | ---------------: |
| Median of case medians      |         6.31 ms |          6.15 ms |          3.10 ms |
| Sum of case elapsed medians |         29.49 s |          27.80 s |          13.58 s |
| Sum of case CPU medians     |         30.81 s |          28.69 s |          14.01 s |

Direct summaries reduce this workload's measured elapsed time by 51.2% versus
the previous format and 54.0% versus ordinary events. Median paired improvement
is 2.87 ms versus the previous format. These percentages apply to the measured
read stage, not the complete request.

The expanded-child run completes all 2,733 page requests (2,741 projection cases),
also with zero mismatches. Sum of case elapsed medians is 32.94 s for ordinary
events, 31.38 s for previous history and 16.45 s for direct summaries: 47.6% less
than the previous format. Median paired improvement is 2.51 ms.

The two complete workloads contain 5,776 projection cases across 5,760 page
requests. All three formats match on every trial. Initial runs flag 5 unique
threads across elapsed/CPU comparisons. Every flagged thread plus systematic
controls was rerun with nine samples per format: 145 normal and 86 expanded
cases. No repeated case exceeds both 5 ms and 10% overhead in elapsed time or
CPU versus either comparison format. Original samples remain in the artifacts;
these repeat results do not replace the full-corpus timing totals.

## Reproduction

Use only sanitized research copies. The baseline must have the unused null
`completed_item_history` column left by the previous research setup. The writer
does not use or modify that column.

```sh
node --import tsx packages/thread-view/experiments/settled-items.mts \
  /private/baseline.db /private/new-summary-copy.db /private/write-results

node --import tsx packages/thread-view/experiments/compare-settled-pages.mts \
  /private/baseline.db /private/prior-worker.db /private/new-summary-copy.db \
  /private/page-results

node --import tsx packages/thread-view/experiments/compare-settled-pages.mts \
  /private/baseline.db /private/prior-worker.db /private/new-summary-copy.db \
  /private/stress-results --stress
```

The comparison requires the pinned prior commit to exist locally. It extracts
its codec/reader and an instrumented copy of the current server timeline module
into the private artifact directory. Production source is not patched at runtime.

Optional numeric arguments limit threads for investigation; omit them for the
whole corpus. `--threads=/private/ids.json` selects thread IDs and `--trials=9`
controls repeat count. The writer's `--benchmark` mode reopens completed copies
read-only, independently regenerates every candidate and measures full-thread
reads; those measurements must not be mixed with the page results.
`--verify-candidates-only` performs the exact representation/deletion verification
without repeating the full-thread views or timing them.

## Production integration still required

This completes the all-kind representation/comparison prototype, not rollout:

- Add an internal persisted-event contract and integrate scope-based selectors,
  pages, nested details, outlines and raw exports.
- Define snapshot/cursor invalidation for a sequence inside a summarized
  lifecycle. Current cursors have no history-rewrite generation and final state
  cannot reproduce an old intermediate pending state.
- Make forks and edits copy/trim summaries while preserving spans and ownership.
- Wire output hydration, retention and downloads to the canonical message and
  preserved retention metadata.
- Add bounded, resumable maintenance, late-arrival handling and rewrite/cache
  invalidation; measure the actual live/background wrapper and catch-up time.

No startup-delay, maximum event-loop-stall or production catch-up claim follows
from this offline prototype. No migration, deployment or merge is enabled.
