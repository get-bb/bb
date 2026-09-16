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

Live triggers and background sweeps use the same retention rules. Active cleanup
is throttled; idle and archive transitions also trigger cleanup. Background pruning
runs every ten seconds when database maintenance is idle, after lifecycle and
queued-message dispatch work. Busy skips retry on the next tick.

The background policies are `rate-limits`, `usage`, `turn-diffs`, and
`resolved-items`, all traversing threads. `thread_pruning_cursors` is the only new
table. Its policy/scope key distinguishes database-wide cursors (empty scope) from
per-thread delta/background progress (thread ID scope). Thread-scoped rows cascade
on thread deletion. Existing output-migration cursor storage is unchanged.

A visit captures an upper sequence and persists progress with deletions in one
transaction. Usage discovery scans bounded pages before deleting, preserving the
root/capacity witnesses it found. Missing witnesses defer deletion until a later
pass rediscovers them. Live usage discovery conservatively skips deletion when a
bounded search cannot establish the required witnesses; background traversal
finishes discovery across pages. Completed traversals revisit late arrivals.
Resolved-item scans persist unfinished support probes and advance past retained
candidates, so retained first deltas cannot permanently block later cleanup.

Rate cleanup inspects at most 64 event IDs per advance without reading payloads.
Usage and diff candidate pages contain at most 500 rows. Resolved-item support
lookups have a 500-unit inspection budget. Existing thread/type/sequence and
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
