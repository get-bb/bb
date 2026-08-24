## Architecture: server projects the timeline; client renders rows

- Event-stream reduction is NOT done in the browser. `@bb/thread-view` (`packages/thread-view`, ~16.5k LOC, deps only `@bb/domain`, `@bb/server-contract`, `zod` — `packages/thread-view/package.json:16-20`) is consumed by `apps/server/src/services/threads/timeline.ts` to turn `ThreadEvent[]` into `TimelineRow[]` (`buildThreadTimelineFromEvents`, `packages/thread-view/src/build-thread-timeline.ts:1314-1380`). The only DOM-ish thing in the package is `Intl.NumberFormat` (`format-helpers.ts:76`); zero `window/document/react` imports. Imports use `.js` suffixes on `.ts` files (NodeNext), and `exports` point at `./src/index.ts` source (`package.json:5-11`) — Metro needs a resolver tweak.
- Wire model: `ThreadTimelineResponse` (`packages/server-contract/src/api/threads.ts:793-813`) = `rows: TimelineRow[]`, `activePromptMode`, `activeThinking`, `activeWorkflows`, `activeBackgroundCommands`, `pendingTodos`, `goal`, `modelFallback`, `contextWindowUsage`, `timelinePage{olderCursor,hasOlderRows}`, `maxSeq`, optional `delta`. Query params: `segmentLimit`, `beforeAnchorSeq/Id` (older pages), `afterSequence` (delta), `includeNestedRows`, `summaryOnly` (`threads.ts:664-685`). `TimelineDelta` + pure `computeTimelineRowDelta/applyTimelineDelta` live in `packages/server-contract/src/thread-timeline.ts:541-601`.
- Row union (`thread-timeline.ts:16-525`): `conversation` (user w/ `initiator`, `senderThreadId`, `systemMessageKind`, `systemMessageSubject`, `mentions`, `turnRequest{kind:message|steer,status:pending|accepted|rejected,isGrouped}`, `attachments`; assistant), `work` with `workKind` ∈ command | tool | file-change (`change.diff` unified text + `diffStats`) | web-search | web-fetch | image-view | approval (`approvalKind: file-edit|permission-grant`, `lifecycle`, `grantScope`) | question (`questions`, `answers`, `lifecycle`) | delegation (recursive `childRows`) | workflow (background task: `taskType`, `taskStatus`, `workflow` phase tree, `usage`), `system` (`systemKind: debug|error|reconnect|operation`, `operationKind: generic|compaction|context-clear|parent-change|thread-provisioning|thread-interrupted|provider-unhandled|warning|deprecation`), `turn` (collapsed completed turn, `children` null → lazy fetch via `sdk.threads.timelineTurnSummaryDetails`, `apps/app/src/hooks/queries/thread-queries.ts:917-945`).
- Client-side headless view layer in thread-view: `buildTimelineViewRows` groups work rows into `step-summary`/`bundle-summary` and marks `inClosedStep` (`timeline-view.ts:953-997`, cache via WeakMap `createTimelineViewRowsCache`), `buildTimelineRowTitle` → `TimelineTitle{segments[{text,em,shimmer,truncate,accent,link}],decorations[duration|status|summary-status|diff-stats],action}` (`timeline-row-title.ts:73-147,1582`), `buildTimelineActivityIntentTitles`, `findActiveLatestBundleId`, `findTimelineFrontierRow`, `formatThreadTimelineText` (CLI plain renderer, `format-timeline-text.ts`).
- Event types the projection handles (`packages/domain/src/provider-event.ts`): item lifecycle `item/started|completed|agentMessage/delta|commandExecution/outputDelta|fileChange/outputDelta|reasoning/*Delta|plan/delta|toolCall/progress|mcpToolCall/progress|backgroundTask/progress|completed`, `turn/started|completed|input/accepted|plan/updated|diff/updated`, `client/turn/requested|rejected|start`, `client/thread/start`, `system/error|operation|permissionGrant/lifecycle|userQuestion/lifecycle|thread-provisioning|thread/interrupted|manager/user_message|provider-turn-watchdog`, `provider/error|warning|unhandled|modelFallback|rateLimits/updated`, `thread/started|identity|name/updated|compacted|context/cleared|goal/updated|cleared|tokenUsage/updated|contextWindowUsage/updated`. Excluded noise: `timeline-noise-events.ts:12-19`.

