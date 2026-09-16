# Event history pruning

The server runs `thread-event-pruning` hourly, independently of vacuum and output
retention. It checks `isDatabaseMaintenanceIdle` before every transaction, yields
between advances, and stops after 64 advances or 50 ms elapsed. The elapsed budget
is checked between synchronous advances; it cannot interrupt a SQLite statement.
Maintenance uses a zero busy timeout and restores the connection's normal timeout
in `finally`, so a competing writer causes a retry on a later sweep.

Each policy has an independent versioned `thread_pruning_cursors` row. Traversal
uses thread primary keys and existing event sequence indexes. A visit captures an
upper sequence, persists its current thread, policy step and scan position, and
commits mutations and progress together. A completed traversal resets its thread
position to revisit late arrivals and IDs inserted behind the cursor. Policy
rotation uses committed cursor timestamps and survives process restarts. A failed
batch retains its previous cursor. A missing thread advances safely.

## Policies

- **Rate limits:** walk at most 500 snapshots in descending sequence order. Keep
  the newest snapshot for each valid, nonempty string provider identity. Invalid
  JSON and missing/non-string/empty identities remain untouched. The temporary
  `thread_pruning_rate_limit_keepers` table stores provider-to-event witnesses for
  the current visit. Revalidate each witness by event primary key before deleting
  older rows; drain witness cleanup in batches of at most 500. The throttled live
  trigger also removes duplicates within a bounded recent snapshot window.
- **Archive repair:** recheck archival status every advance. Preserve the existing
  120-position age window, latest root usage/context guards, resolved-delta scope
  and first-delta guards, aggregated command-output guard and background-task
  rules. Usage keeper discovery has its own bounded scan before deletion. Each
  policy step drains across visits rather than stopping after one deletion batch.
  Delta and background-task support probes use bounded indexed pages, with a
  500-unit inspection budget and durable candidate/phase/witness positions.
  Resume incomplete scope lookups on later visits and revalidate completion
  witnesses before using them.
  Live active/idle/archive helpers also bound candidate discovery and mutations.
- **Turn diffs:** consume incoming `turn/diff/updated` snapshots without storing
  their payloads, and delete every historical snapshot, including the last per
  turn. `fileChange` items are separate and remain available to edit cards.

No indexes or columns are added to `events`. Rate-limit witness lookups use the
bookkeeping primary key and the existing event primary key, avoiding correlated
searches through a provider's entire suffix. The remaining archive predicates use
existing thread/type/turn/item indexes. Candidate windows contain at most 500 rows;
large individual payloads, lock acquisition and filesystem latency can still make
an advance exceed the elapsed sweep budget.

## Allocation, readers and notifications

`thread_event_bookmarks` preserves each affected thread's allocation high-water
mark and latest observed provider-thread attribution separately from event JSON.
Both ingestion and historical deletion maintain it transactionally. Sequence and
provider-recovery readers consult it; suffix truncation adjusts it within the
requested truncation interval. Accepted daemon snapshots still consume their
sequence positions, so the daemon contract and acknowledgment behavior are intact.
Raw event history/export intentionally contains fewer rows and sequence gaps.

Every committed deletion batch increments the thread's in-process rewrite
version. The scheduler sends `history-rewritten` immediately after each successful
batch, so a later failure cannot suppress earlier notifications. Live best-effort
pruning also notifies after partial success. Progress logs contain policy, cursor,
cycle, scanned/deleted rows, deleted JSON bytes, bookkeeping cleanup and elapsed
time, without event payloads. Busy skips and failures remain distinguishable.

Completed-output thresholds, sidecars, expiry, migration cursor and scheduling are
unchanged. This phase does not introduce lifecycle/delta compaction, virtual
readers, command text deletion, user-facing configuration, or vacuum/repacking.

## Verification measurements

A sanitized private baseline clone contained 2,378,105 events in 2,326 threads.
The production pruning functions removed 263,181 rate-limit rows (84,386,948 JSON
bytes), 407 rows under the existing archive rules (147,098 bytes), and all 7,362
turn-diff rows (180,551,657 bytes). All 2,326 final timeline projections matched.
Surviving event payloads/positions, sequence high-water marks, and the entire
retained-output sidecar were unchanged. Integrity and foreign-key checks passed.
No app, server or Connect client ran against that clone.

A separate 20,000-distinct-provider fixture needed 84 advances, including cleanup:
591 ms aggregate, 16.4 ms p95 and 27.4 ms maximum per advance. Temporary witnesses
peaked at 20,000 rows, 437,788 key/value bytes and 1,376,256 table/primary-key-index
bytes; no witness rows remained after completion. A single-provider fixture
removed 19,999 rows in 45 advances, 89 ms aggregate, with a 5.3 ms maximum. These
are local warm-storage measurements, not production latency guarantees.

The full-copy traversal used 30,665 advances. Even with every hourly sweep idle
and reaching the 64-advance cap, that is at least 480 sweeps. Elapsed limits and
normal activity extend this; the scheduler does not promise a completion date.

An initial full-copy archive advance took 982 ms. A controlled warm-copy run
reproduced the problem (p95 14.8 ms, max 828 ms): SQLite selected the broad
thread/sequence index for earlier-delta support probes. Replaying its worst
500-candidate window (324,843 payload bytes) scanned 4,612,561 unrelated index
entries across missing earlier-delta lookups. Query time accounted for 750–775 ms
of the 754–783 ms advance; transaction/commit and all other work fit within the
remaining 4–8 ms. This was reproducible query work, not primarily checkpoint I/O.

Explicitly selecting the existing scope index reduced that same advance to
3.4–4.1 ms. Typed candidate discovery also explicitly selects the existing
type/sequence index. Emitted-query-plan tests guard both choices. A complete
revisit then measured p95 2.35 ms/max 5.92 ms. The final fresh baseline clone,
including actual deletions, measured p95/max 16.7/48.6 ms for rate limits,
2.46/22.35 ms for archive repair, and 0.67/16.08 ms for turn diffs, with identical
removal counts and surviving event IDs. These runs bound reproducible query work;
large payloads and cold filesystem/commit latency still prevent a hard wall-clock
guarantee for synchronous SQLite advances.
