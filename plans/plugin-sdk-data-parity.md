# Plugin SDK data access parity investigation

Investigated 2026-09-28 against this checkout. Source inspection, not a runtime performance benchmark. This is a proposed work list, not a new API contract; public API documentation belongs in the Plugin Guide.

Core mostly uses the same SDK as plugins. The largest difference is the app-owned query/cache/realtime layer above that SDK. There are also specific missing SDK wrappers and limitations shared by core and plugins.

## Current architecture

- Core creates `createBrowserBbSdk` in [sdk.ts](../apps/app/src/lib/sdk.ts). Its query hooks generally call this client. A source scan found 56 non-test files importing `@/lib/sdk`.
- Plugin `useSdk()` returns a wrapper around that same client, adding attribution, plugin metadata defaults, and selected optimistic writes. Reads retain the same implementation. See [plugin-sdk-hooks.ts](../apps/app/src/lib/plugin-sdk-hooks.ts) and [plugin-bound-sdk.ts](../apps/app/src/lib/plugin-bound-sdk.ts).
- Backend `bb.sdk` exposes the public SDK with plugin-bound thread methods: [PluginBbSdk](../packages/plugin-sdk/src/backend-contract.ts).
- Core adds TanStack Query hooks, shared query keys, cached subset selection, realtime patching, throttled invalidation, and reconnect reconciliation. See [thread-queries.ts](../apps/app/src/hooks/queries/thread-queries.ts), [realtime-cache-effects.ts](../apps/app/src/hooks/realtime-cache-effects.ts), and [realtime-cache-registry.ts](../apps/app/src/hooks/cache-owners/realtime-cache-registry.ts).
- Plugins receive some of that integration through `experimental_useSidebarThreads`, provider catalog hooks, sidebar actions, and host components. There is no general equivalent of core's thread/project/environment query hooks in [PluginSdkApp](../packages/plugin-sdk/src/app-contract.ts).

## Capability comparison

| Area                      | Available today                                                                                                                                              | Gap and implication                                                                                                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Thread filtering          | `threads.list` supports project, environment, host, parent/source thread, section/unsectioned, archive, parentage, origin kind/plugin, and hidden inclusion. | The SDK covers the list route's filters. Both lack status/provider filters, caller-selected ordering, metadata predicates, and composition with text search. Some plugin screens therefore need client-side filtering.                                     |
| Thread pagination         | Both use `limit`/`offset`; core archives use `useInfiniteQuery`.                                                                                             | List responses are arrays, without a cursor or page envelope. Core infers another page from page length. Plugins must recreate that state machine. Offset pagination can skip/repeat rows when the collection changes; this is a shared design limitation. |
| Counts                    | `threads.count` runs a server aggregate, including grouping by host/provider/project.                                                                        | The route accepts `includeArchived` and `includeHidden`; `ThreadCountArgs` and `countQuery` omit both. List/count filter sets also differ, so counts cannot represent every list predicate.                                                                |
| Search                    | `threads.search({ query, limitPerGroup })` uses server search.                                                                                               | It returns bounded active/archive groups, without project/host/section filter composition or continuation. It is a search picker API rather than a general paginated query.                                                                                |
| Shared reads              | `experimental_useSidebarThreads` shares the host's cache and archive query.                                                                                  | Options select active/archive lifecycles only. Active data is the full collection; there is no query predicate or selector argument. Custom screens must consume/filter the collection or create a separate fetch/cache.                                   |
| Core change events        | `useSdk().subscribe` exposes typed entity changes and connection events, including ID-scoped subscriptions.                                                  | Events alone do not provide cache patching, invalidation policy, or reconnection refetch. Those remain app code.                                                                                                                                           |
| Plugin signals            | `useRealtime(channel, handler)` uses core's socket and filters to the calling plugin.                                                                        | These are plugin-owned ephemeral signals, not core entity subscriptions. Plugin queries own reconciliation after disconnects.                                                                                                                              |
| Realtime connection reuse | Core uses `wsManager`; SDK subscriptions use `createBbRealtimeClient`.                                                                                       | `useSdk().subscribe` inherits the SDK client and lazily opens its own socket, separate from `wsManager`. Plugin wrappers share that SDK instance, so this is not one socket per plugin.                                                                    |
| Optimistic writes         | Bound SDK wraps thread title/section/parent updates and environment name updates; sidebar actions cover additional interactions.                             | Optimism is selective. An SDK read in a plugin-owned cache does not automatically become part of core's cache transactions.                                                                                                                                |
| Branch picker             | Core calls `/projects/:id/branch-options`; SDK offers `projects.branches`.                                                                                   | Both call the same server helper, but core selects background remote refresh and SDK selects blocking remote refresh. This is a concrete performance capability gap.                                                                                       |

