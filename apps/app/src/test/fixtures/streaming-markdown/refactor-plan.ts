export const refactorPlan = `Here is the plan for splitting the thread timeline out of the global app store. I read through the current store, the timeline hooks, and the server routes that feed them, and the change breaks down into five stages that can each ship and be reverted on their own.

## Goals

- Streaming a long assistant message should re-render only the message that is streaming, not every row in the thread.
- Opening a thread with a large history should fetch and render the visible window first and page older rows on demand.
- The timeline state for one thread should be disposable, so leaving a thread frees its rows instead of keeping them in a global map forever.

The non-goal is changing what the timeline shows. Every row, title, and grouping should look exactly the same before and after, and the snapshot tests are the guard for that.

## Where things are today

All thread rows live in one normalized map inside the global store, keyed by row id, and every timeline component subscribes to the whole map through a selector that filters by thread. When a streaming delta arrives, the reducer copies the map, the selector returns a new array for the thread, and every row component receives a new props object even when its own row did not change.

The server side is already close to what we need. The timeline route supports an after sequence cursor, and the older page cursor exists but is only used by the mobile client.

## Plan

1. **Introduce a per-thread timeline store behind a flag**
   1. Add \`ThreadTimelineStore\` with rows, an ordered id list, and a streaming text buffer per message.
   2. Create one store per open thread in a small registry that reference counts subscribers.
   3. Keep the global map as the source of truth for now and mirror writes into the new store, so both paths stay in sync while the flag is off.
      1. Mirror inserts and updates in the existing reducer.
      2. Mirror deletes only after the row has been removed from the global map, so a failed delete never leaves the stores disagreeing.
   4. Add a debug assertion that compares both stores after every write in development builds.
2. **Move the row components to per-row subscriptions**
   1. Replace the thread level selector with \`useTimelineRow(threadId, rowId)\`, which reads one row through \`useSyncExternalStore\`.
   2. Render the list from the ordered id list only, so the list component re-renders when ids change and not when row content changes.
   3. Keep the streaming message in its own buffer and subscribe to it from the message body only.
3. **Fetch the visible window first**
   1. Load the latest page with the existing after sequence cursor set to the last known sequence.
   2. Add an index so the older page query does not scan the whole thread.
   3. Page older rows when the user scrolls near the top, using the before anchor cursor.
4. **Flip the flag and remove the mirror**
   1. Enable the flag for internal users for one week.
   2. Watch the render counters and the timeline error logs.
   3. Remove the mirror writes and the global map once the counters look right.
5. **Dispose stores for closed threads**
   1. Release the store when the last subscriber unmounts and no stream is in flight.
   2. Keep a small LRU of recently closed stores so switching back and forth between two threads stays instant.

## Stage 1 details

The store is plain TypeScript with no framework dependency, which keeps it testable without rendering anything:

\`\`\`tsx
export class ThreadTimelineStore {
  private rows = new Map<string, TimelineRow>();
  private order: string[] = [];
  private listeners = new Set<() => void>();
  private rowListeners = new Map<string, Set<() => void>>();

  getOrder(): readonly string[] {
    return this.order;
  }

  getRow(rowId: string): TimelineRow | undefined {
    return this.rows.get(rowId);
  }

  upsert(row: TimelineRow): void {
    const existing = this.rows.get(row.id);
    this.rows.set(row.id, row);
    if (existing === undefined) {
      this.order = insertSorted(this.order, row.id, (id) => this.rows.get(id)!.sequence);
      this.emitList();
    }
    this.emitRow(row.id);
  }

  subscribeRow(rowId: string, listener: () => void): () => void {
    let listeners = this.rowListeners.get(rowId);
    if (listeners === undefined) {
      listeners = new Set();
      this.rowListeners.set(rowId, listeners);
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
}

export function useTimelineRow(threadId: string, rowId: string): TimelineRow | undefined {
  const store = useThreadTimelineStore(threadId);
  return useSyncExternalStore(
    (listener) => store.subscribeRow(rowId, listener),
    () => store.getRow(rowId),
  );
}
\`\`\`

The flag lives in the existing client config. It defaults to off everywhere and can be flipped per user from the admin panel:

\`\`\`json
{
  "flags": {
    "timelinePerThreadStore": {
      "default": false,
      "rollout": { "internal": true, "percentage": 0 },
      "owner": "timeline",
      "expires": "2025-06-30"
    }
  }
}
\`\`\`

## Stage 2 details

The list component stops receiving rows at all. It maps ids to row components, and each row reads its own data, so a change to one row never reaches its siblings:

\`\`\`tsx
export function ThreadTimelineList({ threadId }: { threadId: string }) {
  const store = useThreadTimelineStore(threadId);
  const order = useSyncExternalStore(
    (listener) => store.subscribeList(listener),
    () => store.getOrder(),
  );
  return (
    <ol className="flex flex-col gap-2">
      {order.map((rowId) => (
        <TimelineRowView key={rowId} threadId={threadId} rowId={rowId} />
      ))}
    </ol>
  );
}

const TimelineRowView = memo(function TimelineRowView({
  threadId,
  rowId,
}: {
  threadId: string;
  rowId: string;
}) {
  const row = useTimelineRow(threadId, rowId);
  if (row === undefined) {
    return null;
  }
  return row.kind === "message" ? <MessageRow row={row} /> : <WorkRow row={row} />;
});
\`\`\`

The streaming text buffer needs one more piece. A delta should update the message body without replacing the row object, because the row header, the avatar, and the action buttons do not depend on the text. The buffer keeps the text in a separate listener set, and only \`MessageBody\` subscribes to it.

There is a trap here that I hit in a prototype last month. If the snapshot function passed to \`useSyncExternalStore\` builds a new array or object on every call, React warns about an infinite loop and re-renders forever. The store must return the same \`order\` array until the ids actually change, which is why \`upsert\` only replaces it when a new id is inserted.

## Stage 3 details

The older page query currently filters by thread and orders by sequence without a matching index, so it degrades on threads with tens of thousands of events. The migration adds a composite index and leaves the old index in place until stage 4:

\`\`\`sql
CREATE INDEX IF NOT EXISTS events_thread_sequence_desc
  ON events (thread_id, sequence DESC);

EXPLAIN QUERY PLAN
SELECT id, sequence, type, data
FROM events
WHERE thread_id = ?1
  AND sequence < ?2
ORDER BY sequence DESC
LIMIT 200;
\`\`\`

The route change is small. It stops loading the full thread when a before anchor is present:

\`\`\`diff
 export async function loadTimelinePage(db: Database, request: TimelinePageRequest) {
-  const events = await loadAllThreadEvents(db, request.threadId);
-  const page = sliceBefore(events, request.beforeAnchorSeq, PAGE_SIZE);
+  const page = request.beforeAnchorSeq === null
+    ? await loadLatestEvents(db, request.threadId, PAGE_SIZE)
+    : await loadEventsBefore(db, request.threadId, request.beforeAnchorSeq, PAGE_SIZE);
   return buildTimelineRows(page);
 }
\`\`\`

To check the plan against a realistic database, copy the production snapshot locally and time the query before and after the index:

\`\`\`bash
cp ~/snapshots/threads-large.db /tmp/threads-large.db
sqlite3 /tmp/threads-large.db ".timer on" < scripts/older-page-query.sql
pnpm exec tsx scripts/apply-migration.ts /tmp/threads-large.db 0142_events_thread_sequence_desc
sqlite3 /tmp/threads-large.db ".timer on" < scripts/older-page-query.sql
\`\`\`

## Testing

1. **Unit tests for the store**
   1. Upserts keep the order sorted by sequence, including out of order arrivals.
   2. Row listeners fire only for the row that changed.
   3. Disposal clears every listener and the LRU evicts the oldest store first.
2. **Render counting tests**
   1. Streaming 200 deltas into one message renders the message body 200 times and every other row zero times.
   2. Inserting a new row renders the list once and the new row once.
3. **Snapshot tests**
   1. The existing timeline snapshots must pass unchanged with the flag on and with the flag off.

## Rollout and reverting

Each stage merges separately. Stages 1 and 2 are invisible while the flag is off, stage 3 is a backend change that is safe on its own, and stage 4 is the only one that changes behavior for users. If the counters or error logs look wrong during the internal week, turning the flag off restores the old path immediately, because the global map is still being written until the mirror is removed.

The one step that is awkward to revert is dropping the old index at the end of stage 4. I would leave it in place for a release cycle after the flag is removed, since the extra write cost is small.

## Risks

- The mirror doubles the write work while the flag is off. On a thread with a fast stream that is measurable but small, and it goes away in stage 4.
- Components outside the timeline read rows from the global map, mainly the thread sidebar preview and the search results. They need their own small selectors before the map can be removed.
- The LRU size is a guess. Five stores covers the common case of switching between a couple of threads, but it should be tuned from real usage data.

## Open questions

1. **Should the streaming buffer live in the store or in the websocket layer?**
   1. In the store it is easy to test and disposes with the thread.
   2. In the websocket layer it could coalesce deltas before they reach React, which would reduce renders further on slow devices.
   3. My preference is the store for now, with a coalescing step added later only if the render counters show it is needed.
2. **How should the registry handle two tabs showing the same thread?**
   1. Each tab has its own JavaScript heap, so they already have separate stores.
   2. The only shared state is the server cursor, and both tabs fetch independently, which is what happens today.

## Estimate

| Stage | Work | Estimate | Can ship alone |
| :-- | :-- | --: | :-- |
| 1 | Store, registry, mirror, dev assertion | 3 days | yes |
| 2 | Per-row subscriptions, list from ids | 2 days | yes |
| 3 | Index, route change, older paging | 2 days | yes |
| 4 | Internal rollout, remove mirror | 1 day plus one week of soak | yes |
| 5 | Disposal and LRU | 1 day | yes |

Let me know if you want me to start with stage 1, or if you would rather see the render counting test first so we have a baseline to compare against.
`;
