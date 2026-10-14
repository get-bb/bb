# Timeline pagination

`GET /api/v1/threads/:id/timeline` and `sdk.threads.timeline` page conversation
groups. Copy both `timelinePage.olderCursor.anchorId` and `anchorSeq` to
`beforeAnchorId` and `beforeAnchorSeq`. Cursors are opaque; do not construct
row IDs or sequence cuts. Keep display options unchanged throughout the walk.

Conversation segments are a page-sizing preference, not a requirement on the
window edges: a page can start at an ordinary event sequence. The latest
completed context clear is the history floor unless the
`keepHistoryAfterContextClear` general setting is on; then pages continue
across it to the start of the thread.

A page owns an event window `[start, end)`. It returns projected rows whose
`sourceSeqStart` falls inside that window, in display order. Context loaded
outside the window helps render those rows but does not change ownership. Each
response returns a row identity once, including when repeated lifecycle events
produce the same projected row more than once.
Visible user rows, including accepted steers, define conversation segments
inside the window; the leading segment can be partial. Hidden and empty
requests do not count as visible segments. The response takes up to
`segmentLimit` segments, subject to the leaf and byte budgets. When it omits
older segments, their raw sequence range belongs to the next page.

The cursor records the exact window start, even when no visible row starts
there. A window start of zero represents the history epoch and is valid in both
response metadata and the next request; a content continuation can remain at
that window start while advancing through the oldest group. Older pages visit contiguous windows with decreasing cursors, so a
request and its acceptance can fall on different pages without losing their
rendered row. Empty windows still advance the cursor. Each build skips up to
eight empty windows looking for visible content; if more remain, it returns an
empty page with a usable older cursor. Latest-page head state is retained while
skipping. Context loading and complete-group reconstruction can exceed the
initial event budget.

Content cuts continue inside the same window bounds, reconstructing the same
group so leaf offsets remain meaningful. The current cursor format is v3;
previous versions return the existing 400 reload response because their group
boundaries and leaf offsets can differ. Older history is only advertised with
a cursor, including when an edge contains no visible rows.

Display order is turn-by-turn until a user message lands inside another turn:
after that message everything is ordered by source sequence. A turn spans from
its first event or accepted request to its `turn/completed` event, or stays
open while it is running; events that arrive after completion, such as a
background command finishing, do not extend it. The projection applies this
rule to the events it loaded, and the server evaluates the same rule over the
whole thread so a budgeted page orders rows the way the full history does.

`timelinePage.historySnapshot` identifies the history tip, grouping version,
and display surface. A walk excludes subsequent appends. Earlier events can
change grouping even after a turn completed. `timelinePage.olderRowsSourceSeqEnd`
is the greatest `sourceSeqEnd` among rows the snapshot projected before the
page's returned rows but did not return: older conversation groups, and the
leaves a content cut omitted from the page's oldest group. It is `null` when the
snapshot projected no such rows. When a new latest snapshot's window reaches
the loaded tip and this value does not exceed it, `mergeLoadedTimelineWithLatest`
keeps loaded older pages and replaces the rows the latest page covers, so
streaming does not unload history. Otherwise a later event changed a row the
page omitted, and loaded rows are replaced.

The merge applies one rule whether or not the snapshot changed. A loaded row
the latest page returns is replaced by it. A loaded row it does not return is
kept only when it is older than the page: it ends before the window start, ends
at or before `olderRowsSourceSeqEnd`, or arrives in `olderRowUpdates`. Any other
loaded row is gone from the window, for example a running turn's rows that the
completed turn folded into its summary; the merge drops it and the walk
restarts from the latest page's cursor. When nothing is dropped the deeper of
the loaded and latest cursors is kept. After a stale-cursor 400,
`recoverLoadedTimelineAfterStaleCursor` reloads from the latest page when the
snapshot changed, and otherwise merges and takes the latest cursor.

`apps/server/test/public/public-thread-timeline-scrollback.test.ts` pins this
by running the client merges over real pages and comparing them with a fresh
walk. The Ladle story `thread/timeline/Scrollback` with
`apps/app/.ladle/tests/timeline-scrollback.mjs` (run with dev-browser against
the open story) checks that the scrolled-back row stays put while the latest
window changes and that a full walk shows every row once, in order.

A latest page sends omitted rows whose `sourceSeqEnd` reaches its window start
in `timelinePage.olderRowUpdates` instead of in `olderRowsSourceSeqEnd`, such as
a running background delegation that started on an older page. Each update
keeps only the nested children that reach the window start.
`mergeLoadedTimelineWithLatest` joins each update into the loaded row with the
same id and ignores rows it has not loaded, including on repeat refreshes of
the same snapshot. Updates share the page byte budget
with the returned rows. Updates that do not fit the remaining budget, and leaves
omitted by a content cut, still count toward `olderRowsSourceSeqEnd`.

`summaryOnly=true` returns head state without timeline rows or older-row updates.

