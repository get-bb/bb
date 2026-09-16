# Event history pruning

The server makes `thread-event-pruning` eligible on every ten-second tick, after
queued-message dispatch and other lifecycle work, independently of hourly vacuum.
It checks `isDatabaseMaintenanceIdle` before every transaction, yields between
advances, and starts no further advances after 64 advances or 50 ms elapsed.
A busy skip is retried on the next tick, rather than consuming an hourly slot.
The elapsed budget is checked between synchronous advances; it cannot interrupt a
SQLite statement or commit and is not a maximum pause guarantee. Maintenance uses
a zero busy timeout and restores the connection's normal timeout in `finally`, so
lock contention causes a retry on a later tick.

Each policy and scope has an independent versioned `thread_pruning_cursors` row.
An empty scope tracks the database-wide sweep; a thread ID tracks live delta or
background cleanup for that thread. Thread-scoped rows cascade on thread deletion. Traversal
uses thread primary keys and existing event sequence indexes. A visit captures an
upper sequence, persists its current thread, policy step and scan position, and
commits mutations and progress together. A completed traversal resets its thread
position to revisit late arrivals and IDs inserted behind the cursor. Policy
rotation uses committed cursor timestamps and survives process restarts. A failed
batch retains its previous cursor. A missing thread advances safely.

## Policies

- **Rate limits:** walk at most 64 snapshots in descending sequence order. Fetch
  candidate IDs first and inspect payloads individually, stopping before the next
  row after 1 MiB of payloads or 8 ms of scan/witness work. Always allow one row so
  oversized payloads cannot stall progress. A single row, deletion, or commit may
  exceed those limits. Keep
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
- **Turn diffs:** skip incoming daemon `turn/diff/updated` snapshots before
  allocating a sequence, using the existing ingestion skip behavior. Delete
  historical snapshots except when a snapshot is the thread's latest stored row.
  Once a newer event exists, the next traversal can remove that snapshot.
  `fileChange` items are separate and remain available to edit cards.
- **Resolved items:** scan deltas and background-task progress for every thread,
  including unarchived threads. Share the live cleanup's per-thread/per-kind
  `thread_pruning_cursors` rows. Candidate position and unfinished support
  probes commit with deletions, advance even when candidates survive, and restart
  at the beginning after each finite captured window. Late completions are revisited
  in subsequent cycles. Rows cascade away when their thread is deleted.

No indexes or columns are added to `events`. Rate-limit witness lookups use the
bookkeeping primary key and the existing event primary key, avoiding correlated
searches through a provider's entire suffix. The remaining archive predicates use
existing thread/type/turn/item indexes. Candidate windows contain at most 500 rows;
large individual payloads, lock acquisition and filesystem latency can still make
an advance exceed the elapsed sweep budget.

## Allocation, readers and notifications

Sequence allocation and provider recovery continue to read the events table.
Pruning preserves the current latest row, checked within each deletion transaction,
so a paused scan cannot delete the new tail after history truncation. The scan's
captured upper sequence only bounds traversal; it does not allocate positions.
Daemon diffs receive no sequence and no entry in `acceptedEvents`, just like other
skipped inputs. A successful batch response still drains the daemon's delivery
queue, including when every input was skipped. No daemon protocol change is needed.

Provider diffs are stamped with the runtime's registered provider identity; they
do not establish it. Session creation/resume emits `provider.env-resolved`, and
identity notifications emit `thread/identity`. These and turn lifecycle events
remain stored. Provider recovery uses the latest non-null attribution after the
last completed context clear, without a separate bookmark or special keeper table.
Historical pruning creates sequence gaps; skipped incoming diffs do not.

Every committed deletion batch increments the thread's in-process rewrite
version. The scheduler sends `history-rewritten` immediately after each successful
batch, so a later failure cannot suppress earlier notifications. Live best-effort
pruning also notifies after partial success. Progress logs contain policy, cursor,
cycle, scanned/deleted rows, deleted JSON bytes, bookkeeping cleanup and elapsed
time, without event payloads. Rate cleanup also reports scanned payload bytes,
scan/witness time and deletion time. Each advance reports its total duration,
including commit; sweeps report their maximum advance duration. Advances and live
pruning calls taking at least 50 ms emit warnings. Busy skips and failures remain
distinguishable. `removedBytes` covers the rate/archive/diff policies; resolved-item
cleanup currently reports row counts only.

Completed-output thresholds, sidecars, expiry, migration cursor and scheduling are
unchanged. This phase does not introduce lifecycle/delta compaction, virtual
readers, command text deletion, user-facing configuration, or vacuum/repacking.

## Current verification

Regression tests exercise retained first-delta prefixes, late completions,
unfinished probes across restart, rollback of cursor updates, background cleanup
of unarchived threads, oversized rate snapshots, next-tick retry after a busy skip,
continued work on subsequent ticks, and reporting a budget-overrunning advance.

A same-host warm in-memory comparison used identical seeded data and the production
transaction functions. These are diagnostic samples, not latency guarantees:

| Fixture                                    | Before max advance | After max advance | Before total | After total | Advances before/after |
| ------------------------------------------ | -----------------: | ----------------: | -----------: | ----------: | --------------------: |
| 2,000 distinct providers, 512-byte padding |           16.20 ms |           4.07 ms |     59.08 ms |    93.23 ms |               12 / 39 |
| 600 duplicate snapshots, 256 KiB padding   |           15.30 ms |           1.51 ms |     19.44 ms |    90.29 ms |               6 / 154 |

Both versions retained all 2,000 distinct providers and removed 599 duplicates.
Smaller transactions reduce these measured pauses at the cost of more total work.
This does not reproduce or explain the separately reported 456 ms batch: that run
was not a controlled comparison, and cold storage/commit latency was not measured
here. The new warnings and per-stage timing expose such overruns for investigation.

For scheduling scale, 30,665 advances at 64 per ten-second tick would require 480
invocations, roughly 80 minutes of uninterrupted idle eligibility, versus roughly
20 days at the previous hourly cadence. This is not a current full-copy forecast:
smaller rate batches, the new all-thread pass, elapsed limits and busy ticks change
the actual advance count and completion time. The private full copy has not been
remeasured with this implementation.

## Historical verification measurements

The measurements below describe the earlier implementation that consumed incoming
sequence positions without storing diffs and deleted even the latest historical
diff. They are historical performance evidence, not validation of the current
latest-row preservation policy; exact deletion totals and timings have not been
remeasured on that private baseline. Current automated coverage checks skipped and
mixed daemon batches, retained file changes, provider identity/context clearing,
latest-row retention, and resumption after truncation against migrated databases.

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
