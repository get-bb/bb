# Event history pruning

Every event-cleanup deletion preserves the thread's current latest stored event.
The shared `isBeforeLatestThreadEvent` SQL predicate checks this inside the deletion
transaction, including when history was truncated while cleanup was paused.
Sequence allocation and provider-session recovery continue to read stored events;
there is no bookmark table.

## Retention rules

| Event                                         | Keep                                                                                           | Delete                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Rate-limit snapshots                          | Latest snapshot in an unarchived thread                                                        | Older snapshots; all snapshots in an archived thread                   |
| Context-window usage                          | Latest root snapshot and latest root snapshot containing context-window capacity, if different | Other snapshots                                                        |
| Token usage                                   | Latest root snapshot                                                                           | Other snapshots                                                        |
| Turn-diff snapshots                           | Incoming snapshots are skipped before sequence allocation                                      | Historical snapshots                                                   |
| Message, reasoning, and command-output deltas | Unresolved deltas and the first delta of each type in an item scope                            | Subsequent deltas once matching completed output exists                |
| Background-task progress                      | Latest progress for an unfinished task                                                         | Superseded progress, and all progress after background-task completion |

The latest-event safeguard takes precedence over every deletion rule, including
archived rate limits. Once another event exists, a later pass can delete the
previous tail. No other event types become eligible for deletion in this change.

A thread has one provider. Rate-limit cleanup uses only thread, type, sequence and
archive status; it does not inspect provider JSON or maintain a keeper table.
Archive status is checked again in every deletion transaction.

Root usage excludes turns whose `turn/started` event has a parent tool call. Context
snapshots can omit capacity, so the context indicator combines the latest usage
with the last known capacity. This requires at most two root context snapshots,
not a recent-history window. Token usage keeps one root snapshot. The shared tail
safeguard can additionally retain a nested usage event when it is the thread tail.
There are no active/idle/archived retention counts or age windows.

Delta completion matches thread, turn, item ID, item kind and parent-tool-call
scope. Earlier-delta detection also matches delta type. Command-output deletion
requires `aggregatedOutput` on the completed item. Background progress matches
thread and item ID; `item/backgroundTask/completed` or newer progress supersedes
it. Completed items and `fileChange` events remain available to timeline readers.

## Execution and progress

Live triggers and background sweeps use the same retention rules. Each live call
advances one policy for its thread in one transaction, using the existing worker
with a 32-candidate page and a 32-unit resolved-item support budget. Policy rotation,
usage discovery, and unfinished probes are persisted in the existing scoped cursor
rows. Calls no longer synchronously run all cleanup categories or count deleted
payload bytes. The zero busy timeout covers policy selection and the transaction,
and the previous timeout is restored on success or failure.

Active cleanup retains the 30-second/250-position throttle; idle and archive
transitions also advance one policy. Repeated active calls progress without waiting
for global idleness. Under continuous activity, the four policies rotate across
calls; cleanup is incremental and may fall behind event production. A thread with
no further triggers can still wait for an idle background sweep. There is no
promise that a single idle/archive transition finishes its cleanup. Background pruning
runs every ten seconds when database maintenance is idle, after lifecycle and
queued-message dispatch work. Busy skips retry on the next tick.

The background policies are `rate-limits`, `usage`, `turn-diffs`, and
`resolved-items`, all traversing threads. `thread_pruning_cursors` is the only new
table. Its policy/scope key distinguishes database-wide cursors (empty scope) from
per-thread policy and delta/background progress (thread ID scope). Thread-scoped rows cascade
on thread deletion. Existing output-migration cursor storage is unchanged.

A visit captures an upper sequence and persists progress with deletions in one
transaction. Usage discovery scans bounded pages before deleting, preserving the
root/capacity witnesses it found. Missing witnesses defer deletion until a later
pass rediscovers them. Live and background usage discovery both finish across bounded pages. Completed traversals revisit late arrivals.
Resolved-item scans persist unfinished support probes and advance past retained
candidates, so retained first deltas cannot permanently block later cleanup.

Background rate cleanup inspects at most 64 event IDs per advance without reading
payloads; usage/diff pages and resolved support budgets are at most 500. Live calls
use 32 instead. Resolved-item discovery reads at most one page per relevant type
(four delta types or one progress type), merges their IDs by sequence, and loads
metadata only for the selected page. This skips unrelated history using the
existing type/sequence index, rather than traversing every event. Existing thread/type/sequence and
turn/item indexes support these queries; no events-table columns or indexes change.

A sweep starts no further advances after 64 advances or 50 ms elapsed and yields
between advances. These are work budgets, not a hard latency cap: synchronous
SQLite statements, deletes, and commits can exceed 50 ms. Slow advances emit
warnings. A zero busy timeout prevents maintenance from waiting on a competing
writer and is restored afterward. Committed deletions invalidate cached timelines
and publish history-rewritten notifications; failed transactions publish nothing.

## Verification

Real migrated SQLite tests exercise one-snapshot rate retention, archive/unarchive
transitions, current-tail protection after truncation, usage fallback capacity,
nested usage, retained delta prefixes, late completions, restart during unfinished
probes, transaction rollback, per-thread scope isolation, and query index selection.
Server tests exercise context-indicator preservation and next-tick scheduling.
Daemon tests verify that skipped input still drains successful delivery batches.

Earlier private-copy measurements used different retention rules and do not predict
this implementation's deletion counts or convergence time. The separately reported
456 ms advance has not been reproduced or explained by a controlled comparison.
The final full-copy workload has not been benchmarked; elapsed budgets are advisory.

## Live-path responsiveness measurement

Private sanitized copies of 2,326 threads were measured with the production
best-effort wrapper, a real NotificationHub without connected clients, inert
logging sinks, and a queued setImmediate heartbeat. All copies were treated as
unarchived, including histories originally archived; this is not a traffic-weighted
sample. No app/server/Connect client used a copy. All copies contained zero Connect
records. Copy preparation finished before timing; no benchmark backup, profiling,
tests, or timeline verification overlapped timing.

| Path/scenario                            |  Calls | p95 synchronous call |  Max call | Calls over 50 ms |
| ---------------------------------------- | -----: | -------------------: | --------: | ---------------: |
| Previous full live call, backlog         |  4,652 |             36.65 ms | 106.19 ms |               68 |
| Scoped live advance, backlog             | 37,216 |              5.58 ms |  39.64 ms |                0 |
| Previous full live call, already cleaned |  4,652 |             32.94 ms | 199.20 ms |               79 |
| Scoped live advance, already cleaned     | 37,216 |              3.59 ms |  20.81 ms |                0 |

The previous wrapper ran two passes; the new path ran sixteen passes (four policy
rotations). These are per-call pause measurements, not equal-work throughput
comparisons: the old backlog calls removed 158,793 rows and the new calls removed
158,431. Already-cleaned calls removed zero rows. There were no cleanup failures.
Maximum queued-heartbeat delay for the final backlog/settled runs was 39.66/20.84 ms.
The first backlog pass alone measured p95/max 20.88/37.62 ms; smaller repeat calls
lower the aggregate p95. An intermediate implementation without typed discovery
still produced a 144.73 ms backlog outlier. None of these runs establishes a hard
latency cap or proves a regression relative to code before this PR. Storage,
checkpoint/commit, other host activity, real logging and connected clients can
change the result.

All 2,326 complete timeline results and context indicators matched the sanitized
baseline after the final measured live cleanup (2,223 non-null indicators). This
checks partial cleanup progress, not a claim that sixteen calls drain every thread.
