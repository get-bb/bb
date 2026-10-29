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

## Deltas and pushes

Every full timeline response carries `tag`, a hash of the window's whole
content: rows, every top-level field, and `maxSeq`. Equal tags mean equal
windows, whatever thread status, settings, or request built them. A client that
holds a latest window sends `afterTag=<tag>` on its next read. When the server
still holds the window it served under that tag, it answers with a delta,
`{ maxSeq, tag, delta }`, built against exactly that window; otherwise it
answers with the full window. `delta` holds:

- `afterTag`: the tag of the window the delta applies to;
- `upsertRows`: rows that are new or whose content changed;
- `rowOrder`, only when membership or order changed: the new order as a list
  of row ids new to the window and `[start, length]` ranges of the base
  window's rows, by position;
- `fields`: the top-level fields whose value changed, with
  `contextWindowUsage: null` when usage is no longer reported.

The server keeps a served window while someone may diff against it: the latest
window for each request shape, every window a connected subscriber's tag names,
and each read's window for 30 seconds. A later read with that window's
`afterTag`, or the subscription sending its tag, releases the read's hold. It
keeps at most 16 threads within 32 MB of window JSON, dropping the least
recently used threads first, and never keeps a window over 8 MB. A dropped tag
only costs a full window.

`applyThreadTimelineDelta` from `@bb/server-contract` rebuilds the full window,
or returns `null` when the held window's tag differs from `afterTag` or the
delta does not fit its rows; the client then reads again with its own tag. The
client keeps optimistic rows after the server's rows, so ranges still address
the base window. `sdk.threads.timeline` returns a full window unless it is
given `afterTag`.

With the `timelinePush` experiment, the server pushes a full window or a delta
over the WebSocket after events are appended. A `subscribe` message tells the
server which window the client holds: `timelineTags` maps each
`thread-timeline` target key to the tag the client holds, or to `null` before
its first read returns. The tag is not part of the target, so updating it does
not start a new watch. Each `subscribe` carries the tag of the window in the
app's query cache, or `null` when the cache holds none. On a first open the app
subscribes with `null`, reads the window over HTTP, then sends the response's
tag; it resends its current tag whenever a read changes it. Returning to a
thread whose window is still cached, or resubscribing after a reconnect, sends
the cached window's tag, because the app may not read again: a cached window
newer than the query's stale time is not refetched on mount, and appended
events do not invalidate a pushed timeline. The server tracks the tag per
socket and moves it to each window it pushes there.

- A subscriber holding a tag gets a delta built against that tag's window, and
  receiving a tag schedules a push, so anything that changed after the client's
  read is delivered. A tag the server no longer holds gets the full window.
- A subscriber whose tag is `null` gets no push. Its read is built and recorded
  in one synchronous step, so a change either lands in that read or comes after
  it, and the tag that follows brings a delta for it.
- A subscription without `timelineTags`, from a client from before this
  protocol, gets the earlier behaviour: a delta against the window last pushed
  to that subscription or, for a new subscription, the window most recently
  served for the same request, which the client applies only if its tag
  matches `afterTag`.

Subscribers that hold the same window share one signal; each distinct baseline
gets its own. A client applies a delta only if its tag matches `afterTag` and
otherwise refetches with its own tag, which is usually a small HTTP delta. This
keeps clients exact when windows built while a thread was idle and while it was
active share a `maxSeq`. An older server ignores `timelineTags` and pushes as
before.

Pushes keep `afterSequence: null` so that a client from before tags treats a
pushed delta as unusable and refetches. That older client sends
`afterSequence`, which servers no longer read, so it receives full windows. A
client reading from a server from before tags treats untagged responses and
pushes as unusable and reads full windows.

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

## Browser scroll ownership

Each scroll root has one owner of the reading position: `ScrollPositionKeeper`.
The thread timeline (`BottomAnchoredScrollBody`) and every expanded detail
scroller (`useStickyBottomScroll`) create one. It is the only code that writes
`scrollTop` on its root, apart from the reader and explicit navigation it
performs for callers (reveal a row, jump to the bottom, scroll to the top).
Native CSS scroll anchoring is off on the root.

