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
runs every ten seconds while database maintenance is idle and never waits on a
competing writer. Committed deletions invalidate cached timelines and publish a
history-compacted notification to viewers of the thread.