Thread contracts and implementations: [SDK threads](../packages/sdk/src/areas/threads.ts), [HTTP schemas](../packages/server-contract/src/api/threads.ts), [thread routes](../apps/server/src/routes/threads/base.ts), [database list query](../packages/db/src/data/threads.ts).

Realtime evidence: [SDK event types](../packages/sdk/src/realtime-types.ts), [SDK socket client](../packages/sdk/src/realtime-client.ts), [core socket manager](../apps/app/src/lib/ws.ts), [plugin hooks](../apps/app/src/lib/plugin-sdk-hooks.ts). Core patches status and pending-interaction fields directly where event metadata permits, with throttled refetch fallbacks. A plugin that refetches its entire list on every event loses those optimizations.

Branch evidence: [core reader](../apps/app/src/lib/project-branch-options.ts), [SDK projects](../packages/sdk/src/areas/projects.ts), [server route handlers](../apps/server/src/routes/projects.ts).

## Direct HTTP exceptions

The scan found five non-test consumers importing the raw API client: sidebar bootstrap, branch options, host permission-ceiling mutation, file content URL builders, and `lib/api.ts` for previews/voice uploads. Plugin contribution discovery/settings also use direct fetch.

Direct HTTP does not always indicate a missing capability: `projects.sidebarBootstrap()` and `system.transcribeVoice()` already exist. Branch options and host permission-ceiling mutation have no equivalent SDK method in the inspected areas. File URL builders deserve a separate review because a browser-consumable URL has different behavior from fetching bytes.

## Evidence from existing plugins

- [Thread list](../plugins/thread-list/app/model/use-sidebar-data.ts) uses the shared sidebar hook, showing that exposing host cache integration works in practice.
- [Tasks search](../plugins/tasks/api/index.ts) merges active/archive search results and locally sorts/truncates them; its short-query fallback filters an already limited thread list. This illustrates the constraints of the existing search contract.
- [Side-chat cleanup](../plugins/side-chat/server.ts) manually pages threads and accounts for rows removed from the result during cleanup. A continuation API could simplify this class of consumer.
- [Tasks data hooks](../plugins/tasks/shell/data.ts) implement their own query state and signal invalidation. Plugin-owned storage will still need its own queries, but reusable lifecycle/reconnect patterns could reduce repeated work.

## Proposed prioritized checklist

### First: make efficient core data reads reusable

- [ ] Add experimental shared read hooks for filtered/paged thread lists and thread detail; extend to projects/environments when there is a concrete consumer. Reuse core cache owners and subscriptions. Include selectors, enabled/cancellation behavior, loading/error states, pagination, and reconnect reconciliation without exposing internal query keys.
- [ ] Bridge frontend SDK entity subscriptions onto the host realtime connection, retaining the independent transport for external SDK clients. Ensure connection state reflects the connection delivering the events.
- [ ] Add the background branch-options capability and migrate core to it.
- [ ] Forward `includeArchived`/`includeHidden` through SDK count args and serialization, with CLI coverage where missing.

Acceptance: a plugin screen and equivalent core screen share requests; unrelated thread events do not rerender every row; common status updates avoid whole-list refetch; reconnect restores correct data; branch selection does not wait for remote refresh.

### Next: improve queries shared by core and plugins

- [ ] Define a common thread filter model for list/count/search. Start with status/provider and concrete plugin search needs. Decide how totals, hidden/archive semantics, and metadata predicates should compose rather than exposing arbitrary SQL.
- [ ] Add deterministic ordering and cursor pagination with explicit continuation. Specify behavior under concurrent insert/archive/reorder, since a cursor alone does not guarantee snapshot consistency.
- [ ] Support bounded shared reads instead of requiring every active thread for every custom view. Keep the convenient sidebar model for consumers that need the whole sidebar.

Acceptance: realistic large thread collections can be filtered and paged without fetching all records or one detail request per row; list/count agree for identical predicates; concurrent changes have documented and tested page behavior.

### Then: maintain parity continuously