## Data layer (headless, RN-compatible)

- HTTP: `sdk = createBrowserBbSdk({baseUrl, fetch})` (`apps/app/src/lib/sdk.ts`); `@bb/sdk/browser` uses global `fetch` + `hono/client` (`packages/sdk/src/transport-http.ts:18-19`) and global `WebSocket` (`realtime-client.ts:163-166`); upload accepts `ArrayBuffer|Blob|Uint8Array` (`areas/projects.ts:118-128`). Package `exports.browser` → `./dist/browser.js`.
- Realtime: `WebSocketManager` (`apps/app/src/lib/ws.ts`) wraps `partysocket/ws`, URL from `window.location` (`ws.ts:58-60`), ref-counted `subscribe({kind:"thread-detail",threadId})` (`ws.ts:165-194`), parses `ChangedMessage` (entity thread/project/environment/host/system + `changes[]` + `metadata{eventTypes,hasPendingInteraction,...}`). `useThreadDetailRealtimeSubscription` (`hooks/useRealtimeSubscription.ts:35-44`). Server never pushes rows — WS only invalidates; `createRealtimeCacheEffects` (`hooks/realtime-cache-effects.ts:224-318`) debounces 50/200ms, `REALTIME_THREAD_CHANGE_REGISTRY` maps `ThreadChangeKind` (`packages/domain/src/change-kinds.ts:8-26`) → dirty handlers (`cache-owners/realtime-cache-registry.ts:276-400`); `events-appended` invalidates timeline w/o cancelling in-flight and schedules a paced trailing refetch (`:147-247`). Timeline refetch asks `afterSequence=maxSeq` and merges delta (`thread-queries.ts:809-852`).
- `useThreadTimelineController` (`components/thread/timeline/useThreadTimelineController.ts:479-666`) is pure React state: merges latest window with loaded older pages by `sourceSeq` (`mergeLoadedTimelineWithLatest:393`, `mergeLatestTimelineRows:243`), older paging via `sdk.threads.timeline({beforeAnchorId,beforeAnchorSeq})`, stale-cursor recovery (`:471`).
- Query keys `hooks/queries/query-keys.ts` (1226 lines, `threadTimeline`, `threadPendingInteractions`, `threadQueuedMessages`, `threadPromptHistory`, `threadDetailBootstrap`, `threadDefaultExecutionOptions`, `projectCommands`, ...). Query hooks: `thread-queries.ts` (`useThread`, `useThreadDetailBootstrap` w/ timeline prefetch, `useThreadTimeline`, `useThreadQueuedMessages`, `useThreadPendingInteractions`, `useChildThreads`, `useThreadMentionCandidates`, `useThreadSearch`, `useThreadStoragePaths`, `useThreadConversationOutline`), `child-thread-pending-interactions.ts`, `system-queries.ts` (`useSystemProviders`, `useSystemExecutionOptions`, `useSystemConfig`), `thread-default-execution-options-query.ts`, `project-queries.ts` (`useProjectCommands`, `useProjectPathSuggestions`), `plugin-contribution-queries.ts`. Mutations: `thread-runtime-mutations.ts` (`useSendThreadMessage` → `sdk.threads.send({mode})`, `useEditThreadMessage`, queued create/update/send/reorder/delete, `useStopThread`, `useCancelThreadPlan`, `useClearThreadGoal`, `useCreateThread` → `spawn`), `thread-interaction-mutations.ts` (`useResolveThreadPendingInteraction`), `thread-state-mutations.ts` (pin/archive/delete/markRead), `project-mutations.ts` (`useUploadPromptAttachment`), `settings-mutations.ts`. Optimistic user row inserted into timeline cache (`cache-owners/thread-runtime-cache-owner.ts:790-845`, prefix `optimistic-user-`). QueryClient factory `lib/query-client.ts:116` (staleTime 2000, refetchOnWindowFocus, focus wiring via `window` events `:34-49`).

