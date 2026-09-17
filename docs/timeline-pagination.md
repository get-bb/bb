# Timeline pagination

`GET /api/v1/threads/:id/timeline` and `sdk.threads.timeline` page conversation
groups. Copy both `timelinePage.olderCursor.anchorId` and `anchorSeq` to
`beforeAnchorId` and `beforeAnchorSeq`. Cursors are opaque; do not construct
row IDs or sequence cuts. Keep display options unchanged throughout the walk.

Conversation segments are a page-sizing preference, not a requirement on the
window edges. The selector reads a bounded list of request sequences from the
thread/type/sequence index. These are hints: it does not inspect request input,
resolve acceptance, or require the hinted event to produce a visible row. It
prefers hints within the event budget, or the nearest older hint for an
oversized conversation. Without a request hint it can cut at an ordinary event
sequence. The latest completed context clear is the history floor.

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
there. Older pages visit contiguous windows with decreasing cursors, so a
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
page omitted, and loaded rows are replaced. A row that keeps changing while
omitted, such as a long-running item before a content cut, therefore replaces
loaded rows on each refresh.
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
The new response fields are optional in the wire schemas so updated clients
can still read an older server; absence identifies that legacy contract.
Current servers always return the snapshot and detail continuation fields.
The snapshot is a read boundary, not a retained copy of the history. Pagination
continues on a best-effort basis when existing events are updated, deleted or
replaced. Previously loaded pages can then disagree with later pages, leaving
stale content, missing content or different grouping until history is reloaded.
If the event at the cursor anchor sequence was deleted, the server returns
HTTP 400 `invalid_request`; reload latest to restart, as on main. No history-edit
revision is stored or checked. Other edits do not automatically reject a cursor.

`timelinePage.contentPage`, when present, gives the group anchor and the
half-open leaf interval `[start, end)` within `total` leaves. Ancestor summaries
retain their full IDs, source bounds, counts, and status. Their child arrays
can contain only part of the group. Prepend older pages with
`prependOlderTimelineRows` from `@bb/client-core`: it joins turn children and
delegation children recursively by ID while preserving order. Do not flatten
responses by concatenation or replace an entire summary solely because its ID
was already seen. `bb thread log --all --format verbose` uses this merge.

Client merges retain summary objects when merging children leaves their row
references unchanged. Rows already shared with the loaded state, including
unchanged rows from a delta, bypass serialization for identity comparison.
Distinct objects still require content comparison: a loaded summary can contain
older children absent from the latest page. Child merging still deduplicates
rows even when both pages contain the same summary object.

The 4 MiB response target and event setting determine content-page boundaries
after grouping. At least one indivisible row is returned, even if it exceeds
the target. Complete-group queries and grouping work can exceed those budgets.
Profiles include context and ordering queries; endpoint timing also includes
serialization, response parsing, and client merging in the corpus benchmark.

The projector builds one structural row plan for both collapsed and expanded
rendering. A summary's identity, source bounds, timestamps, count, and message
membership are decided before its child rows are rendered. The detail endpoint
selects that planned summary first and materializes only its children; unrelated
summaries are not expanded to find a match. Collapsed rendering no longer needs
a separate message-pruning policy that anticipates the grouping rules.

Tool output and nested delegation projections are reconstructed while processing
the loaded events, including for collapsed summaries. The shared row plan avoids
rendering unrelated summaries' child rows when selecting an expansion, but it
does not defer event processing or output reconstruction.

Selection still reads and decodes event payloads for the required context. Cold
request cost remains dependent on that context; a large collapsed turn is not a
constant-time lookup. Route-cache hits and unchanged deltas are separate cases
and must be benchmarked separately from cold opens and appended updates.

`GET /api/v1/threads/:id/timeline/turn-summary-details` and
`sdk.threads.timelineTurnSummaryDetails` retain the existing `turnId`,
`sourceSeqStart`, and `sourceSeqEnd` inputs. A response can include an
`olderCursor`; pass it as `beforeCursor` with the same inputs until it is null.
These pages have their own `historySnapshot` and use the same recursive merge.
The app loads the detail walk when expanding a summary. Tool output remains
subject to the existing preview and retention rules.

Content pagination does not freeze completed turns, persist projections,
perform a backfill, add database tables or triggers, or run work on event
ingestion. Appended events are interpreted when a new snapshot is requested.
