# Timeline Rendering Performance

Status: **W2, W3, W4, W5 implemented + tested in this PR.** W1 (visibility-gate
side-chat) is **deferred** — gating its timeline query couples to a side-chat
delete-safety check and risks deleting a side-chat with real content; W4's deltas
already make hidden-tab refetches cheap, so the herd impact is largely mitigated.
Investigation complete; design validated by adversarial review.
Branch: `bb/timeline-rendering-performance-plan-*`.

Grounded in measurements against the live packaged server (`http://127.0.0.1:38886`)
over the local dev DB `/root/.bb/bb.db` (104,490 events / 124 threads), plus an
in-process profiling probe and an adversarial correctness review of the
incremental-update design. Concrete before/after numbers are in
[§10](#10-before--after--concrete-numbers); re-run everything via
[§12 Validation](#12-validation).

---

## 1. Problem

The thread timeline is slow and wasteful during streaming and on large threads.
Three reported symptoms, all confirmed and quantified:

1. **Large payload** — the whole visible window is re-sent on every update, and
   during streaming that window is **huge** (see §3: up to ~950 KB).
2. **Repeated refetches for incremental updates** — one appended event → a full
   server rebuild + full window refetch + full client re-merge.
3. **Thundering herd during streaming** — invalidations land together and each
   triggers a full from-scratch rebuild, across **every mounted timeline**.

Scenarios we care about: **initial load**, **streaming**, **active turns**,
**idle threads**.

---

## 2. How it works today (verified against code)

**Fetch (client).** `useThreadTimeline` (`apps/app/src/hooks/queries/thread-queries.ts:632`)
is a single `useQuery` keyed by `[THREAD_TIMELINE_QUERY_KEY, threadId]`. It calls
`api.getThreadTimeline({ id })` (`apps/app/src/lib/api.ts:1213`) with **no**
cursor/segmentLimit/afterSequence → always the server-default latest window
(`THREAD_TIMELINE_DEFAULT_SEGMENT_LIMIT = 20`). "Load older" rows live in
component-local `useState` in `useThreadTimelinePages.ts` (not a second cached
query); live updates re-run the single latest-window query and re-merge.

**Invalidation (client).** Realtime transport is a **WebSocket**
(`apps/app/src/lib/ws.ts`, `useRealtimeSubscription.ts`). `events-appended`
→ `dirtyThreadTimelineQueries` (`realtime-cache-registry.ts:120`) →
`getThreadTimelineInvalidationQueryKeys` invalidates **two** prefixes: the
timeline window **and** the turn-summary-details prefix
(`cache-invalidation-groups.ts:93`) → `invalidateQueries` = **full refetch**.
Batched at `INVALIDATION_DEBOUNCE_MS = 50` / `INVALIDATION_MAX_WAIT_MS = 200`
(`realtime-cache-effects.ts:29`). There is **no incremental/`setQueryData` merge**
for server-appended events (the only timeline `setQueryData` is optimistic local
user messages, `thread-runtime-cache-owner.ts:422`).

**The WS `changed` message carries no sequence** — only `{ entity, id, changes,
metadata:{ eventTypes, hasPendingInteraction, projectId } }` (`change-kinds.ts:166`
`threadChangeMetadataSchema` is `z.strict()`). So the client cannot know _what_
or _how many_ events arrived → full refetch is its only correctness-safe option.

**Mounted-timeline fan-out.** Side-chat tabs stay **mounted** when inactive
(`display:none`, not unmounted — `SideChatTabDeck.tsx:53`); each
`SideChatTabContent` runs `useThreadTimeline` for its main thread **and** its
child (`:180`, `:412`). Every mounted timeline is an independent active query
that refetches its full window on its thread's `events-appended`. **The herd is
across mounted timelines, not across pages of one thread.**

**Server build (no cache).** `routes/threads/data.ts:314` → `buildThreadTimeline`
(`services/threads/timeline.ts:894`): segment-anchor window selection →
JSON-decode events (`parseStoredEvent`) → `compactThreadTimelineSummaryEvents` →
`buildThreadTimelineFromEvents` (`packages/thread-view/src/build-thread-timeline.ts:1071`)
→ paginate. **No ETag / Cache-Control / in-memory cache** — every request
rebuilds from scratch (warm repeats are not faster).

**Projection shape.** A **pure, deterministic, whole-list** projection of the
ordered event array. Completed turns collapse to a single `:turn` summary row;
the **active (not-yet-completed) turn renders expanded** as many top-level rows.
The state machine **mutates earlier row objects in place** as later events
arrive (tool/exec calls upserted by `callId`, streaming assistant text,
background tasks). See §6 — this is why naive incremental append is wrong.

**Render.** `ThreadTimelineRows.tsx` (1727 lines). Rows are `memo`'d with a
custom equality that compares `row` by reference then falls back to a
**structural deep-equal** (`:461`, `:489`). **No list virtualization** (only an
`IntersectionObserver` for scroll chrome). A refetch returns a new array, so the
client deep-equals **every** row and re-renders the changed ones; first mount of
a big window mounts all rows.

---

## 3. Measured baselines (evidence)

### 3a. Idle window (latest turn collapsed) — modest

| thread                     | events | turns | payload | latency | warm repeat    |
| -------------------------- | ------ | ----- | ------- | ------- | -------------- |
| `thr_axgftfi23h` (typical) | 414    | 2     | 14.3 KB | 27 ms   | ~27 ms         |
| `thr_9ua98izdjf` (large)   | 2,986  | 24    | 40.5 KB | 95 ms   | ~95 ms         |
| `thr_kg5cffwyw2` (huge)    | 12,206 | 60    | 60.1 KB | 172 ms  | **130–173 ms** |

Warm repeats are not faster → **no server caching**. `summaryOnly=true` (huge) =
130 ms → cost is event-query + projection, **not serialization**.

### 3b. Streaming window (active turn expanded) — the real problem

Same huge thread, same 942-event turn, built as the **latest** turn, collapsed
vs active (= what the client refetches on every appended event while streaming):

| latest-turn state      | rows | **payload** | build  |
| ---------------------- | ---- | ----------- | ------ |
| collapsed (completed)  | 61   | **65 KB**   | 245 ms |
| **active / streaming** | 353  | **951 KB**  | 264 ms |

→ **~15× larger payload** when the latest turn is active. And it **grows
monotonically through the turn** (re-sent in full on every event):

| through the active turn | rows | payload |
| ----------------------- | ---- | ------- |
| 25%                     | 131  | 382 KB  |
| 50%                     | 206  | 550 KB  |
| 75%                     | 307  | 876 KB  |
| 100%                    | 353  | 951 KB  |

With the 200 ms debounce capping refetches at ~5/s, a single active big-turn
thread re-ships on the order of **~3–5 MB/s** of mostly-unchanged rows, each
triggering a ~250 ms server rebuild and a full client deep-equal + re-render of
hundreds of rows. (My earlier 60 KB figure was an idle thread and understated
streaming by ~15×.)

### 3c. Build-cost attribution (in-process probe; windowed build cross-checks live, huge 183 ms ≈ live 172 ms)

| stage (full event set)               | typical | large  | huge       |
| ------------------------------------ | ------- | ------ | ---------- |
| event query (DB)                     | 5 ms    | 28 ms  | 76 ms      |
| **JSON decode** (`parseStoredEvent`) | 33 ms   | 80 ms  | **186 ms** |
| compaction                           | 1 ms    | 1 ms   | 12 ms      |
| **projection**                       | 28 ms   | 77 ms  | **280 ms** |
| serialize rows                       | 0.1 ms  | 0.3 ms | 1 ms       |

→ Per-build CPU is dominated by **event decode + projection, both O(events),
recomputed from scratch on every refetch**. Serialization is negligible.

### 3d. Event composition / cadence

- `item/completed` = 43,296 rows = **~84% of all event bytes**; **p50 459 B,
  p90 6.6 KB, avg 4 KB, max 1.09 MB** — a few giant tool outputs/diffs dominate.
- Streaming bursts reach **13 events/s (one thread), up to 50/thread-s
  fleet-wide**; with the debounce → ~5 full rebuilds/s per mounted timeline.

---

## 4. Root causes (symptom × scenario)

| RC  | Root cause                                                                                                                                                                                   | Symptoms                 | Worst scenario                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------- |
| RC1 | **Active turn renders expanded** → the latest window is ~950 KB during a big turn and is **re-sent + rebuilt in full on every appended event**                                               | payload, refetches, herd | streaming / active-turn           |
| RC2 | Client always full-refetches on `events-appended`; no delta; WS message has no sequence so it _can't_ do better                                                                              | refetches, payload       | streaming                         |
| RC3 | **Every mounted timeline refetches** — incl. kept-mounted side-chat tabs (main + child)                                                                                                      | herd                     | many threads / side-chat open     |
| RC4 | Server rebuilds from scratch every request (no cache); cost O(events) decode + projection (~130–264 ms)                                                                                      | herd, refetches          | streaming on big threads          |
| RC5 | `events-appended` also invalidates **immutable** completed turn-summary-detail panels                                                                                                        | refetches                | active-turn with expanded details |
| RC6 | Timeline list is **not virtualized**; full deep-equal + mount of hundreds of rows (W4 cuts per-commit re-render; first-mount render cost is **deferred** — virtualization out of scope, §13) | render                   | initial load / active big turn    |
| RC7 | Giant `item/completed` outputs/diffs (≤1 MB) shipped + parsed + rendered inline                                                                                                              | payload, render          | tool calls with big output        |

---

## 5. Proposed improvements (smallest correct change first)

Honors AGENTS.md "Simplicity First": incremental, independently shippable. The
adversarial review (§6) **refuted** the tempting "send rows whose source events
have seq > N and append" design and a resumable in-memory incremental projector
(too risky vs the batch finalize/interrupt machinery). The validated approach is
to **keep reprojecting the bounded window server-side (correct by construction)
and diff it** — plus cheap herd/cache wins.

### W1 (S) — Visibility-gate hidden side-chat timelines → RC3 **[DEFERRED]**

The intent: pass `enabled: false` to `useThreadTimeline` for inactive
(`display:none`) side-chat tabs. **Deferred after investigation:** the child
timeline query (`SideChatTabContent.tsx:412`) and the conversation query (`:180`)
share a query key, so both observers must be gated to actually stop the fetch —
but `childHasUserMessage` (derived from that query) gates `deleteSideChatIfUnused`
(`:443`). Gating it could make a reopened side-chat that already holds messages
look "unused" and **delete it (data loss)** when its hidden tab is cleaned up.
Doing W1 safely needs `childHasUserMessage` decoupled from the gated query (or a
product call on hidden-tab live state). W4 already shrinks every hidden-tab
refetch to a cheap delta, so the herd cost W1 targeted is largely mitigated; W1
is tracked as a follow-up in §13.

### W2 (S) — Don't invalidate turn-summary-details on every batch → RC5 **[IMPLEMENTED — this PR]**

Remove `threadTimelineTurnSummaryDetailsQueryKeyPrefix` from the
`events-appended` grouping in `getThreadTimelineInvalidationQueryKeys`
(`cache-invalidation-groups.ts:93`). A completed turn's detail is a fixed
`sourceSeqStart..sourceSeqEnd` range and is immutable; only the open turn could
change, and it is not expandable-as-collapsed-detail while streaming. No contract
change. (Scope to the open turn's key if a turn can be expanded mid-stream.)

### W3 (S–M) — Server idle/warm-repeat route cache → RC4 (idle/warm), double-mount **[IMPLEMENTED — this PR]**

Bounded LRU in `registerThreadDataRoutes` keyed on the **true projection
inputs**: `(threadId, segmentLimit, includeNestedRows, summaryOnly,
isDevelopment, maxSeq, thread.status, environmentId)`. `maxSeq` via
`getLatestThreadSequence` (`packages/db/src/data/events.ts`, indexed). Server-only;
no WS change. **Key includes `status`** (interrupt flips earlier rows),
`environmentId` (workspace root relativizes paths), and row-shape flags; `maxSeq`
alone is insufficient. Expanded active-turn windows (rows > 200) are intentionally
**not** cached — their `maxSeq` changes every event so they'd only thrash the LRU.
Eliminates warm-repeat and double-mount cost, and makes idle refetches free.
Implemented in `apps/server/src/services/threads/timeline-cache.ts` (+ unit test);
wired in `apps/server/src/routes/threads/data.ts`. (ETag/`304` deferred.)

### W4 (L) — Server-computed row-patch delta → RC1, RC2 (the streaming win) **[IMPLEMENTED — this PR]**

The big lever. Correct _by construction_ because the server still reprojects the
full bounded window (all eviction/collapse/finalize/backfill semantics
preserved), then **diffs**:

1. Add optional `afterSequence` to `threadTimelineQuerySchema`
   (`packages/server-contract/src/api/threads.ts:342`); thread through
   `parseThreadTimelinePage` → `buildThreadTimeline`.
2. Server reprojects the latest window, then returns
   `{ upsertRows, removedRowIds, windowSequenceStart, olderCursor, maxSeq }`.
   - `upsertRows` = rows whose `sourceSeqEnd >= afterSequence` ∪ any keyed
     bg-task/lifecycle/tool row touched by an event `seq > afterSequence` (even
     if its range is pinned below) ∪ rows flipped by finalize/interrupt.
   - `removedRowIds` = ids in the prior window's id set absent from the new
     projection (covers **turn-collapse** and **window eviction**).
     Computed by diffing the new projection against a small **per-thread last-sent
     window snapshot** (or recomputed conservatively from the union above).
3. Add `maxSeq` to the WS `changed` message (`threadChangeMetadataSchema`,
   `notifier`, hub publisher) so the client knows the new `N`.
4. Client applies replace-by-id + delete `removedRowIds` + re-sort by
   `sourceSeqStart`, then runs the existing merge against `windowSequenceStart`.
   **Falls back to a full window fetch** when `afterSequence` is omitted/stale.

Cuts streaming payload from ~950 KB to the few changed rows (target ≤ 8 KB/batch)
and makes the client re-render only changed rows. **Note:** W4 does _not_ reduce
the ~130–264 ms server projection CPU (the server still reprojects); W1 + W3
are what bound server CPU. Pair W4 with the §8 patch-diff-fidelity spike.

### W5 (M) — Truncate giant inline outputs/diffs → RC7 **[IMPLEMENTED — this PR]**

For `item/completed` outputs/diffs above a threshold, ship a truncated preview
with a "load full" affordance (the `turn-summary-details` endpoint already serves
on-demand detail). Targets the ≤1 MB outliers without touching typical rows.

**Out of scope (follow-up), see §13:**

- **List virtualization** (render only visible rows). The lever for huge-thread
  _initial-load render_ and per-commit deep-equal cost — **deferred at request.**
  Without it, W4 still cuts per-commit re-renders to the changed rows, but the
  first mount of a big window still mounts all rows.
- A resumable in-memory incremental _projector_ that reduces per-build CPU. The
  adversarial review rates it XL / high-risk against the finalize/interrupt batch
  machinery; revisit only if probes show server CPU still saturates after
  W1/W3/W4.

---

## 6. Correctness constraints (why W4 must diff a full reprojection)

All three adversarial skeptics independently **refuted** "fetch rows with
seq > N and append/replace." Concrete failure modes any delta scheme must handle
— all are handled by diffing a full reprojection, none by an event-tail:

- **Turn collapse:** on `turn/completed` (summary mode), N streamed message rows
  (`sourceSeqStart < N`) are **deleted** and replaced by one collapsed `:turn`
  row (`build-thread-timeline.ts:912`). Naive upsert-by-id leaves N stale
  duplicates → requires explicit `removedRowIds`.
- **In-place mutation of earlier rows:** tool/exec calls are upserted by `callId`
  (`tool-activity-projection.ts:502`); a late `item/completed` rewrites a row
  whose `sourceSeqStart ≪ N` (output, exit code, status). Streaming assistant
  text mutates one message object across deltas. A `seq > N` filter misses these
  → stale "running" rows.
- **Background tasks outliving their turn:** `item/backgroundTask/progress|completed`
  are thread-scoped and fold into a row with `sourceSeqEnd` **pinned** to the
  spawning turn's anchor (`background-task-projection.ts:78`). A range filter
  excludes them → task pinned "running" forever.
- **Finalize / interrupt:** flips pending→interrupted across **all** earlier
  messages (`event-projection-state.ts:259`, `tool-activity-projection.ts:832`).
- **Window eviction:** a 21st user turn slides the window lower bound; evicted
  rows must be removed from raw consumers (`SideChatTabContent`).
- **Append-text-fragment is wrong:** deltas get pruned and `item/completed`
  **replaces** the streamed text; concatenated fragments ≠ final text. Patches
  must be **whole-row** replace/insert/delete; the server stays the text source
  of truth.

W3's cache key has matching constraints: it **must** include `thread.status` and
the row-shape flags, not just `maxSeq`.

---

## 7. Probes (must pass with each change)

Each probe: method, baseline, target, pass/fail. Harnesses in §12.

### Probe A — Initial load (cold) → W5

- Method: dev-browser (`--connect`, React Profiler + `performance` via
  `page.evaluate`) loads the huge thread; measure first-rows paint, main-thread
  blocking, payload (curl). Flag threads whose window contains a >256 KB output.
- Baseline: 60 KB / 172 ms (idle); giant-output threads spike toward the ≤1 MB
  outliers.
- **Exit:** no cold-load regression (p50 within 10% of baseline) for
  typical/large/huge; with W5, window payload for giant-output threads ↓ and
  parse/first-paint improves correspondingly. (Huge-thread initial-load _render_
  remains bounded by the deferred virtualization — §13.)

### Probe B — Streaming payload + refetch volume → W4

- Method: replay a real big turn's events into a scratch DB at the measured
  cadence; for each `events-appended`, measure bytes the client receives (full
  window today vs W4 patch). Optionally drive the real client via dev-browser and
  count GETs.
- Baseline: up to ~950 KB re-sent per refetch (§3b), ~5×/s.
- Target: per-batch payload ≤ 8 KB (open-turn patch only), ≥ 85% reduction.
- **Exit:** streaming bytes/30 s for the huge thread ↓ ≥ 80% **AND** the rendered
  timeline is byte-identical to a full-refetch render (no stale/dup/missing rows).

### Probe C — Active-turn correctness + render churn → W4 (gate)

- Method: golden test. Replaying events one batch at a time, assert
  `applyPatch(prev, delta) == fullRebuild` row-for-row across fixtures including
  every §6 case (turn collapse, late tool completion, background task, interrupt,
  window eviction). Plus React Profiler committed-row count per batch.
- **Exit:** patch == full-rebuild for every fixture (a deliberately-broken diff
  must fail); median rendered-component count per streaming commit on the huge
  thread ↓ ≥ 70% with no visible stale tool/background-task rows.

### Probe D — Idle threads / herd → W1, W3

- Method: dev-browser opens a thread with side-chat tabs + background threads
  while another thread streams; count `/timeline` GETs on unfocused threads over
  30 s (instrument QueryCache / `realtime-cache-effects`). Plus warm-repeat
  latency on an idle thread.
- Baseline: every mounted timeline refetches per batch; warm repeat ~150 ms.
- **Exit:** hidden side-chat tabs issue **0** `/timeline` GETs during a 30 s
  main-thread stream (W1); warm-repeat p50 on an idle huge thread ↓ ≥ 90% via
  cache hit / 304 (W3); focusing a tab shows fresh data within one fetch.

---

## 8. Prototypes (throwaway spikes to de-risk before committing)

- **Spike 1 — patch-diff fidelity (keystone for W4):** in a branch, compute the
  row patch by diffing two full window reprojections (before/after a batch) and
  assert `applyPatch(prevRows, patch) == fullRebuild` across the §6 fixtures
  (turn collapse, late tool completion, background-task fold, interrupt, window
  eviction). If this holds, W4 is safe. **Do this before any client/protocol work.**
- **Spike 2 — visibility-gate herd:** flip hidden side-chat tabs to
  `enabled:false`; confirm Probe D (0 GETs) and that re-show refetches cleanly,
  and audit which live badges break.
- **Spike 3 — route cache:** add the W3 LRU keyed on the true inputs; measure
  warm-hit latency; verify invalidation on interrupt/prune via Probe C fixtures.

---

## 9. Sequencing

Each step is independently shippable and reversible.

1. Land the **probe harnesses** + Probe C golden-test infra (gates everything).
2. **W1** visibility-gate side-chat — **deferred** (data-loss coupling; §13).
3. **W2** drop turn-summary-details invalidation (S, no contract). **← done.**
4. **W3** server route cache (S–M, server-only) — kills warm-repeat / idle /
   double-mount. **← done.**
5. **W4** row-patch delta (`afterSequence` + diff; client merge) — the streaming
   payload win; golden test in place of the separate Spike 1. **← done.**
6. **W5** truncation of giant outputs. **← done.**

Implemented W2–W5 this PR (no WS-message change needed — the client carries
`maxSeq` from the response, so the delta works over the existing fetch path).
W1 remains, tracked in §13.

Drive-by fix in the same PR: removed a `staleTime: Infinity` on the live timeline
query (added by `cb78596611`) that silently defeated `refetchOnMount`, leaving a
revisited thread frozen on stale rows until the next live event. It also never
reduced streaming rerenders (those are invalidation-driven). The query now
inherits the app-wide 2s `staleTime`; safe to do now that a revisit/focus refetch
is a cheap delta (W4) or cached/no-op response (W3) rather than a full rebuild.

---

## 10. Before / after (concrete numbers)

All "before" numbers are measured (live server / in-process probe over
`/root/.bb/bb.db`). "After" numbers are measured where the mechanism is directly
simulable (streaming delta, warm cache), else the target the change must hit
(re-verify with the §7 probes during implementation). Representative threads:
**typical** 414 events, **large** 2,986, **huge** 12,206.

### Scenario 1 — Open an idle thread (initial load, cold)

|                              | typical         | large           | huge                                             |
| ---------------------------- | --------------- | --------------- | ------------------------------------------------ |
| **Before** payload / latency | 14.3 KB / 27 ms | 40.5 KB / 95 ms | 60.1 KB / 172 ms                                 |
| **After**                    | ≈ unchanged     | ≈ unchanged     | ≈ unchanged (W5 trims only giant-output threads) |

Cold first load is not the bottleneck and is left unchanged (the render lever,
virtualization, is deferred — §13). W5 reduces payload only for threads whose
window holds a >256 KB output (the ≤1 MB outliers).

### Scenario 2 — Revisit / second-mount an idle thread (warm) → W3

| huge thread, repeat fetch | before               | after                          |
| ------------------------- | -------------------- | ------------------------------ |
| server work               | full rebuild ~150 ms | cache hit ~1 ms (or `304`)     |
| bytes                     | 60 KB                | 0 (`304`) or served from cache |

Server CPU for redundant/idle refetches: **−~99%**.

### Scenario 3 — Streaming an active turn (the common, expensive case) → W4

Measured with the **shipped `computeTimelineRowDelta`** by reprojecting the huge
thread's 942-event turn as the active turn and diffing consecutive states (one
refetch per appended item, **415 refetches**):

| per refetch      | **before** (full window)           | **after** (W4 row-patch)                                        |
| ---------------- | ---------------------------------- | --------------------------------------------------------------- |
| bytes sent       | median **495 KB**, peak **889 KB** | median **16 KB**, p90 **26 KB**                                 |
| rows re-rendered | all ~350 (deep-equal every row)    | only changed rows (unchanged keep identity)                     |
| server build     | ~250 ms reproject                  | ~250 ms reproject (unchanged; W4 fixes payload+render, not CPU) |

| whole turn (cumulative wire) | before     | after                   |
| ---------------------------- | ---------- | ----------------------- |
| bytes transferred            | **214 MB** | **6.8 MB** (**−96.8%**) |

The delta's floor is the `rowOrder` id list (every current row id, so the client
can reorder exactly) — ~16 KB for a hundreds-of-rows active turn even when one
row changed. Still a 31× per-refetch reduction; sending order only when it
changes (follow-up) would push the median toward ~1 KB.

This is the headline: streaming one big turn currently re-ships ~214 MB of
mostly-unchanged rows; W4 cuts it to ~6.8 MB and shrinks each refetch from
hundreds of KB to **~16 KB median**. (W4 does **not** cut the ~250 ms per-build
server CPU — that needs the deferred projector, §13; W1/W3 reduce how often the
build runs.)

### Scenario 4 — Idle threads / herd while another thread streams → W1

|                                                                               | before                                                                        | after        |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------ |
| `/timeline` GETs from hidden side-chat tabs (main + child) over a 30 s stream | one full-window refetch per tab per batch (~150 refetches over 30 s × N tabs) | **0**        |
| concurrent full rebuilds triggered                                            | N mounted timelines × ~5/s                                                    | ~1 (focused) |

### Net effect by symptom

| reported symptom          | before                                   | after                                         |
| ------------------------- | ---------------------------------------- | --------------------------------------------- |
| large payload (streaming) | up to ~950 KB/refetch                    | ~16 KB median (W4); giant outputs capped (W5) |
| repeated refetches        | full rebuild + full window every batch   | delta patch; idle/warm served from cache      |
| thundering herd           | N mounted timelines × ~5 full rebuilds/s | ~1 focused timeline; hidden tabs silent       |

---

## 11. Overall exit criteria

- Streaming on the huge thread: bytes-on-wire ↓ ≥ 80% and per-commit rendered
  rows ↓ ≥ 70% (Probe B/C), with patch output **proven equal** to full rebuild
  across all §6 cases (Probe C). (Measured: ~214 MB → 6.8 MB per big turn;
  median refetch ~495 KB → ~16 KB.)
- Idle: hidden side-chat tabs issue 0 `/timeline` GETs while another thread
  streams; warm-repeat ↓ ≥ 90% (Probe D).
- Initial load: no cold-load regression; giant-output threads ship a smaller
  window via W5 (Probe A). (Faster huge-thread _render_ needs the deferred
  virtualization — §13.)
- No regressions in `@bb/thread-view` + timeline contract tests.

---

## 12. Validation (re-run these)

Representative threads / distribution:

```bash
sqlite3 "file:/root/.bb/bb.db?immutable=1" \
  "WITH c AS (SELECT thread_id, count(*) n, sum(length(data)) b FROM events GROUP BY thread_id) \
   SELECT thread_id,n,b FROM c ORDER BY n DESC LIMIT 5;"
```

Live-server payload + latency (idle window):

```bash
for id in thr_axgftfi23h thr_9ua98izdjf thr_kg5cffwyw2; do
  curl -s -o /dev/null -w "$id %{size_download}B %{time_total}s\n" \
    "http://127.0.0.1:38886/api/v1/threads/$id/timeline"; done
```

**Streaming payload (active turn expanded) — the key probe.** Copy the DB
(`cp /root/.bb/bb.db /tmp/scratch.db`; `sqlite3 /tmp/scratch.db "PRAGMA
wal_checkpoint(TRUNCATE);"`; never write the live DB). Truncate the huge thread
just before a big turn's `turn/completed` (and delete that `turn/completed`) so
the big turn is the active/latest turn, then build the latest window in-process
(`node --conditions=source --import tsx`, importing `createConnection`/`getThread`
from `@bb/db` and `buildThreadTimeline` from
`apps/server/src/services/threads/timeline.ts`) and compare JSON bytes vs the
collapsed (keep `turn/completed`) variant. Measured: 65 KB → **951 KB**.

**Row-patch delta (§10 Scenario 3 "after") — the key after-number.** Reproject
the active big turn at consecutive event prefixes (one item per step), diff rows
by stable id (changed/new row JSON bytes + removed ids) to get the per-refetch
patch size, and sum over the turn vs the per-refetch full-window bytes. Measured:
median patch **~16 KB** (vs full-window median 495 KB); cumulative **214 MB →
6.8 MB** over the turn. (`buildThreadTimelineFromEvents` with
`threadStatus: "active"` to keep the turn expanded.)

Build-cost attribution: same tsx approach timing each stage with
`performance.now()` (event query, `parseStoredEvent` decode,
`compactThreadTimelineSummaryEvents`, `buildThreadTimelineFromEvents`,
`JSON.stringify`).

Browser probes: `npm i -g dev-browser && dev-browser install`; `dev-browser
--connect`, `page.goto("http://<dev-frontend-url>/...")`, `page.evaluate(...)`
for React Profiler / `performance`, `page.screenshot()`. Get the dev frontend URL
from `pnpm dev` (don't assume ports).

Typecheck/test (AGENTS.md / Turbo):
`pnpm exec turbo run typecheck --filter=@bb/thread-view --filter=@bb/server --filter=@bb/app`
plus the thread-view + server-contract suites.

---

## 13. Out of scope / follow-ups

- **W1 — visibility-gate hidden side-chat timelines.** Deferred: gating couples to
  `deleteSideChatIfUnused` via `childHasUserMessage`, risking deletion of a
  side-chat with real content. Decouple that signal from the gated query (or get
  a product call), then gate. Lower priority now that W4 makes hidden-tab
  refetches cheap.
- **Leaner W4 delta.** The `rowOrder` id list is the ~16 KB/refetch floor. Send
  order only when membership/order changes (else just `upsertRows`) to push the
  median toward ~1 KB.
- **List virtualization** (render only visible rows) — deferred at request. The
  lever for huge-thread initial-load render and per-commit deep-equal cost. W4
  already cuts per-commit re-renders to the changed rows; without virtualization,
  the first mount of a big window still mounts all rows. Revisit if Probe A shows
  initial-load render is the bottleneck after W4/W5.
- Resumable in-memory incremental **projector** (cuts per-build CPU) — XL /
  high-risk per adversarial review; revisit only if server CPU still saturates
  after W1/W3/W4.
- Pushing timeline rows over the WebSocket instead of fetch-on-invalidate (larger
  protocol change; revisit if Probe B shows the round-trip dominates).
- Compressing event `data` at rest / on the wire.

---

_Delete this file once the work ships or is superseded (AGENTS.md planning workflow)._