## Interaction surfaces

- Permission requests / ask-user-question: `PendingInteraction` list (`useThreadPendingInteractions`, WS kind `interactions-changed`), rendered above composer by `ThreadPendingInteractionBanner` (`components/thread/pending-interactions/ThreadPendingInteractionBanner.tsx:73-104`): approval subjects `command|file_change|permission_grant|plan`, decisions `allow_once|allow_for_session|deny` (`packages/domain/src/pending-interactions.ts:115-119`), resolved via `sdk.threads.interactions.resolve`; user questions via `UserQuestionAnswerForm` (`user-questions/UserQuestionInteractionContent.tsx`, form state `user-question-form-state.ts`) posting `{kind:"user_answer",answers}`. Historical state also appears inline as `approval`/`question` work rows (`QuestionWorkRowBody.tsx`). Child-thread attention: `useChildThreadPendingAttention` (`child-thread-pending-interactions.ts:53`). Composer blocked while pending (`buildFollowUpSubmitMode`, `views/thread-detail/threadDetailPromptSubmission.ts:126-146`).
- Steer/queue/stop: `FollowUpSubmitMode` ready|queue|stop-only|blocked (`FollowUpPromptBox.tsx:151-166`); Enter → `mode:"queue-if-active"`, Cmd+Enter → `"steer-if-active"` (`threadDetailPromptSubmission.ts:201-231`), `steerActiveThreadOnEnter` setting flips it (`ThreadDetailView.tsx:2679`); pending steers are tail conversation rows (`turnRequest.kind==="steer"`, label `conversation-turn-request-label.ts`); stop → `useStopThread` + optimistic "Stop requested" system row (`ThreadTimelineSurface.tsx:93-140`). Queue shown by `QueuedMessagesList` (dnd-kit reorder).
- Fork: `useForkThreadFromMessage` (`hooks/useForkThreadFromMessage.ts`) navigates to root compose with a seed; per-message action bar `MessageActionBar.tsx`. Child threads: `parent-change` system rows, `senderThreadId` + `systemMessageKind` child-* user rows (`packages/domain/src/thread-events.ts:44-53`), delegation rows with `childRows`, context banner children section (`ThreadPromptContextBanner.tsx:86-96`). Background tasks: `workflow` rows + `activeWorkflows`/`activeBackgroundCommands` cards (`banner/ThreadWorkflowCard.tsx`, `ThreadBackgroundCommandsCard.tsx`); thinking → `TimelineWorkingIndicator` from `activeThinking`.

## Rendering (DOM-bound)