- [ ] Inventory remaining direct HTTP consumers and classify each as SDK-covered, missing public capability, or intentionally app-internal. Move SDK-covered core calls to the shared client.
- [ ] Publish Plugin Guide recipes distinguishing shared read hooks, raw `useSdk` calls, core entity subscriptions, and plugin signals. Include pagination and reconnect examples.
- [ ] Track parity by user journey (filtered thread browser, archive, picker, live dashboard), with request count, payload size, rerenders, and reconnect correctness alongside method availability.
- [ ] Refresh stale audit notes: the sidebar audit still contains an August “zero consumers” observation, while this checkout has thread-list and provider-usage consumers. Its large-collection concern remains relevant.

Use core as a consumer of new shared capabilities so the implementations cannot drift. New public plugin surfaces require experimental names, an API audit entry, Plugin Guide inventory, and matching SDK/CLI access where applicable. Do not define parity as publishing every internal React hook or HTTP route.

## Limits of this investigation

No plugin-specific slow workload was supplied, and no end-to-end latency timings were measured. Later verification below measures browser-request and database-query counts. Findings establish structural gaps and likely sources of duplicated work, not the cause of any particular observed slowdown. This is a focused data-access audit, not an exhaustive route-by-route or UI-slot parity inventory. Next implementation should choose a representative plugin view and measure it beside the equivalent core view.

## Implemented pilot

Added `experimental_useRpcQuery` and `experimental_useRpcInfiniteQuery` with
plugin-scoped caching, shared requests, coalesced signal invalidation, connection
reconciliation, and browser request cancellation. The app and frontend test
harness use the same implementation. Contracts validate inputs locally; the
server remains the owner of output validation/transformation.

GitHub item/link reads use the regular query hook. Its RPC contract now lives in
a browser-safe shared module. Tasks list views use the infinite query hook and
send sort/filter inputs to the server; the UI loads 100 rows initially and more
on demand. Counts indicate when more rows remain. Manual refresh and reconnect
handling avoid refreshing the new list twice. The later consolidation below also migrates board, detail navigation, and
active-task summaries.

Verification: SDK, Tasks, GitHub, and Plugin Guide suites passed (365, 394, 47,
and 82 tests respectively), plus 19 focused app tests. After the final
transformed-output fix, all five affected package typechecks and the 6 SDK query
and 109 Tasks list/shell tests passed. Plugin builds passed for Tasks, GitHub,
and Plugin Guide. The hooks cover plugin cache isolation, duplicate readers,
unmount cancellation, pending-read invalidation, disabled reads, changing inputs,
reconnects, fresh page cursors, failed next-page retry, and server-transformed
outputs.

A fresh source dev app with 105 synthetic tasks rendered 100 initially and 105
after Load more, removing the button on the last page. A realtime title update
preserved all 105 rows and rebuilt the two list pages. The active-task accessory
also made its existing separate request; this pilot does not eliminate all
Tasks refetching. GitHub loaded its empty issues view with a synthetic tracked
repository status and real empty item/link RPC responses; no external GitHub
writes were performed. The verification inventory preflight reported an
existing unmapped `browser` CLI family, so this was focused verification rather
than a whole-map pass.

## Built-in consumer migration

The follow-up migration covers the suitable reads identified in this investigation:

- Automations: overview, detail, and paginated run history. Loaded history survives next-page failures and refreshes sequentially after scoped signals or reconnects.
- Tasks: projects, folders, presets, sidebar summaries, task detail, parent/subtasks, labels, attachments, linked threads/PRs, machine/project pickers, active tasks, and sibling navigation. Snapshot-backed sidebar reads and manual refresh remain supported. Complete-collection consumers still load every page because their UI needs the complete result.
- GitHub: viewer/status, issue and PR details, assignable users, labels, and linked-PR resolution, in addition to the existing list/link pilot. Lazy pickers, optimistic edits, comment refresh, and returning from a linked PR to the picker remain supported.
- Workflows: active runs and run detail, preserving visible-document polling and recovery from failed reads.
- Account Pool: status and configuration, preserving cached status, configuration drafts, and explicit authentication flows.
- Connect: status and mobile-pairing availability. Full status payloads still update the screen directly; query reads reconcile on connection establishment.

The hooks also accept type-only contracts, so a migration does not require bundling server validation schemas. Server validation remains authoritative. Public usage details live in the Plugin Guide.

The later consolidation below replaces Tasks' composite board/activity/list-metadata
reads with batched RPCs. Mention search, writes, authentication polling, and Thread
List's shared core sidebar cache retain their explicit lifecycle.

