export const apiDesign = `Here is the design for the cursor paginated thread timeline API. It replaces the offset parameters on the current endpoint, keeps the existing response shape for the latest page, and adds explicit cursors for older pages so clients stop refetching the whole thread when they scroll up.

## Context

The current endpoint is defined in \`apps/server/src/routes/threads/data.ts:348\` and returns every timeline row for a thread in one response. The web client only needs the last screen of rows on open, but the route builds and serializes the full timeline, which takes over a second on threads with 150 turns and produces responses above 4 MB.

The route already accepts \`afterSequence\` so live clients can fetch rows that arrived after their last known sequence. That part works well and stays. What is missing is a cheap way to ask for the rows before a known point.

## Goals

- Opening a thread fetches a bounded latest page, independent of thread length.
- Scrolling up fetches older pages with a stable cursor that does not shift when new events arrive.
- Live updates keep using the after sequence cursor with no change for existing clients.
- Responses stay cacheable at the edge for pages that can no longer change.

## Non-goals

- Changing how rows are built. The projection in \`packages/thread-view/src/build-thread-timeline.ts:1354\` stays the single source of row construction.
- Server push of rows. Live delivery keeps its current path through the websocket invalidation plus a fetch.

## Endpoint

\`\`\`http
GET /api/v1/threads/{threadId}/timeline?limit=200&beforeAnchorSeq=48211
Accept: application/json
\`\`\`

The endpoint has three modes, chosen by which cursor is present:

1. No cursor returns the latest page, ending at the newest row.
2. \`afterSequence\` returns rows whose source sequence is greater than the cursor, used for live updates.
3. \`beforeAnchorSeq\` returns the page of rows that ends just before the row anchored at that sequence, used for scrolling up.

Passing both cursors is a validation error. A client that wants a window in the middle of a thread asks for the page before an anchor and then pages forward with the after cursor.

## Parameters and response fields

| Name | In | Type | Required | Default | Notes |
| :-- | :-- | :-- | :-- | :-- | :-- |
| \`threadId\` | path | string | yes | | Thread id, \`thr_\` prefix |
| \`limit\` | query | integer | no | 200 | Maximum rows, 1 to 500 |
| \`afterSequence\` | query | integer | no | | Exclusive lower bound on source sequence |
| \`beforeAnchorSeq\` | query | integer | no | | Anchor sequence for an older page |
| \`includeNested\` | query | boolean | no | false | Include rows nested under work summaries |
| \`detail\` | query | enum | no | \`summary\` | \`summary\` or \`full\` message detail |
| \`rows\` | body | array | yes | | Timeline rows in display order |
| \`rows[].id\` | body | string | yes | | Stable row id |
| \`rows[].kind\` | body | enum | yes | | \`message\`, \`work\`, \`turn\`, \`system\` |
| \`rows[].sourceSeqStart\` | body | integer | yes | | First event sequence the row covers |
| \`rows[].sourceSeqEnd\` | body | integer | yes | | Last event sequence the row covers |
| \`rows[].createdAt\` | body | integer | yes | | Epoch milliseconds |
| \`rows[].status\` | body | enum | no | | \`pending\`, \`completed\`, \`failed\`, \`interrupted\` |
| \`maxSequence\` | body | integer | yes | | Highest event sequence in the thread |
| \`pageStartSeq\` | body | integer | yes | | Lowest source sequence in this page |
| \`pageEndSeq\` | body | integer | yes | | Highest source sequence in this page |
| \`hasOlder\` | body | boolean | yes | | Whether older rows exist before this page |
| \`olderAnchorSeq\` | body | integer | no | | Cursor to pass as \`beforeAnchorSeq\` for the next older page |
| \`activeThinking\` | body | object | no | | Present on the latest page only |
| \`activeWorkflows\` | body | array | yes | \`[]\` | Present on the latest page only |
| \`contextWindowUsage\` | body | object | no | | Present on the latest page only |
| \`goal\` | body | object | no | | Present on the latest page only |
| \`pendingTodos\` | body | object | no | | Present on the latest page only |
| \`etag\` | header | string | yes | | Weak validator derived from \`pageEndSeq\` and the projection version |
| \`cache-control\` | header | string | yes | | \`no-store\` for latest pages, \`private, max-age=300\` for older pages |

The latest page carries the thread level fields that only make sense at the end of the thread. Older pages leave them out, which keeps those pages immutable and safe to cache.

## Anchors instead of offsets

A cursor has to name a point that does not move. Offsets move whenever rows are inserted, and row ids are not ordered. Source sequences are ordered and permanent, but a single row can cover many events, so the cursor is the start sequence of the first row on the current page. The server finds that row, walks back \`limit\` rows, and returns them.

The anchor has one subtle case. A work summary row can grow while a turn is still running, and its start sequence stays the same while its end sequence grows. Because the anchor is the start sequence, an older page never overlaps the row the client already has, even when that row changes after the page was fetched.

## Response example

\`\`\`json
{
  "rows": [
    {
      "id": "row_turn_7f2c",
      "kind": "turn",
      "sourceSeqStart": 47988,
      "sourceSeqEnd": 48002,
      "createdAt": 1741099322114,
      "status": "completed"
    },
    {
      "id": "row_msg_91ab",
      "kind": "message",
      "sourceSeqStart": 48003,
      "sourceSeqEnd": 48210,
      "createdAt": 1741099325870
    }
  ],
  "maxSequence": 52177,
  "pageStartSeq": 47988,
  "pageEndSeq": 48210,
  "hasOlder": true,
  "olderAnchorSeq": 47988
}
\`\`\`

## Errors

Errors use the problem details format from [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457), which the rest of the v1 API already follows through \`apps/server/src/http/problem.ts:22\`.

| Status | Type | When |
| --: | :-- | :-- |
| 400 | \`invalid-cursor\` | Both cursors present, or a cursor is negative |
| 400 | \`invalid-limit\` | Limit outside 1 to 500 |
| 404 | \`thread-not-found\` | Thread does not exist or is deleted |
| 409 | \`anchor-not-found\` | The anchor sequence does not start a row, for example after a rewind |
| 412 | \`projection-changed\` | The \`if-match\` etag was built by an older projection version |

The \`anchor-not-found\` case matters for rewinds. When a user edits an earlier message, events after that point are marked as superseded and the rows that started there disappear. A client holding an anchor from before the rewind gets a 409 and refetches the latest page, which is the same recovery it already performs when the websocket reports a rewind.

## Where the code goes

- Route and validation: \`apps/server/src/routes/threads/data.ts:348\`, next to the existing handler, with the query schema moved into \`packages/server-contract/src/threads/timeline.ts:40\`.
- Page loading: a new \`loadTimelinePage\` in \`apps/server/src/services/threads/timeline.ts:118\` that reads a bounded window of events.
- Index: a migration in \`packages/db/drizzle\` adding a descending index on thread id and sequence.
- Client: \`apps/app/src/views/thread-detail/use-thread-timeline.ts:73\` switches from one fetch to a paged loader that keeps pages in order.
- SDK: \`packages/sdk/src/threads.ts:211\` gains \`timeline.page()\` so the CLI and plugins can page the same way.

## Caching

Older pages are immutable except for rewinds, and a rewind changes the projection version stamped into the etag, so they can be cached privately for five minutes. The latest page is never cached, because new events can arrive at any moment and the client already polls it with the after sequence cursor.

The server also keeps a small in-memory cache of built pages keyed by thread, anchor, limit, and projection version. The cache is bounded by total response bytes rather than entry count, since page sizes vary by two orders of magnitude between short and long messages.

## Compatibility

Clients that send no cursor get the latest page instead of the full thread. That is a behavior change for any client that relied on receiving everything. The web and mobile clients both handle paging already, and the CLI command that exports a thread will switch to \`timeline.page()\` and loop until \`hasOlder\` is false.

To give third party scripts a transition window, the route accepts \`limit=all\` for one release and logs a deprecation warning with the caller user agent. After that release the parameter is rejected with \`invalid-limit\`.

## Alternatives considered

**Offset pagination.** Simple to implement, but offsets shift when rows are inserted, and a client scrolling up while a stream is running would see duplicated or skipped rows.

**Row id cursors.** Row ids are stable, but finding the position of an id requires building the timeline up to that row, which is the cost we are trying to remove.

**Timestamp cursors.** Several events can share a millisecond, and imported threads have clock skew between hosts. Sequences have neither problem.

**Streaming the full timeline.** Chunked responses would improve time to first byte, but the client would still parse and hold the whole thread, and the server would still build every row.

## Rollout

The server change ships first, gated by the presence of a cursor so existing clients see no difference. The web client switches to paging behind a flag, then mobile, then the CLI. Once all first party clients are paging, the no cursor behavior changes from the full thread to the latest page.

## References

- [RFC 9457: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457)
- [Slack API pagination guide](https://api.slack.com/docs/pagination)
- [Use the Index, Luke: paging through results](https://use-the-index-luke.com/no-offset)
- The timeline projection overview in \`docs/thread-timeline.md\`

If this direction looks right, the first pull request would be the migration plus the page loader with tests, since both are invisible to clients until the route starts using them.
`;