- `ThreadTimelineRows.tsx` (2221 lines): no virtualization; flat flex column of memoized rows, contexts, `AutoHeightContainer`, `useSyncExternalStore` plugin slots, `react-router` `useLocation` for search-target expansion (`:581-609`), IntersectionObserver auto-load (`useAutoLoadOlderRows.ts:111`), ResizeObserver sticky-bottom (`useStickyBottomScroll.ts:85`, `ui/bottom-anchored-scroll-body.tsx`). `@tanstack/react-virtual` is only used in `secondary-panel/git-diff/DiffFilesPanel.tsx`.
- Markdown: `ui/markdown-preview.tsx` = `react-markdown@10` + remark-gfm/math/breaks/directive + rehype-raw/sanitize/katex + `katex.min.css`, `sugar-high` highlighting, `mermaid` lazy-loaded (`markdown-mermaid-loader.ts`), custom remark plugins for thread mentions/prompt mentions/plugin directives (`markdown-thread-mentions.tsx:293`, `markdown-prompt-mentions.tsx:71,151` — mdast transforms, headless).
- Diffs: `TimelineFileDiffBlock.tsx` synthesizes a git patch (headless `:54-236`) then `GitDiffCard` → `@pierre/diffs/react` + web Worker (`lib/diff-worker-pool.ts:18`). Terminal: `ansi-to-html` → HTML (`TerminalOutputBlock.tsx`). Tool call: plain pre (`ToolCallDetailBlock.tsx`). Radix Popover in `MessageActionBar`/`TimelineSelectionMenu`; `flushSync` from react-dom.
- Composer `PromptBoxInternal.tsx` (3445 lines): TipTap 3.26 (`useEditor`, StarterKit, Placeholder, `PromptMentionExtension` w/ `ReactNodeViewRenderer`, ProseMirror decorations `editor/prompt-decoration-extension.ts`), DOM paste parsing. Headless pieces: `editor/prompt-editor-serialization.ts` (doc⇄`{text,mentions}`; depends on `@tiptap/pm/model` types), `mentions/types.ts` (`PromptMentionSuggestion` union, `orderCommandSuggestions`), `mentions/find-active-trigger.ts` (regex over `textBetween`), `hooks/usePromptMentions.ts` + `*MentionSuggestions.ts` (pure builders using `@bb/fuzzy-match`), `hooks/useCommandSuggestions.ts`, `lib/prompt-draft.ts` (`promptDraftToInput/promptInputToDraft`), `hooks/usePromptDraftStorage.ts` (localStorage, `:59-102`), `effective-prompt-mode.ts`, `lib/permission-mode-options.ts`, `ExecutionControls.tsx` config types (`:15-69`). Voice: `hooks/useVoiceInput.ts` uses `MediaRecorder/getUserMedia/wakeLock` (`:88-268`) → `POST system/voice-transcription` multipart (`lib/api.ts:207`).
- `components/tools/*` is the Skills/Plugins "Tools" page (`tools-navigation.ts:20`), not tool-call renderers.