Verification: all affected plugin suites and the SDK suite passed (SDK 365, Tasks 394, GitHub 48, Automations 135, Workflows 250, Account Pool 323, Connect 116, Plugin Guide 82). New integration coverage verifies Automations pagination failure/retry, scoped signals and reconnects; GitHub coverage verifies comment-triggered detail refresh and return from linked PR details to the picker. The picker regression was reproduced before fixing the local selection override.

Live check in the isolated source dev app: Automations loaded 50 synthetic script runs, clicking Load more displayed 51, and a new completed run updated the loaded history to 52 through realtime. Account Pool's empty status/configuration screen and Connect's disconnected screen rendered. The synthetic automation was deleted, the browser stopped, and all three dev ports were released. No external account actions were exercised.

## Shared core entity hooks implemented

Added experimental hooks for hosts, projects, thread detail, environment detail,
and project source branches. Each uses the corresponding SDK response type in a
consistent query envelope, including explicit placeholder state. The app runtime
exports the same functions used by core Projects Settings, thread timeline,
secondary-panel environment reads, and branch-picker adapters. Tasks now reads
core hosts/projects directly through these hooks; Provider Usage reads its current
thread/environment instead of scanning the sidebar model. Project mutations patch
all list variants while retaining included thread fields.

Validation: app 5,134 passed / 6 skipped; SDK 365, Tasks 394, Provider Usage 20,
and Plugin Guide 82 passed. Affected package typechecks and lint passed (existing
lint warnings remain); affected plugin bundles built. Integration tests verify
cross-consumer request sharing, invalidation, project variants/mutation propagation,
and null detail IDs. In the isolated web app, a project created while Tasks' project
picker was mounted appeared without a reload; core Projects Settings displayed the
same project with its source machine and thread count. Detail and branch behavior
is covered by the app suite; it was not separately exercised live this round.

Filtered/paged general thread and environment lists remain follow-up work. These
hooks do not claim that broader API parity is complete.

## Final consolidation and built-in audit

Core entity hooks now live in the original host, project, thread, and environment
query modules. The plugin runtime exports those implementations directly. The
separate core-data wrapper module is gone. Result normalization is shared with the
SDK harness; core retains its additional TanStack state flags. SDK data types and
payloads are unchanged.

Additional migrated consumers:

| Plugin            | Shared read                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| Docs              | Notebook listing shared by page and navigation; removed global cache/listener/refresh machinery |
| Memory            | Memory list and mutation reconciliation                                                         |
| Keep Awake        | Configuration; serial optimistic saves remain explicit                                          |
| Concurrency Limit | Configuration and realtime reconciliation                                                       |
| Modal Sandbox     | Launch options in composer/settings; reconnect preserves unsaved settings                       |
| Git Worktree      | Core projects/branches, default base branch, existing worktrees                                 |
| Project Checkout  | Core projects/branches and SDK checkout state                                                   |
| Theme Preview     | Catalog, realtime, polling, and request deadline recovery                                       |
| Monaco Editor     | Lazy file tree keyed by source                                                                  |
| Tasks             | Batched labels, row/board metadata, activity, and embedded task detail                          |

Tasks no longer owns a generic query runner. Its batched methods deduplicate
requested IDs and return only requested entities. Activity combines display
comments and attachment metadata without exposing blob paths. Metadata fetches
attachment counts only when requested by the board. These changes remove browser RPC fan-out. The final follow-up also replaces
per-entity SQLite reads with bulk queries and aggregate attachment counts. The board still loads its complete task collection.

Removed Tasks project/machine proxy methods and the worktree default-base-branch
proxy: UI consumers use shared core hooks, the Tasks CLI uses SDK hosts directly,
and worktree default selection comes from SDK branch data. The older public
branch/checkout hooks remain compatibility adapters for external plugins.

Remaining imperative reads have separate lifecycle requirements:

- Provider Usage's non-React content-script collector retains probe budgets and
  scheduling. It now shares one plugin-local TanStack Query client with the footer
  and settings. Its React entity lookups use shared core hooks.
- Browser Automation preview reads consume a sequence cursor with terminal states
  and backoff, rather than replacing an ordinary cached snapshot.
- Monaco file load/reload owns mutable editor state and conflict checks. Docs
  document sessions own autosave; preview preparation creates resources.
- Mention search, delete-impact confirmation, authentication polling, writes, and
  resource creation remain explicit actions. Thread List uses the existing shared
  core sidebar model.

