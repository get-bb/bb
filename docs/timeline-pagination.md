# Timeline pagination

`GET /api/v1/threads/:id/timeline` and `sdk.threads.timeline` page conversation
groups. Copy both `timelinePage.olderCursor.anchorId` and `anchorSeq` to
`beforeAnchorId` and `beforeAnchorSeq`. Cursors are opaque; do not construct
row IDs or sequence cuts. Keep display options unchanged throughout the walk.

`timelinePage.historySnapshot` identifies the history tip, grouping version,
and display surface. A walk excludes subsequent appends. Earlier events can
change grouping even after a turn completed, so a new latest snapshot replaces
loaded rows instead of retaining an assumed immutable prefix. Discard older
responses whose snapshot no longer matches. A legacy cursor or incompatible
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

The 4 MiB response target and event setting determine content-page boundaries
after grouping. At least one indivisible row is returned, even if it exceeds
the target. Complete-group queries and grouping work can exceed those budgets.
Profiles include context and ordering queries; endpoint timing also includes
serialization, response parsing, and client merging in the corpus benchmark.

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
