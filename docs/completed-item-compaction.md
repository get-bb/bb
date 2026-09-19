# Completed item history compaction

The existing idle background event-maintenance rotation combines eligible settled item history
into its `item/completed` row. The completion keeps its ID, payload, original
creation timestamp and retained-output ownership. Its physical sequence becomes
the first retained lifecycle sequence. One versioned internal column stores the
original completion sequence and lossless start/delta information. No table,
index, allocator, scheduler or daemon protocol change is involved.

Eligibility requires a unique compatible completion, at most one start, a later
retained completion of the turn, and no late lifecycle events or reopened turn.
Supported kinds are command executions, file changes, assistant messages and
reasoning. Unpruned repeated delta streams, file-change output deltas, malformed
payloads, incompatible envelopes and oversized discovery/payload windows remain
ordinary. A lifetime crossing a user request or completed context clear remains
ordinary so message editing can keep its existing suffix-deletion behavior.
Assistant lifetimes crossing another assistant completion or manager output also
remain ordinary, preserving the output API and child completion notifications.

Assistant and reasoning delta text is retained. A command delta can become an
empty timing marker only when the command has completed, failed or been
interrupted and has nonempty aggregated output. Without a retained start, the
aggregated output must contain that delta. Otherwise the entire lifecycle stays
ordinary. Starts never derive mutable output fields from a completion, so later
output truncation or expiry cannot change reconstructed starts.

Discovery uses the existing physical sequence/type/turn/item indexes. Each
advance bounds candidate/support rows and input bytes; ambiguous or larger
lifecycles are skipped, not partially rewritten. Source deletion, completion
movement and cursor progress commit together. PR1's generation increment and
`history-rewritten` notification invalidate cached views after the commit.
Completed-item compaction is excluded from the synchronous per-thread cleanup
rotation used by ingestion and turn-completion handlers. Existing PR1 live
cleanup remains unchanged; the idle sweep performs compaction and refreshes
open clients. This avoids adding compaction writes to the live path. SQLite
checkpointing can still stall a background transaction (and unrelated live
writes); limits bound work rather than guaranteeing a maximum elapsed time.
No checkpoint setting is changed.

Timeline queries select physical rows with their internal metadata, then reconstruct
only the selected history for projection. The timeline event budget charges for
the records inside each combined item, so removing physical rows does not cause
a page to decode substantially more history. Reconstruction passes validated
payload objects directly to projection instead of parsing them again. A per-connection
in-memory cache reuses reconstruction only when both stored metadata and the
completion payload match exactly. It evicts least-recently-used entries above
8 million accounted text characters or 10,000 reconstructed records, and does
not retain oversized entries. These are accounting limits, not a byte-exact
JavaScript heap limit. Current row scope and snapshot filtering are applied
after reuse; changed output or metadata forces reconstruction. Selected fork
history recovers completion order before applying the existing completed-turn and event-type rules. Forks still create
new IDs and sequence numbers. No arbitrary deleted-ID lookup or virtual raw-event
pagination is provided.

## SDK, CLI and exports

`threads.events.list`, the raw events HTTP route and `bb thread log --json`
(including `--all` JSON exports) return physical records. A combined row is still
`item/completed`; it has its original completion ID/payload/timestamp and its new
first lifecycle sequence. Internal metadata is not returned. Deleted start/delta
IDs, original raw counts and old completion positions are not retained as a raw
API contract. Consumers must not treat these exports as an exact provider wire
transcript.

Physical-row limits and sequence cursors count combined rows. Restart a traversal
after a history rewrite rather than continuing an old cursor against changed
history. Human CLI formats and the UI reconstruct original ordering, timing,
text and edit cards. Raw export limits count physical rows; the timeline work
budget counts reconstructed records. Exact page boundaries are not promised.
Response byte limits remain independent of row limits, and stored timeline byte
accounting includes metadata.

## Verification

The migrated SQLite regression tests cover eligibility, lossless reconstruction,
command discard rules, output ownership, atomic rollback, late arrivals,
highwater, boundary exclusions and one-row raw traversal. Server tests exercise
the existing live wrapper, rewrite notifications and warmed timeline caches.
Full-copy measurements and UI evidence accompany the PR; prototype
measurements are not implementation guarantees.