The reading position is explicit state: attached to the bottom, or a row key
with the distance from the top of the visible viewport to that row's top (or,
for a held element such as a collapsing message, its bottom). The visible
viewport ends at the sticky composer. The anchor is the first top-level row
that starts in the visible viewport, or a row nested in a row that covers the
whole viewport. The owner also records the other visible rows' offsets from the
anchor. If a merge replaces the anchor row's key, for example when an older page
regroups a turn, the first of those rows that is still mounted becomes the
anchor. The position changes only when:

- the reader scrolls;
- a caller navigates;
- the viewport gets narrower or wider and the anchor would leave the visible
  viewport, in which case the anchor moves just enough to stay on screen;
- the content really shrinks, so the browser clamps a correction, and the clamp
  is still there on the next frame;
- the view sits at the end while detached (see below).

A scroll counts as the reader's during an input session: a wheel, a scroll key,
Tab (focus moving to an offscreen control), a touch or pointer drag that
scrolled, and the momentum that follows (up to three seconds after the finger
lifts, on every platform). A touch ends on the
last touch pointer's `pointerup`, caught on the window in the capture phase,
or on `touchend`, whichever comes first. This means a tap on a control that
removes itself, such as the send button, still ends the touch. A drag counts
as scrolled only by the distance the reader moved. When the app scrolls to the
end, as a send does, the input session ends and the touch baseline is reset,
so the app's own jump is never counted as the reader's gesture. Any other
scroll that comes with a change in the scroll extent, or in the content's
height since the last ResizeObserver delivery, is layout, and the owner
reconciles it back to the position. A scroll without input or size change
never moves a view attached to the bottom, and never cancels a restore or
landing that is waiting for its row: the owner reconciles it back, the same as
layout. iOS WebKit moves the scroll position on its own, for example when
inline elements are re-inserted, and these scrolls cannot be told apart from
intended ones. A detached view follows such a scroll as navigation, such as
find in page. While the desktop window find bar is open, from the
`bb:window-find-open` event until the window regains focus, an attached view
follows it too, so find works from the bottom. Browser find on the web gets no
such signal, so from the bottom it is pulled back.

The thread timeline holds a floor under its scroll extent. The first child of
its scroll content is a spacer whose height equals the content's height at the
last ResizeObserver delivery, cancelled by an equal negative bottom margin, so
it takes no space but keeps the scroll extent from dropping below that height.
Content that collapses and regrows within one task, such as the composer
footer or a row remounting while something forces a layout, therefore never
lowers the extent, and the browser has nothing to clamp. Without the floor that
clamp arrives as a scroll with no input and no size change once the content has
regrown, which a detached reader near the end would follow as navigation. A
shrink that lasts reaches the ResizeObserver, which lowers the floor before
reconciling. Tool output boxes have no floor.

Attachment follows one rule: a detached view within 4 px of the end attaches,
whatever put it there, unless a restore or landing is still waiting for its row.
When the reader's scroll, a navigation, or a completed restore put it there, it
attaches at once. When only layout did, such as a row collapsing near the end
or the viewport growing, it attaches if the view is still at the end on the
next frame, so content that shrinks and regrows within a frame does not attach.
Moving up out of the end detaches. Content changes never detach. A view the
reader never placed, such as a tool output box that was not streaming when it
opened, attaches only when the reader or a navigation brings it to the end, so
output that loads in after it opens does not pull it down.

`scroll-position-keeper.model.test.ts` checks these rules over random sequences
of reader scrolls, touch gestures, toggles, streaming, prepends, regroups,
transient shrinks, resizes, navigations, and restores, with and without iOS
write deferral: attached exactly when at the end, content changes never detach,
the reading row never moves without the reader unless the content cannot hold
it, and a reader's scroll is never moved. It runs 200 sequences by default; set
`KEEPER_MODEL_SEEDS` for a deeper local run.

Every layout change is reconciled before paint. Triggers are ResizeObservers on
the root, its content, and every mounted row, plus each windowed list's layout
effect after a commit. Within one reconciliation:

1. A scroll the owner did not make is folded into the position before the
   layout is read, even when its scroll event has not arrived yet. During an
   input session it is the reader's movement: changes that landed in the same
   forced layout are reconciled against the moved position, and only if the
   anchor has left the viewport does the owner pick a new anchor where the
   reader now is. Outside one, a view that follows navigation (see above)
   takes its position from where the scroll left it, so a re-render between
   find in page and its scroll event does not undo the jump. A clamp onto the
   end of shrunken content is layout, not navigation.