`completedTurnDisplay` reports whether the page projected finished turns as
collapsed "Worked for" rows or flat rows. It is part of the display surface: a
cursor from one display returns HTTP 400 under the other, and
`resolveLoadedTimelineSurfaceKey` folds it into the loaded surface key, so a
client whose pages were loaded under another display replaces them from the
latest page instead of mixing the two.
Discard older responses whose request cursor is no longer the loaded
`olderCursor`. Cursors identify sequence windows, not message rows. A legacy
cursor or incompatible
grouping version returns HTTP 400 `invalid_request` with a
message that the cursor is no longer available. Reload latest to restart.
The snapshot is a read boundary, not a retained copy of the history. Pagination
continues on a best-effort basis when existing events are updated, deleted or
replaced. Previously loaded pages can then disagree with later pages, leaving
stale content, missing content or different grouping until history is reloaded.
If the event at the cursor anchor sequence was deleted, the server returns
HTTP 400 `invalid_request`; reload latest to restart. No history-edit
revision is stored or checked. Other edits do not automatically reject a cursor.

A content cut can return only part of a group. Ancestor summaries retain their
full IDs, source bounds, counts, and status; their child arrays can contain only
part of the group. Prepend older pages with
`prependOlderTimelineRows` from `@bb/client-core`: it joins turn children and
delegation children recursively by ID while preserving order. Do not flatten
responses by concatenation or replace an entire summary solely because its ID
was already seen. `bb thread log --all --format verbose` uses this merge.

The 4 MiB response target and event setting determine content-page boundaries
after grouping. At least one indivisible row is returned, even if it exceeds
the target. Complete-group queries and grouping work can exceed those budgets.

Latest plan/todo and goal snapshots are head state, returned even when they
fall outside the selected rows; they do not widen the page. The client merge
guard describes omitted conversation rows, not head-state rows.

`GET /api/v1/threads/:id/timeline/turn-summary-details` and
`sdk.threads.timelineTurnSummaryDetails` retain the existing `turnId`,
`sourceSeqStart`, and `sourceSeqEnd` inputs. A response can include an
`olderCursor`; pass it as `beforeCursor` with the same inputs to read the next
older page. These pages have their own `historySnapshot` and use the same
recursive merge. A page holds at most 200 leaves and targets 1 MiB. The app
loads the newest page when a summary is expanded and requests older pages only
when the user asks for earlier activity.

Without `itemId`, the response covers the whole turn and command and tool
output longer than 4,000 characters is previewed. With `itemId`, pass the range
of the row that carries that item: its `callId`, or `reasoningId` for a
reasoning row. The response contains only the rows for that item, at the top
level, with their full content subject to the retention rules. For a
delegation it returns that delegation and its children, paged by the same
cursor, with previews below it. The server widens the range to the item's own
lifecycle events, so a row whose range starts after its item started still
resolves. An item the range does not contain returns HTTP 400
`invalid_request`.

## Deferred content

`deferContent=true` on the timeline and on `turn-summary-details` leaves out
content that is only visible when a settled row is expanded. Without it,
responses keep every row's content inline, as `bb thread log` and SDK callers
expect. With it:

- a delegation that is no longer pending and has children returns
  `childRows: null`; an empty array still means it has no children;
- a settled command whose command text and output exceed 1,000 characters
  together returns an empty `output`, no `outputPreview`, and only the first
  300 characters of `command`; activity intents still describe the whole
  command;
- a settled tool row whose output exceeds 1,000 characters returns an empty
  `output` and no `outputPreview`;
- a settled file change whose diff, stdout and stderr exceed 1,000 characters
  together returns a null diff, stdout and stderr, keeping `diffStats`;
- a settled reasoning row whose text exceeds 1,000 characters returns a null
  `detail`.

Each deferred row other than a delegation carries `contentDeferred: true`.
Load the content with `turn-summary-details` using the row's `turnId`,
`sourceSeqStart`, `sourceSeqEnd`, and `itemId`. Pending rows keep their
content so the live frontier can stream and auto-expand; settled rows nested
in them are still deferred. Rows without a turn are never deferred. The app
sends `deferContent=true` on every timeline and detail request; cursors are
bound to the setting, so keep it unchanged throughout a walk.

The server shapes projected rows in two walks of the row tree. Before
pagination, one walk attaches retained-output availability and, with
`deferContent=true`, defers settled content, so page byte budgets count the
deferred rows. After pagination, one walk caps inline output at 32,000
characters and, for responses without nested rows, replaces outputs over 4,000
characters with a head-and-tail preview. Turn summary details apply all three
in one walk before their content pagination.

## Conversation outline caching

The conversation outline returns the full list of message previews;
`role=user` or `role=assistant` returns only that role's items, sharing one
cache. The app requests user items while the table of contents is visible and
assistant items only while its Agent messages tab is open. Active
threads reuse completed outline items from a bounded in-memory cache (16 threads,
8 million characters) and reproject only the tail; history rewrites, context
clears, metadata or display changes, and writes from another database connection
force a rebuild. Eviction only affects performance.

## Catch-up feedback

Event-append notifications carry `metadata.timelineSequence`, the thread's
stored event sequence after the write; coalescing and debouncing keep the
highest. The client shows catch-up feedback only when that sequence is newer
than the cached response's `maxSeq`, so cache-age refreshes and notifications
the cache already covers do not show it. A response clears only sequences
through its own `maxSeq`. The indicator appears after the timeline has stayed
behind for one second, disappears as soon as the cache catches up, and renders
as a row at the end of the timeline.
