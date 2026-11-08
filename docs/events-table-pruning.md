# Event history pruning

The server deletes superseded high-volume events from thread history. Every
deletion preserves the thread's current latest stored event, so sequence
allocation and provider-session recovery always have a tail to read.

## Retention rules

| Event                                         | Keep                                                                                           | Delete                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Rate-limit snapshots                          | Latest snapshot in an unarchived thread                                                        | Older snapshots; all snapshots in an archived thread                   |
| Context-window usage                          | Latest root snapshot and latest root snapshot containing context-window capacity, if different | Other snapshots                                                        |
| Token usage                                   | Latest root snapshot                                                                           | Other snapshots                                                        |
| Turn-diff snapshots                           | Incoming snapshots are skipped before sequence allocation                                      | Historical snapshots                                                   |
| Message, reasoning, and command-output deltas | Unresolved deltas and the first delta of each type in an item scope                            | Subsequent deltas once matching completed output exists                |
| Background-task progress                      | Latest progress for an unfinished task                                                         | Superseded progress, and all progress after background-task completion |

The latest-event safeguard takes precedence over every rule, including archived
rate limits; a later pass can delete the previous tail once another event
exists. No other event types are deleted, and there are no age windows or
per-state retention counts.

Root usage excludes turns started by a parent tool call. The context indicator
combines the latest usage with the last known capacity, which is why a second
root context snapshot can be kept. Command-output deltas are deleted only when
the completed item carries `aggregatedOutput`. Completed items and `fileChange`
events remain available to timeline readers.

## When pruning runs

Live triggers (thread activity, idle, and archive transitions) and a background
sweep apply the same rules incrementally. Each call advances one policy for one
thread, so cleanup can fall behind under continuous activity and a single
idle or archive transition does not guarantee completion. The background sweep
runs every ten seconds and never waits on a competing writer. It skips threads
that are active or starting, or have a pending or resolving interaction, and
keeps advancing every other thread; each deletion transaction rechecks this, so
a thread that becomes busy mid-visit is left for a later cycle. Each policy picks its next thread in its own transaction
before pruning it, so if a step fails, the sweep records the failure in
`sweep_item_failures` under `<policy>:<thread id>` and the next pick moves past
that thread while the other threads keep going; it is picked again once its
retry time (1 minute, doubling to 1 hour) passes. A new policy, or
a policy whose version changes, queues every thread for that policy. Committed
deletions advance the thread's rewrite generation, which keys every cached
timeline, and send viewers of the thread a history-compacted notification. A
live step doesn't send its own: its notification goes out with the sweep's next
notification for that thread, so a turn end and the sweep visits after it send
one. If the sweep sends none within a minute, the next sweep run sends it.
Viewers still see the compacted rows on their next timeline update, which is
built from the current rows. Archiving a thread runs one live step and
then drops the thread's live progress; the background sweep finishes archived
threads.

## Pass bounds and resumption

Each call works for about 20 ms, then commits and records where it stopped.
Deletes run in chunks of 16 rows, so one call stays well under 50 ms even when
deletes are slow.

A pass over a thread's deltas or background-task progress ends at the event
before the thread's latest one. The next pass starts from that bound instead of
the first event. It reaches back below the bound only for items that gained a
completion (deltas) or newer progress or completion (background tasks) since the
last pass, starting at that item's earliest candidate. Everything else below the
bound was either pruned or is kept for good: the first delta of an item, a delta
without a turn or item, or a candidate whose deciding row has not arrived yet,
which the reach-back covers once it does. Deleting a thread's event suffix, or
inserting an event at or below the thread's latest sequence, moves the bound back
before that sequence.