2. Windowed lists render the rows around a row key, never around a raw
   `scrollTop`. A prepend keeps the same rows mounted, and the owner's anchor
   row is always mounted.
3. The owner reads the anchor's position and computes the target `scrollTop`
   from the fixed position. It is never a relative delta, so a clamped
   intermediate write is not counted twice.
4. It writes the target, clamped to the scroll extent. Attached means the
   maximum.
5. Lists check that the visible range is mounted. If the viewport would show a
   spacer, they render the rows synchronously before paint. The check uses the
   heights the spacers were rendered with and the measured heights of mounted
   rows, so it describes what is on screen, not newer measurements the spacers
   have not used yet.

When the viewport lands on a spacer, the owner can only record which row the
list estimates is there. That estimate never moves the view: once real rows
mount, the owner takes its position from them.

Lists of 20 or more items are windowed everywhere except iOS WebKit (Safari and
the mobile app's WKWebView), where every row stays mounted. Every row also
mounts while the scroll root has no height, for example in a hidden pane, and
windowing resumes once it has one, with spacers sized from the heights measured
meanwhile, so the scroll extent stays exact. Rows stay in normal flow between spacers whose
heights come from the measurements the thread retains, so rows never overlap
and a row resize needs no positioning pass. The thread retains the 2,000 most
recent measurements; a spacer keeps the height it last rendered for a row whose
measurement was dropped. Only rows that have never mounted use an estimate. When such a row mounts above the reader, its real height
changes the content above, and step 3 corrects it. Visible rows, eight rows of
overscan on each side, search and navigation targets, the last row, and the 24
most recently interacted rows stay mounted. Within two viewport heights of the
top of the list, every row above the viewport is mounted, so estimates are
corrected while there is still room to scroll. Expanded detail lists use their own
scroll roots and the same list.

iOS WebKit overrides a scroll write made while a finger is down, during
momentum, or during an edge bounce. On iOS the owner applies the correction as a
transform on the scroll content during those phases, so rows stay in place
visually. Once the touch has
ended and the scroll position has been still for 150 ms, it writes the
correction to `scrollTop` and removes the transform in the same task. Other
browsers write immediately.

Older pages load when the "load older" sentinel above the list comes within
600 px of the viewport. The check runs after every position change the owner
reports, scrolls and reconciliations alike, rather than on intersection
changes, so a reader who returns to the top after a prepend always loads the
next page.

A thread's position is saved when the reader scrolls and when the timeline
unmounts. Saving on unmount first takes in a scroll the reader made whose scroll
event has not arrived yet; a layout change alone keeps an attached reader at the
end. A reader who is at the end is saved as at the bottom, attached or not.
Returning to the thread mounts the saved row's window and restores
the row at its saved offset, kept on screen if the viewport is now shorter. If
the row has not loaded yet, the timeline waits
at the bottom for up to a second. The timeline keeps the loaded pages of the
eight most recent threads for each query client, so a position in older history
survives a thread switch.

Opening an unread thread decides its landing once, from the first copy of the
thread fetched after it opens, not a cached one, and the rows loaded at that
moment. Automatic read tracking waits for that opening snapshot, so sidebar
placeholder data cannot mark the thread read before its unread cutoff is saved.
If the read cutoff falls inside the loaded rows, the NEW divider is
placed and the owner lands on it through the restore path, with the divider as
the anchor at the top of the viewport, so rows that render or resize around it
afterwards do not move it. Otherwise, and for a thread marked unread, there is
no divider and the saved position or the bottom stands. No older pages are
loaded to find the cutoff, and a divider dropped this way stays dropped when
the reader pages back. A reader who scrolls before the landing keeps their
position.

`thread-opening.model.test.tsx` checks the landing end to end. It renders the
timeline with the thread view's own loading and automatic read-tracking hooks,
including cached sidebar placeholders, against a fake server that
pages a random history, opens or returns to the thread with random read
states, page sizes, and time away, and resolves the bootstrap, thread, and
timeline requests in random orders, sometimes with the reader scrolling while
they load. Once settled, NEW must sit above the first unread row of the whole
history, must be at the top unless the reader scrolled or the view is at the
end, and must show whenever the read cutoff is inside the first page;
otherwise the saved position or the bottom stands. It runs 40 sequences by
default; set `OPENING_MODEL_SEEDS` for more.

Content shorter than the viewport is top-aligned. In that case a row that
expands moves the rows below it, including the latest row.