Validation of this consolidation: all 17 affected plugin suites and SDK tests
passed, including Monaco (35) and Modal (64). The final full app run passed 5,135 tests with six existing skips, after
updating the old branch-adapter fixtures to use SDK projects. The canonical server worktree base-branch policy tests passed (3).
Typechecks, lint, and all migrated plugin bundles passed; existing React compiler
warnings remain. A new browser
RPC integration test verifies deadline abort, retry, and rejection of late results.

Live verification in the owned isolated dev store: three synthetic tasks appeared
through realtime; list and board refresh each sent one metadata batch for their three rows/cards;
opening a task used activityFeed. Docs was not available in this dev store; its
page/navigation sharing is covered by the plugin integration suite. No external accounts or real agent runs were involved.

## Remaining migration work completed

Added only two public hooks: `experimental_usePlugins` and
`experimental_usePluginCatalogSearch`. Both return SDK-shaped data in the common
query envelope. Core plugin screens and Plugin Guide use the same query owners;
core-specific display projections remain local. The Guide and audit inventory
cover their freshness, invalidation, and disabled behavior.

Tasks' sidebar count now uses the RPC query hook. Task/project IDs in signals
scope detail, metadata, label, and project-list invalidations. Unknown or global
payloads remain conservative. Empty metadata/label selections do not fetch.
A mounted-consumer test covers two identical details, another task, two count
readers, burst invalidations, and reconnects: duplicate readers share requests;
reconnect produces one read per distinct active query.

Tasks metadata uses one bulk thread query and optional grouped attachment counts;
labels and comment attachments also use bulk queries. A real SQLite integration
test verifies 1,100 requested tasks require exactly two metadata queries, with
no parameter-count overflow. Existing ownership tests exclude unrelated projects,
tasks, and attachment owners.

Thread List preferences use the RPC query hook for loading and reconciliation,
while retaining local mirrors, pending-write protection, and direct realtime
updates. Provider Usage removes its handwritten listener registry and in-flight
counter. A plugin-local TanStack Query client shares transport, caching,
single-flight requests, and snapshot/error state between background collection,
the footer, and settings. Sequential provider probes remain domain orchestration.
The client deliberately uses public dependencies: importing private SDK modules
would violate the built-in plugin's forkability contract. No non-React SDK API
was added.

Disabled core and RPC queries now agree: automatic reads and imperative refetch
are disabled; infinite fetchNextPage is also disabled. Cached data can remain
available. Tests preserve cancellation, deadline recovery, pagination, and
late-result protection.

Final validation: app 5,136 passed / 6 existing skips; SDK 365; Tasks 395;
Thread List 454; Provider Usage 21; Plugin Guide 80. All other affected built-in
suites passed in the combined run. Typechecks, lint, and affected bundles passed.
One command-palette case failed under the first combined run, then its entire
66-test file and the final full app run passed without a change to that test.
Provider Usage also passed the standalone fork check: install, typecheck, tests,
and build outside the monorepo against the packed SDK and public dependencies.

Live checks in the isolated dev store:

- Plugin Guide rendered using the shared inventory/catalog hooks; Provider Usage
  rendered the real empty-source state through the shared client.
- With project A's board and sidebar mounted, a project B task update caused only
  the three global reads (open count, sidebar summary, active tasks). It caused
  no project A list or metadata read.
- Updating project A's visible task caused one project list read, one metadata
  batch, and the same three global reads; the card updated through realtime.

The synthetic projects are removed and Plugin Guide's previous disabled state is
restored after verification. This is bounded request/query evidence, not a claim
of end-to-end latency parity or redesigned thread/environment list pagination.

## Integration with the current main branch

Main independently landed open-first Tasks loading, incremental list/board
signal patches, and row windowing in #4442. The final PR preserves those loaders
and their regression tests rather than replacing them with the earlier on-demand
list pagination pilot described above. Shared query hooks still serve detail
navigation, active summaries, labels, and the other migrated consumers. Initial
board metadata remains batched; subsequent card changes retain targeted reads.
The list-only load-more test was removed with that unshipped UI behavior; SDK
infinite-query and Automations pagination coverage remains.

The authoring skill now inventories all new hooks and query types. Its 22-test
server documentation suite passes. The SDK version is 0.6.3 after the latest
main version bump. Historical live pagination and list/board request-count
measurements above describe the pilot, not the retained incremental loaders.