Versions: react 19.2.4, react-dom 19.2.4, @tanstack/react-query 5.90.20, @tanstack/react-virtual 3.14.3, jotai 2.19.0 (+jotai-family 1.0.1), @tiptap/* 3.26.0, react-markdown 10.1.0, katex 0.16.47, mermaid 11.15.0, partysocket 1.1.16, react-router-dom 7.13.0, zod 4.3.6, @pierre/diffs 1.2.9.

## Key files
- packages/thread-view/src/index.ts
- packages/thread-view/src/build-thread-timeline.ts
- packages/thread-view/src/timeline-view.ts
- packages/thread-view/src/timeline-row-title.ts
- packages/thread-view/src/format-timeline-text.ts
- packages/server-contract/src/thread-timeline.ts
- packages/server-contract/src/api/threads.ts
- packages/domain/src/provider-event.ts
- packages/domain/src/change-kinds.ts
- packages/domain/src/pending-interactions.ts
- packages/domain/src/shared-types.ts
- packages/sdk/src/browser.ts
- packages/sdk/src/realtime-client.ts
- packages/sdk/src/areas/threads.ts
- apps/app/src/lib/ws.ts
- apps/app/src/lib/sdk.ts
- apps/app/src/lib/query-client.ts
- apps/app/src/hooks/useRealtimeSubscription.ts
- apps/app/src/hooks/realtime-cache-effects.ts
- apps/app/src/hooks/cache-owners/realtime-cache-registry.ts
- apps/app/src/hooks/cache-owners/thread-runtime-cache-owner.ts
- apps/app/src/hooks/queries/query-keys.ts
- apps/app/src/hooks/queries/thread-queries.ts
- apps/app/src/hooks/queries/child-thread-pending-interactions.ts
- apps/app/src/hooks/mutations/thread-runtime-mutations.ts
- apps/app/src/hooks/mutations/thread-interaction-mutations.ts
- apps/app/src/hooks/usePromptMentions.ts
- apps/app/src/hooks/threadMentionSuggestions.ts
- apps/app/src/hooks/usePathSuggestions.ts
- apps/app/src/hooks/useCommandSuggestions.ts
- apps/app/src/hooks/usePromptDraftStorage.ts
- apps/app/src/hooks/useVoiceInput.ts
- apps/app/src/lib/prompt-draft.ts
- apps/app/src/components/thread/timeline/useThreadTimelineController.ts
- apps/app/src/components/thread/timeline/ThreadTimelineSurface.tsx
- apps/app/src/components/thread/timeline/ThreadTimelineRows.tsx
- apps/app/src/components/thread/timeline/TimelineRowDetails.tsx
- apps/app/src/components/thread/timeline/TimelineFileDiffBlock.tsx
- apps/app/src/components/thread/timeline/ConversationMessageContent.tsx
- apps/app/src/components/thread/timeline/timeline-auto-expand.ts
- apps/app/src/components/thread/timeline/types.ts
- apps/app/src/components/thread/pending-interactions/ThreadPendingInteractionBanner.tsx
- apps/app/src/components/thread/user-questions/UserQuestionInteractionContent.tsx
- apps/app/src/components/thread/embedded-chat/EmbeddedThreadChat.tsx
- apps/app/src/components/ui/markdown-preview.tsx
- apps/app/src/components/ui/markdown-prompt-mentions.tsx
- apps/app/src/components/ui/markdown-thread-mentions.tsx
- apps/app/src/components/promptbox/PromptBoxInternal.tsx
- apps/app/src/components/promptbox/FollowUpPromptBox.tsx
- apps/app/src/components/promptbox/ExecutionControls.tsx
- apps/app/src/components/promptbox/effective-prompt-mode.ts
- apps/app/src/components/promptbox/editor/prompt-editor-serialization.ts
- apps/app/src/components/promptbox/editor/prompt-editor-extensions.ts
- apps/app/src/components/promptbox/mentions/types.ts
- apps/app/src/components/promptbox/mentions/find-active-trigger.ts
- apps/app/src/components/promptbox/banner/QueuedMessagesList.tsx
- apps/app/src/components/promptbox/banner/ThreadPromptContextBanner.tsx
- apps/app/src/views/thread-detail/threadDetailPromptSubmission.ts
- apps/app/src/views/thread-detail/ThreadDetailView.tsx

## Reuse verdicts
- @bb/thread-view (packages/thread-view): **reusable-as-is** — Pure TS; deps only @bb/domain, @bb/server-contract, zod; only global used is Intl.NumberFormat (format-helpers.ts:76). Metro must resolve `exports.source` (./src/index.ts) and `.js`-suffixed imports of .ts files (NodeNext style).
- @bb/server-contract + @bb/domain: **reusable-as-is** — zod 4 + hono/client only; no DOM/node imports found in src (grep hits are comments). Same Metro source-resolution caveat.
- @bb/sdk/browser (createBrowserBbSdk): **reusable-as-is** — Uses global fetch and global WebSocket (transport-http.ts:18, realtime-client.ts:163); pass baseUrl explicitly. Uploads accept ArrayBuffer/Uint8Array (areas/projects.ts:118-128). Pulls @bb/templates/generated via areas/guide.ts (data-only). Do not import `@bb/sdk` root (node entry pulls @bb/config + ws).
- apps/app/src/lib/ws.ts WebSocketManager: **reusable-with-small-changes** — partysocket/ws works on RN WebSocket, but URL derived from window.location (ws.ts:58-60) and HMR singleton via import.meta.hot (ws.ts:275-286); replace URL resolution and singleton creation. Alternatively use @bb/sdk realtime-client.
- hooks/realtime-cache-effects.ts + cache-owners/realtime-cache-registry.ts + cache-invalidation-groups.ts: **reusable-with-small-changes** — Pure QueryClient logic; but registry imports lib/plugin-frontend-lazy (schedulePluginFrontendReconcile, realtime-cache-registry.ts:96) and query-keys imports lib/api-types & lib/file-preview types; needs extraction into a shared package with plugin reconcile injected.
- hooks/queries/* and hooks/mutations/* (thread-queries, thread-runtime-mutations, thread-interaction-mutations, query-keys): **headless-logic-only** — TanStack Query hooks with no DOM, but import app-local aliases (@/lib/sdk, @/lib/ws, @/lib/api-types, cache-owners); wsManager.getConnectionState() used in mutations (thread-runtime-mutations.ts:198). Extractable to shared package once sdk/ws are injected.
- components/thread/timeline/useThreadTimelineController.ts: **reusable-with-small-changes** — Pure React state + sdk calls; imports BbHttpError from @/lib/sdk and useConnectionAwareQueryState; no DOM.
- components/thread/timeline/timeline-auto-expand.ts, timelineRowSignatures.ts, conversation-message-limits.ts, compute-muted-prefix-length.ts, conversation-turn-request-label.ts, thread-runtime-status.ts, useThreadTimelineController merge helpers: **reusable-as-is** — Pure functions over ThreadTimelineViewRow; no DOM.
- components/thread/timeline/ThreadTimelineRows.tsx, ThreadTimelineSurface.tsx, ExpandableTimelineRow, TimelineDetailScroll, TimelineTitleView, MessageActionBar, TimelineSelectionMenu, useAutoLoadOlderRows, useStickyBottomScroll, ui/bottom-anchored-scroll-body: **not-reusable** — div/className Tailwind, IntersectionObserver/ResizeObserver, window.setTimeout/performance, react-router useLocation, Radix Popover, react-dom flushSync, plugin slot store; must be rewritten with RN FlatList/ScrollView.
- components/ui/markdown-preview.tsx: **not-reusable** — react-markdown renders HTML host elements, rehype-raw/sanitize/katex, katex CSS import, mermaid (SVG/DOM), sugar-high HTML output, Radix ContextMenu, window.location. Remark plugins markdown-prompt-mentions.tsx / markdown-thread-mentions.tsx (mdast transforms + substitutePromptMentions/splitRawThreadIdsInText) are headless and reusable.
- components/thread/timeline/TimelineFileDiffBlock.tsx + git-diff/GitDiffCard: **headless-logic-only** — Patch synthesis (getRenderablePatchText/parseRenderablePatch, TimelineFileDiffBlock.tsx:54-236, uses @pierre/diffs parsePatchFiles) is pure; rendering uses @pierre/diffs/react + Web Worker (lib/diff-worker-pool.ts:18) → not RN.
- components/thread/timeline/TerminalOutputBlock.tsx: **not-reusable** — ansi-to-html emits HTML strings with CSS var colors; RN needs an ANSI→spans parser (e.g. anser) and Text styling.
- components/thread/pending-interactions/ThreadPendingInteractionBanner.tsx + user-questions/*: **headless-logic-only** — Decision/label logic (buildApprovalSubject, labelForApprovalDecision, user-question-form-state.ts) and @bb/core-ui formatters are pure; JSX uses NavLink, MarkdownPreview, Tailwind.
- components/promptbox/PromptBoxInternal.tsx / FollowUpPromptBox.tsx / MentionMenu.tsx / editor/*: **not-reusable** — TipTap/ProseMirror contenteditable, ReactNodeViewRenderer, DOM paste parsing, jotai atomWithStorage on localStorage, window.matchMedia. Prop contracts (TypeaheadConfig, FollowUpSubmitMode, ExecutionControlsProps, PromptBoxHandle) are worth mirroring.
- components/promptbox/editor/prompt-editor-serialization.ts: **headless-logic-only** — Text⇄mentions serialization and promptMentionResourceFromSuggestion/promptCommandResourceFromSuggestion are pure, but typed against @tiptap/pm/model Node/Slice; RN would use only the value-level helpers or reimplement over a plain-text+ranges model.
- components/promptbox/mentions/types.ts, find-active-trigger.ts, command-trigger.ts, hooks/usePromptMentions.ts, hooks/*MentionSuggestions.ts, hooks/usePathSuggestions.ts, hooks/useCommandSuggestions.ts: **reusable-with-small-changes** — Pure builders + TanStack hooks; findActiveTrigger only needs {selection,doc.textBetween} shape (find-active-trigger.ts:6-21) so a TextInput adapter works; imports @/ aliases (plugin-mention-triggers, route-paths.isProjectlessProjectId).
- lib/prompt-draft.ts, views/thread-detail/threadDetailPromptSubmission.ts, threadQueuedMessages.ts, promptbox/effective-prompt-mode.ts, lib/permission-mode-options.ts: **reusable-as-is** — Pure policy functions (submit mode, request builders, draft⇄PromptInput).
- hooks/usePromptDraftStorage.ts: **reusable-with-small-changes** — Backed by window.localStorage + window.setTimeout + storage events; swap for MMKV/AsyncStorage adapter.
- hooks/useVoiceInput.ts + promptbox/usePromptVoice.ts + lib/api.ts transcribeVoiceInput: **not-reusable** — MediaRecorder, navigator.mediaDevices, navigator.wakeLock, DOMException, File; RN needs expo-av recording then multipart POST to system/voice-transcription.
- lib/query-client.ts createAppQueryClient: **reusable-with-small-changes** — QueryClient config is fine; installAppQueryClientBrowserEvents/focusManager wiring uses window/document (query-client.ts:34-113); replace with AppState.
- components/tools/* (Skills/Plugins page): **not-reusable** — react-router matchPath, Tailwind, Radix; unrelated to tool-call rendering.

## Risks
- Metro/Expo must consume workspace packages from TS source with `exports.source` and NodeNext `.js`→`.ts` import specifiers (packages/thread-view/src/index.ts, @bb/domain, @bb/server-contract); needs a custom resolver or a build step producing dist for RN.
- Timeline has no virtualization on web (ThreadTimelineRows renders every row of the loaded window); RN must use FlatList/FlashList with recursive nested rows (delegation childRows, bundle/step summaries, lazy turn children) and stable keys — the AutoHeightContainer/sticky-bottom scroll behavior has no RN equivalent.
- Streaming UX depends on WS-invalidate + HTTP delta refetch loop paced at 50–1000ms (realtime-cache-registry.ts:147-247); on mobile networks this polling cadence and background/foreground transitions (focusManager uses window events) need re-tuning with AppState and NetInfo.
- Markdown/KaTeX/Mermaid/syntax highlight and @pierre/diffs (worker + DOM) have no drop-in RN equivalents; expect a custom mdast→RN renderer, WebView for math/mermaid, and a custom unified-diff renderer using parsePatchFiles or hand-rolled hunk rendering.
- Composer semantics (mention pills w/ offsets, slash commands, blockquote quote-into-prompt, rich text) are encoded in ProseMirror docs; RN TextInput cannot host inline pills natively — need a text+ranges model with the serialization contract (PromptEditorValue{text,mentions}) preserved so server-side PromptInput mentions stay identical.
- Optimistic user rows (optimistic-user-* ids) and cache-owner transactions are tightly coupled to query-keys and wsManager.getConnectionState(); extracting them to a shared package requires dependency injection of sdk/ws.
- Plugin frontend surfaces (message actions, message directives, composer slots, mention providers via plugin-slots) are web-only; RN parity for plugin UI is out of reach without a plugin runtime.
- Attachments/voice depend on browser File/MediaRecorder; server multipart endpoints (projects.attachments.upload, system/voice-transcription) are usable but require expo-file-system/expo-av adapters.

## Open questions
- Should the RN app share a new headless package (query keys, cache owners, realtime registry, timeline controller, prompt policy) extracted from apps/app/src/hooks, or duplicate?
- Does the server timeline endpoint accept a smaller `segmentLimit`/`includeNestedRows=false` profile suitable for mobile, and what is the default segment count (see threadTimelineQuerySchema)?
- Is there an auth/session mechanism for non-same-origin clients (fetchWithAppSurface in lib/app-surface.ts; bb connect tunnel) that the RN client must replicate for HTTP + WS?
- Which subset of TimelineTitleAction/segment links (open-file-diff, open-plugin-side-chat, thread links) should be actionable on mobile given no secondary panel?
- Should mobile support editing sent messages (editMessage with expectedRequestSequence) and inline queued-message editing, both of which currently mount a second TipTap editor?
- How should plugin-provided message directives (::inline-vis) and message actions degrade on mobile — hidden, or rendered via WebView?
