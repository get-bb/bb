# Plugin 1.0 end-to-end test plan

Status: completed against the consolidated Plugin 1.0 branch  
Branch: `bb/plugin-1-0-consolidated`  
Pull request: #716  
Test instance: isolated `scripts/bb-dev-app` data directory; never the user's normal `~/.bb`

> Historical record: this plan documents the former configurable marketplace
> implementation. Current BB exposes one fixed official plugin catalog; the
> marketplace add/remove/path-catalog scenarios below are intentionally not a
> current acceptance contract.

## Purpose

This is the executable acceptance plan for the Plugin 1.0 API, SDK, official
plugins, and shipped app integration. It combines real-browser workflows,
public HTTP/RPC behavior, CLI/SDK parity, reload and failure recovery, and
targeted multi-machine checks. It is intentionally broader than unit coverage:
the goal is to catch wiring, contract, generated-artifact, navigation, and
state-lifecycle failures that only appear in a running BB.

Testing must remain resource-conscious. Prefer one browser, sequential
scenarios, direct API inspection, and focused tests for reproduced bugs. Do not
run full app/server suites merely for confidence; CI owns broad regression
coverage.

## Execution summary

- Scenario results, excluding the six administrative final-acceptance gates:
  **150 live passes**, **85 focused-contract passes**, **23 explicitly blocked
  or inapplicable cases**, and **no unexplained failures**.
- Product findings: eight fixed bugs and one unresolved host-filesystem
  isolation policy decision (`P1-E2E-008`).
- Overnight fix commits: `ee04454a1` (browser fetch and CLI JSON/reload),
  `432e8e66a` (GitHub pagination/CLI validation), `d084b7234` (Docs validation
  and directory removal), and `d34554ab7` (empty transcription/protocol
  resilience).
- Focused local verification only: 21 app query tests, 27 CLI output tests, 4
  GitHub tests, 16 Docs/host path-mutation tests, and 41 SDK/server/daemon voice
  tests, plus affected-package Turbo typechecks. Broad regression suites are
  delegated to GitHub CI.

## Result notation

- `[x]` passed against the live test instance.
- `[T]` passed by a focused automated contract/regression test already present
  in the consolidated branch; it was not rerun as a broad suite during this
  resource-conscious live pass.
- `[ ]` not yet run.
- `[!]` failed; linked to a bug in the catalog.
- `[-]` deliberately blocked or not applicable in this environment, with the
  reason recorded next to the item.

## Environment and evidence

- [x] Consolidated dev server starts from the PR branch.
- [x] Vite app responds on the isolated app port.
- [x] Server API responds on the isolated server port.
- [x] Host daemon connects to the isolated server.
- [x] Remote owner-session-gated bb Connect URL is exposed.
- [x] Plugins experiment is persisted as enabled.
- [x] Docs and GitHub are installed from local paths in this exact checkout.
- [x] Docs and GitHub server status is `running` and frontend bundles are SDK-compatible.
- [x] Capture branch/test instance identity throughout the run; the fix SHAs and final PR head are recorded at handoff.
- [x] Scan server/plugin logs before testing and after the final scenario. Deliberate negative probes and slot-crash diagnostics matched their scenarios; no unexplained product error remained.
- [x] Confirm no test data escaped the isolated data directory. Disposable host-file roots were confined to named `/private/tmp` directories and removed; the real default Personal Docs vault was never opened or mutated.

## 1. Experiment gate and startup

- [x] With Plugins off, user-installed plugins unload and plugin management reports the gate clearly.
- [x] Builtin plugin policy remains correct while user-installed plugins are gated.
- [x] Turning Plugins on loads enabled user plugins without restarting BB.
- [x] App reacts live to the experiment toggle.
- [x] CLI can read and update experiments against a fresh/default config.
- [x] Experiment state survives a full isolated dev-stack restart; all enabled plugins return to `running`.
- [x] Installed plugin ordering remained stable across two full isolated-stack restarts and reloads.
- [T] A single plugin load failure does not prevent other plugins or the app from loading.

## 2. Manifest identity, branding, and compatibility

- [x] Installed rows consistently use manifest `bb.name` as the human name.
- [x] Marketplace `displayName` remains a catalog-only label and is not conflated with manifest identity.
- [T] Required `bb.name`, `bb.description`, and `bb.branding` validation produces actionable errors.
- [x] Branding with a built-in icon renders in compact surfaces.
- [x] Light/dark logo selection renders in roomy Settings surfaces.
- [x] Logo-only plugin falls back safely on compact surfaces.
- [T] Unsafe paths, missing assets, unsupported extensions, blank/null legacy values, and escaping symlinks are rejected.
- [T] SDK engine compatibility is displayed and incompatible managed installs are refused.
- [x] The running frontend bundles report compatible SDK metadata and load successfully.
- [x] Plugin/package/API versions remain pre-1.0. The live pass ran on SDK
      `0.2.0`; release coordination moved the contract to `0.3.0`, and the
      additive realtime connection hook advanced it to `0.3.1`. The breaking
      thread-group rename advanced the SDK to `0.4.0`.

## 3. Plugin management UI

- [x] Settings -> Plugins lists installed plugins with correct count and names after the `P1-E2E-001` fix.
- [x] Installed plugin cards show status, source, version, branding, settings, and compatibility; service/schedule detail is verified through CLI/API.
- [x] Installed/Browse/Marketplaces tabs render against the same live inventory.
- [x] Browse loads BB Official and distinguishes installed entries.
- [x] Browse search/no-results and compatibility presentation are correct.
- [x] Add Plugin accepts a local path and gives a full-trust warning.
- [x] Successful install appears without a full app reload.
- [T] Duplicate/reinstall paths produce actionable guidance and preserve the prior install on validation failure.
- [x] Disable removes contributions and changes status without corrupting settings/state.
- [x] Enable restores contributions.
- [x] Targeted reload reports only the requested plugin and rejects unknown ids after the `P1-E2E-003` fix.
- [T] Reload candidate failure preserves the complete previous registration/runtime set.
- [x] Remove asks for confirmation and removes contributions while leaving the app healthy; temporary plugin settings were cleared.
- [x] Plugin settings detail renders declarative and custom settings sections.
- [T] Secret settings never round-trip into frontend state.
- [x] Non-secret settings save/refresh; healthy plugins stay loaded and needs-configuration recovery reloads per the documented exception.
- [T] Needs-configuration state and recovery instructions are accurate.
- [x] Marketplaces list, local add, and remove flows work.
- [T] Remote refresh failure retains last-known-good marketplace data; live remote failure injection was skipped.
- [T] Marketplace removal preserves installed plugins/provenance safely; the live disposable marketplace had no installed entries.

## 4. Plugin lifecycle CLI

- [x] `bb plugin list --json` parses the live installed-plugin response.
- [x] `bb plugin install <local-path> --yes` exits successfully after server installation.
- [x] Human-readable plugin list includes name, status, source, services, schedules, handlers, and command.
- [x] `source`, `install`, `enable`, `disable`, `reload`, and `remove` match UI behavior.
- [x] `config get/set/unset` validates descriptor types and persists/clears values.
- [x] `logs` returns plugin-scoped output.
- [-] Log follow mode was intentionally skipped to avoid a sustained process during the resource-conscious pass; bounded log reads passed.
- [x] `token` reads/rotates token state without exposing it in unrelated surfaces.
- [x] `run` and top-level contributed CLI aliases preserve argv/context/exit codes.
- [x] `outdated` and `update` report pinned/current sources and reject ambiguous update invocation.
- [-] Live remote update selection requires a deliberately controlled remote artifact/version source.
- [x] Marketplace add/list/remove/search output is machine-parseable; install `--json` is clean after `P1-E2E-002`.
- [-] Remote marketplace update/failure retention requires a controlled remote artifact source.
- [x] CLI errors have non-zero exits, stable messages, and no partial-success ambiguity for exercised negative cases.

## 5. Backend registration and lifecycle semantics

- [T] Duplicate keyed registrations are rejected with plugin/id context.
- [T] Event listeners for the same event are additive and ordered.
- [T] Reload candidate registrations are invisible until activation succeeds.
- [T] Shared-port declarations are atomic across reload.
- [T] Dispose hooks execute LIFO and isolate failures.
- [T] Background services start, abort, restart with backoff, and stop on disable/reload.
- [T] Schedules persist while only firing for a loaded plugin.
- [T] Handler statistics count success, failure, duration, and survive reload as documented.
- [T] Stale API handles reject calls after reload.
- [T] Plugin SQLite handles close on reload; KV state remains namespaced.
- [T] Database migrations are idempotent and append-only in practice.
- [T] KV JSON and size boundaries reject invalid/oversized values.
- [T] `needsConfiguration` is visible without crash-looping.

## 6. HTTP, schema RPC, realtime, and JSON boundaries

- [T] Local-auth plugin HTTP route accepts app-origin requests and rejects non-local callers.
- [x] Token-auth Docs HTTP route rejects missing/wrong token and accepts the current token.
- [x] Rotating a plugin token invalidates the old token.
- [T] Auth-none route remains opt-in and plugin-owned verification is documented.
- [x] Docs schema RPC valid input returns the expected validated output shape.
- [x] Malformed JSON returns the stable `invalid_json` envelope.
- [x] Schema-invalid input returns `invalid_input` with safe issue path/message.
- [T] Handler throw returns `handler_error` without leaking stack/secrets.
- [T] Invalid handler output returns `invalid_output`.
- [T] Non-JSON output returns `non_json_result`.
- [x] Unknown method returns the stable `unknown_method` envelope and 404.
- [x] Frontend typed client inference and runtime method selection agree for the Docs and GitHub schema-driven clients exercised live.
- [x] Realtime `publish`/frontend subscription delivers JSON-safe payloads once.
- [x] Unmount/reload removes subscriptions; a post-reload pulse was delivered once without a duplicate listener.

## 7. Frontend runtime loading and isolation

- [x] App fetches plugin inventory and loads the compatible installed bundles without browser console/page errors.
- [T] Bundle cache bust changes after plugin rebuild/reload.
- [T] Incompatible frontend bundle is skipped with a visible diagnostic.
- [T] One bundle load failure does not block other plugins.
- [T] One crashing slot collapses to the documented fallback without breaking its host surface.
- [T] Disabling/removing a plugin unmounts slots, subscriptions, and styles.
- [x] Browser refresh/reconnect after a forced dev-stack restart restored plugin inventory, panels, and slot fixture surfaces.
- [-] The legacy popout entry point is intentionally absent; persisted secondary-panel tabs were exercised instead.

## 8. All frontend slots

### Homepage section

- [x] Renders on compose with current/null project context.
- [x] Project and personal compose contexts update the accessory/homepage context without leaking the prior entity.
- [x] Crash isolation preserves the healthy homepage section and the rest of compose.

### Settings section

- [x] Renders under the correct plugin detail route with current host settings.
- [T] Running, degraded, and needs-configuration mounting states are covered by focused slot/settings tests.
- [x] Settings hooks returned the declared non-secret greeting; secret redaction remains focused-contract covered.

### Navigation panel

- [x] Docs and GitHub sidebar contributions appear and direct panel roots render.
- [x] Page chrome uses the shared title bar exactly once.
- [x] Full-bleed/no-padding mode matched the main content bounds without an extra inset or plugin chrome.
- [x] A throwing header accessory disappeared while the panel body and navigation remained usable.
- [x] Plugin panel root navigation survives direct load, refresh, browser back, and browser forward.
- [x] Nested panel deep links preserve `subPath` through refresh/back/forward.
- [x] Unknown nested paths are delivered as a safe `subPath`; unknown plugin roots use the host not-found state.

### Thread panel action

- [x] Four fixture actions appeared in a real thread's panel launcher.
- [x] `run` opened a titled panel with nested object/array/null JSON params intact.
- [x] Re-running the same action focused its existing tab; distinct action/file params opened sibling tabs.
- [x] Params, title, and selected tab restored across browser refresh.
- [x] A rejected async action logged a plugin-scoped warning without opening/breaking a tab; a throwing panel collapsed to its slot fallback and sibling tabs remained usable.

### Composer accessory and composer API

- [x] Accessory receives correct thread/new-thread and project/personal context.
- [x] Arbitrary composer set/update/clear and focus changes reached the active composer and preserved focus.
- [x] Quote insertion preserved Markdown multiline quoting in the submitted message.
- [x] Mention insertion resolved the fixture provider's entity with plugin-scoped context.
- [x] Composer edits followed the active personal/project/thread route; disposable accidental fixture submissions were deleted during cleanup.

### Pending interaction / requestInput

- [T] Backend request replaces the correct thread composer.
- [T] Submit returns JSON only to the waiting invocation and does not persist the secret value.
- [T] Cancel reports the correct reason.
- [T] Timeout, caller abort, reload, and disable settle the request exactly once.
- [T] Concurrent interactions do not cross threads. A live CLI attempt was aborted after the disposable thread never exposed a pending request; no secret/input was submitted.

### Sidebar footer action

- [x] Action renders with an accessible label and canonical compact icon.
- [x] Open-settings navigation lands on the owning plugin.
- [T] Throwing footer actions are contained by the focused host test.

### File opener

- [T] Default opener selection works per extension; preference selection and reversion were also live-verified.
- [x] Rendered workspace and thread-storage links opened safe preview tabs; plugin-specific Open With routing remains focused-contract covered.
- [x] Docs opener registration and preference preserve workspace/host/thread-storage source kinds in the host contract.
- [T] Git snapshots/deleted files fall back to built-in preview.
- [T] Disable/remove degrades an open file tab safely.

### Message directive

- [x] Valid assistant directives rendered the plugin component before the deliberate same-slot crash disabled that registration for the session.
- [T] User messages, code spans, fenced blocks, incomplete streams, unknown ids, and malformed syntax remain literal; the live unknown id remained source text.
- [x] Component throw fell back to exact source and disabled only that directive registration for the session; the timeline and app remained healthy.
- [T] Workspace-file and same-plugin thread-panel callbacks enforce scope and JSON params.

## 9. Host-rendered actions, mentions, tools, skills, and instructions

- [T] Thread action rendering, confirmation, success, and error-toast paths are focused-host covered; live GitHub Start/Review actions reached their actionable missing-project state without spawning.
- [x] GitHub issue/PR and Docs mention providers group by label and honor configured `@`/`#` triggers; invalid triggers fail and empty queries short-circuit.
- [T] Mention search timeout and throwing-provider failure isolation are covered by focused host tests.
- [T] Mention resolve runs at send time once per unique item; failure blocks send visibly.
- [T] Native tool schema rejects invalid arguments and returns structured results.
- [T] Cross-plugin tool-name collision keeps the earlier registration and reports the dropped tool.
- [T] Static plugin skills are injected and discoverable.
- [T] Dynamic configuration conditionally adds tools, skills, tool instructions, and instructions per thread.
- [T] Side chats receive the approved dynamic configuration while preserving mutable-tool safety policy.
- [T] Agent configuration changes apply at the documented session boundary.

## 10. Docs plugin

- [x] Sidebar entry and panel root render from the installed local bundle.
- [-] The default vault is a real host path, not isolated BB state; it was listed but never opened or mutated. Testing used a disposable `/tmp` vault.
- [x] Create a Markdown document from UI; it appears in navigation and persists after refresh.
- [x] Edit rich text/Markdown; autosave persists exact content.
- [T] Autosave/edit regression coverage includes successive rich-text and Markdown table updates; live autosave persisted the final value.
- [x] External change/CAS conflict is surfaced without overwriting either version, and reload is safe.
- [x] Rename-to-title updates the tree, URL, and file atomically.
- [x] Create nested sections/documents and distinguish `section.md` from `section/`.
- [x] Search returns title/path/content matches and clears predictably.
- [x] Delete confirmation removes the document and selects a sensible next state.
- [x] Deep link opens the correct document; refresh/back/forward retain selection.
- [x] Multiple vault selection and explicit connected-host routing do not leak cached data in the one-host instance.
- [-] Remote-host unavailable/recovery requires a second enrolled host; the only host was not deliberately removed.
- [T] Drag/drop/move regression tests cover nested and top-level destinations; live CLI/RPC traversal probes preserve root confinement.
- [-] Docs editor image insertion was not exercised against the user's real default vault; generic binary attachment fidelity and file confinement passed in disposable roots.
- [x] Sandboxed full-page and embedded HTML previews load relative routes, execute permitted scripts, honor configured height, and do not expose host paths.
- [-] Docs file-opener registration and preference selection/reversion passed, but opening a real file tab was blocked by the lack of a disposable safe thread/file-link fixture.
- [T] Docs selection quote/mention scope is covered by focused editor/composer tests; the generic live composer fixture separately verified quote and mention insertion.
- [T] Docs directive validates attributes and opens file/panel fallbacks safely.
- [x] Docs CLI and HTTP CRUD match UI results and enforce token auth; traversal is rejected. Invalid-status mapping and empty-directory CLI removal are tracked below.
- [T] Watch service publishes native filesystem changes without waiting for polling and deduplicates the covered path.

## 11. GitHub plugin

- [x] Sidebar entry and panel root render from the installed local bundle.
- [x] Empty state renders without credentials or tracked GitHub-origin projects.
- [x] Settings show project/extra-repo configuration with accurate validation and save/reversion behavior.
- [x] Refresh action completes successfully against a configured public repo and leaves navigation responsive.
- [-] GitHub refresh failure/retry was not forced against the user's authenticated `gh` state; focused error-state tests cover the boundary.
- [x] Public repository discovery, extra-repository configuration, refresh, and CLI sync agree; malformed CLI repository selectors are rejected.
- [x] Configured public repository renders issue and PR lists with filters and accessible row actions.
- [x] Plain-text filtering narrows to the expected issue and clear restores the list.
- [x] Pagination returns the complete 305-file inventory on PR #716 after `P1-E2E-004`.
- [x] Issue direct load, refresh, browser back, and browser forward restore the same owner/repo/number route.
- [x] PR deep link renders metadata, activity/comments, changed-file inventory, and expandable syntax-highlighted diffs.
- [x] PR refresh, browser back, and browser forward restore the same owner/repo/number route.
- [x] Headerless GitHub API patch text is normalized and rendered in the live expandable PR diff.
- [T] Thread links persist and resolve to the correct issue/PR in focused GitHub tests.
- [x] Thread panel actions exposed the configured GitHub PR action and the live Start/Review flows gave an actionable missing-project state.
- [x] Start/Review thread actions carry repository context and report missing project configuration without spawning a thread.
- [x] GitHub mentions search/resolve issues and PRs with correct namespaces.
- [T] Background sync failure isolation and refresh publication are covered by the plugin service/runtime tests; live refresh succeeded.
- [x] GitHub CLI repos/issues/PRs/sync match UI/RPC data and enforce exit/argument semantics.
- [-] Authenticated GitHub mutation flows require an intentionally provided test account; do not reuse or expose personal credentials.

## 12. SDK and CLI parity smoke matrix

- [T] Every public SDK area can be constructed from root, core, browser, and Node entrypoints.
- [T] Named portable result DTOs compile externally without route-derived internal types.
- [T] Plugin backend receives the complete current `BbSdk`.
- [x] SDK `subscribe` opens/connects, delivers `system:config-changed`, reports connection state, unsubscribes/closes, and the obsolete realtime `on` name is absent from the public snapshot.
- [T] Plugin events use `bb.events.on`; obsolete plugin root `on` is absent except `onDispose`.
- [x] Files and previews route by explicit host and preserve confinement.
- [x] Provider listing/model discovery gives the same complete result for explicit-primary-host and documented omitted-selector fallback.
- [-] Provider environment routing and cross-machine cache isolation require a second enrolled machine with a deliberately different provider set.
- [x] Project creation/get/list/files/paths/content/branches/commands/defaults/history/update/reorder/delete and source update honor explicit host routing and primary fallback.
- [x] Attachments upload/download preserve binary bytes, filename/MIME metadata, and client-owned input semantics.
- [x] Canonical top-level terminals complete create/get/list/rename/resize/input/output/restart/close on a live host-path scope.
- [x] Terminal creation/input/output/list/close is exercised on live host-path, environment, and thread scopes.
- [x] Theme selection object and favicon set/reset match CLI behavior and restore the default appearance.
- [T] Environment inspection and project-create machine selectors match SDK capabilities.
- [T] CLI help and built-in agent skills describe each changed surface accurately.

## 13. Multi-machine behavior

- [x] Explicit `hostId` wins on live files, providers, projects, terminals, and Docs routes where the contract permits it.
- [T] Entity-derived routing resolves the entity's machine, not implicit primary.
- [x] Documented primary fallback occurs only when selectors are omitted on the exercised providers/projects/files surfaces.
- [T] Conflicting host/environment selectors are rejected rather than ignored.
- [-] Disconnected-machine messaging and recovery require deliberately disconnecting a second enrolled machine; the only host was not removed/suspended.
- [-] Different machines may expose different providers without cache contamination; only one host is enrolled.
- [x] Docs vault queries and writes stay on the selected connected machine; disconnected-machine behavior remains unavailable.
- [x] Project workspace discovery/content stays on the explicitly selected project source host and the documented omitted-selector fallback reaches the same primary source.
- [x] Host-scoped terminal and project attachment operations remain scoped to their owning host/project; environment/thread terminal scopes still require entity fixtures.
- [T] Shared-port declarations reach only the requested enrolled machine.

## Appendix A: exhaustive public SDK callable inventory

Each area below is complete only when its methods are covered by the most
appropriate layer: a live E2E success path where the isolated instance has the
required entity/capability, a live invalid-input/routing path for boundary
behavior, and the canonical focused contract test for destructive or externally
blocked operations. This inventory is the 146-callable snapshot; no public
method may disappear behind a grouped test-plan heading.

- [-] `environments` (16): `archiveThreads`, `commit`, `diff`, `diffBranches`,
  `diffFile`, `diffFiles`, `diffPatch`, `get`, `pullRequest`,
  `markPullRequestDraft`, `markPullRequestReady`, `mergePullRequest`, `paths`,
  `squashMerge`, `status`, `update`. Live read-only passes on the disposable
  host-path environment: `get`, `status`, `paths`, `diff`, `diffFiles`,
  `diffBranches`, and `pullRequest`, including the non-git/unavailable outcome
  envelopes. File-level diff and destructive git/PR mutations require a
  deliberately configured review repository and credentials.
- [x] `files` (8): `read`, `write`, `list`, `listPaths`, `mkdir`, `move`,
      `remove`, `createPreview`.
- [x] `guide` (1): `render` (overview, Plugins chapter, and unknown-chapter error).
- [-] `hosts` (11): `createJoinCode`, `delete`, `directory`, `get`,
  `cloneDefaultPath`, `installProviderCli`, `list`, `pathsExist`, `pickFolder`,
  `providerCliStatus`, `update`. Live passes: `list`, `get`, `directory`,
  `pathsExist`, and `providerCliStatus`. Host deletion, provider installation,
  native section-picker interaction, and enrollment mutation are intentionally
  not performed on the only connected test host; clone-path needs a project.
- [-] `projects` (18): `attachments.read`, `attachments.upload`, `branches`,
  `commands`, `create`, `defaultExecutionOptions`, `delete`, `fileContent`,
  `files`, `get`, `list`, `paths`, `promptHistory`, `reorder`, `update`,
  `sources.add`, `sources.update`, `sources.delete`. Live passes: every root
  method plus attachment read/upload and source update. A duplicate same-host
  source is correctly rejected; successful source add/delete requires a second
  enrolled host because a project permits one source per host.
- [-] `plugins` (20): `callRpc`, `applyUpdate`, `checkUpdates`, `disable`,
  `enable`, `getSettings`, `getSource`, `install`, `installFromMarketplace`,
  `list`, `listUpdateResults`, `marketplaces.add`, `marketplaces.list`,
  `marketplaces.refresh`, `marketplaces.remove`, `marketplaces.search`,
  `reload`, `remove`, `token`, `updateSettings`. Live direct/CLI/UI coverage
  includes RPC, list/source/settings/update-settings, install/remove,
  enable/disable/reload, token rotation, update check/result/application on a
  pinned disposable plugin, and marketplace list/add/remove/search. A managed
  marketplace install and remote refresh remain deliberately blocked without a
  controlled remote artifact source.
- [x] `providers` (2): `list`, `models`.
- [x] `status` (1): `get` (global empty-context shape and entity-context aggregation).
- [-] `system` (10): `attention`, `config`, `executionOptions`, `reloadConfig`,
  `transcribeVoice`, `updateExperiments`, `updateGeneralSettings`,
  `updateKeyboardSettings`, `usageLimits`, `version`. Nine methods passed live,
  including no-op round trips for current general/keyboard settings. Empty
  transcription now rejects client-side, direct HTTP returns `400
invalid_request`, and the host stays connected after `P1-E2E-009`; successful
  transcription is unavailable because voice transcription is disabled here.
- [x] `theme` (3): `get`, `catalog`, `set` (object and compatibility-string
      overloads count as one callable method).
- [x] `threadSections` (4): `create`, `delete`, `list`, `update` in a disposable empty section.
- [-] `threads` root (27): `archive`, `archiveAll`, `childSummary`,
  `conversationOutline`, `defaultExecutionOptions`, `delete`, `get`, `list`,
  `markRead`, `markUnread`, `open`, `output`, `pin`, `promptHistory`,
  `reorderPinned`, `search`, `send`, `spawn`, `stop`, `timeline`,
  `timelineTurnSummaryDetails`, `storageFiles`, `storagePaths`, `unarchive`,
  `unpin`, `update`, `wait`. Live passes: `get`, `list`, `childSummary`,
  `conversationOutline`, `defaultExecutionOptions`, `output`, `promptHistory`,
  `search`, `timeline`, `timelineTurnSummaryDetails`, `storageFiles`,
  `storagePaths`, and `wait`; slot-fixture lifecycle results are folded in when
  its worker completes. Destructive archive/delete/send/stop operations are not
  applied to an active worker fixture.
- [x] `threads.events` (2): `list`, `wait` (38 persisted events and a bounded 204/no-event wait).
- [-] `threads.interactions` (5): `cancel`, `get`, `list`, `resolve`, `respond`.
  Live list passed; state transitions require an actual pending interaction and
  are exercised by the frontend-slot fixture.
- [-] `threads.queuedMessages` (6): `create`, `delete`, `list`, `reorder`,
  `send`, `setGroupBoundary`.
  Live list passed; mutation is not applied to an active worker thread.
- [-] `threads.tabs` (2): `get`, `update`. Live get passed; update is covered by
  the thread-panel slot fixture rather than racing its current tab revision.
- [x] `terminals` (9): `close`, `create`, `get`, `input`, `list`, `output`,
      `rename`, `restart`, `resize`.
- [x] root realtime callable (1): `subscribe` live-smoked with
      `system:config-changed`, `realtime:connection`, unsubscribe, and socket close.
- [T] Realtime entity filters receive `thread:changed`, `project:changed`,
  `environment:changed`, `host:changed`, and general `system:changed` only for
  matching ids/changes; the live smoke covered the root connection/config event.

## Appendix B: exhaustive plugin host/runtime inventory

The live/focused matrix must account for all 17 backend roots and every nested
callable family: `pluginId`; `log.debug/info/warn/error`; `settings.define` and
handle `get/onChange`; `storage.kv.get/set/delete/list`, `database`, `migrate`;
`http.route`; schema-driven `rpc.register`; `realtime.publish`;
`background.service/schedule`; `cli.register`; `agents.configure`,
`registerTool`, and legacy `contributeInstructions`; `ui.requestInput`,
`registerThreadAction`, and `registerMentionProvider`; `events.on` for all four
thread events; `status.needsConfiguration`; `server.loopbackBaseUrl`;
`hosts.ensureSharedPortTunnel/declareSharedPorts`; complete `sdk`; and
`onDispose`.

Frontend inventory is likewise exact: runtime exports `definePluginApp`,
`useRpc`, `useRealtime`, `useRealtimeConnectionState`, `useSettings`,
`useBbContext`, `useBbNavigate`, and `useComposer`; slots `homepageSection`, `settingsSection`, `navPanel`,
`threadPanelAction`, `composerAccessory`, `pendingInteraction`,
`sidebarFooterAction`, `fileOpener`, and `messageDirective`.

## 14. Security and data boundaries

- [T] Plugin HTTP auth modes enforce their intended caller boundary; token auth is additionally live-verified.
- [T] RPC, settings, realtime, panel params, interactions, and KV reject unsafe/non-JSON values.
- [T] Secret settings never appear in list/config/frontend/log/error payloads.
- [x] File writes, moves, removes, previews, logos, and Docs paths cannot escape configured roots (live traversal/root probes plus focused symlink tests).
- [x] Docs/GitHub JS and CSS assets return correct content types, immutable caching, and bundle-hash URLs.
- [T] Untrusted directive, mention, RPC, and marketplace data is validated at ingress.
- [T] Removing/reloading a plugin does not leave live handlers or access to stale credentials.
- [T] External scaffold compiles with strict checking and no workspace package access.
- [T] Managed artifact metadata/identity/hash mismatches are refused before activation.

## 15. Accessibility, responsive layout, and themes

- [x] Visible interactive controls on Plugins settings, Docs, and GitHub have non-empty accessible text/labels in the live DOM audit.
- [T] Keyboard-navigation contracts cover tabs, menus, dialogs, panel actions, and editor controls; live tab/action buttons exposed semantic roles and labels.
- [T] Focus-return behavior after dialog close, action completion, and navigation is covered by focused UI tests; live composer focus was exercised.
- [x] Exercised loading, empty, error, disabled, and incompatible states remained readable; needs-configuration announcement is focused-test covered.
- [x] Compact viewport keeps Plugins settings, Docs, and GitHub panels within the viewport with reachable, named primary controls.
- [T] Responsive dialog/drawer behavior is covered by the shared responsive primitives; no plugin-specific divergence was observed at 390x844.
- [x] Default, Nord, and Dracula modes retained readable plugin UI; roomy branding switched through the shared theme-aware logo path.
- [T] Built-in palette token invariants cover Default, Nord, Dracula, Solarized, Gruvbox, and Catppuccin; Default/Nord/Dracula were also live switched and restored. No custom theme is installed in this isolated data directory.
- [-] Reduced-motion and browser-zoom visual inspection is deferred to manual UX QA; no automated semantic failure was observed.

## 16. Restart, recovery, and cleanup

- [x] Server restart restores enabled plugins, settings, inventory, and frontend contributions; persistent schedule/storage restoration remains focused-test covered.
- [x] Browser reconnect after restart recovers plugin surfaces; a fixture pulse after reload delivered exactly once without duplicate subscription.
- [T] Failed plugin reload preserves the last-known-good runtime and assets.
- [T] Plugin disable during in-flight HTTP/RPC/background/interaction work drains or aborts safely.
- [T] Removing a plugin clears runtime registrations and secret material according to policy; settings cleanup was additionally live verified.
- [x] Final cleanup removed the fixture plugin, project, six threads, temporary marketplace, disposable Docs vaults/settings, GitHub extra-repo setting, and both `/private/tmp` source roots. The original seven plugins remain running and only `bb-official` remains configured.
- [x] One accidental duplicate dev supervisor/retry loop was stopped; the single healthy app/server/daemon stack and remote share remain running at handoff.

## Bug catalog

| ID           | Severity  | Status                           | Area                              | Reproduction and expected behavior                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------ | --------- | -------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `P1-E2E-001` | High      | Fixed, live verified             | Browser SDK fetch integration     | Settings -> Plugins reported zero installed and builtin plugin detail routes said “not installed” while the API reported seven healthy plugins. App query helpers passed unbound native `window.fetch` into the SDK; later invocation lost its Window receiver, threw, and helpers collapsed to empty/null. The shared browser plugin client now binds fetch and focused tests cover list/settings/marketplace queries.             |
| `P1-E2E-002` | Medium    | Fixed, CLI verified              | Install JSON output               | `plugin install --yes --json` printed human trust text before its JSON document, breaking machine consumers. Human warnings are now suppressed only in JSON mode and output tests guard the contract.                                                                                                                                                                                                                               |
| `P1-E2E-003` | Medium    | Fixed, CLI verified              | Targeted reload semantics         | `plugin reload <unknown-id>` returned success and targeted reload human output could print unrelated plugins. Unknown ids now fail with exit 1/structured error and targeted output is filtered to the requested id.                                                                                                                                                                                                                |
| `P1-E2E-004` | High      | Fixed, focused verified          | GitHub PR pagination              | PR file and review-comment RPC used one `per_page=100` response, silently truncating larger pull requests. It now uses `gh api --paginate --slurp`, validates the page envelope, and flattens every page before mapping.                                                                                                                                                                                                            |
| `P1-E2E-005` | Medium    | Fixed, CLI verified              | GitHub CLI argument validation    | GitHub plugin CLI accepted extra arguments and malformed repository selectors that could broaden or misdirect a query. Each subcommand now rejects surplus args, `repos`/`sync` reject args entirely, and issue/PR repositories require `owner/repo`.                                                                                                                                                                               |
| `P1-E2E-006` | Medium    | Fixed, focused/live verified     | Docs HTTP validation              | Invalid JSON now returns `400 invalid_json`; schema/path/traversal failures return `400 invalid_input` with safe issue paths instead of HTTP 500. Focused Docs tests and disposable `/tmp` HTTP probes cover the mapping.                                                                                                                                                                                                           |
| `P1-E2E-007` | Low       | Fixed, focused/live verified     | Docs directory removal            | `bb docs remove` now removes files and empty directories; non-empty directories require explicit `--recursive`. Vault-root and traversal protections remain intact.                                                                                                                                                                                                                                                                 |
| `P1-E2E-008` | High risk | Product-policy decision required | Dev-data filesystem isolation     | The isolated BB data directory does not isolate plugin host-file sources: the Docs default vault still points at the real host Personal Docs path. No default-vault file was opened or mutated. Automatically rewriting this path could break the product's deliberate host-filesystem model, so the acceptance plan requires an explicit isolation policy rather than silently changing production behavior.                       |
| `P1-E2E-009` | Critical  | Fixed, live/focused verified     | Voice transcription host protocol | `system.transcribeVoice()` accepted an empty `Blob`, the server emitted a host-RPC command with empty `audioBase64`, and host-daemon parsing shut down the only connected host. The SDK now rejects before I/O, the server independently returns `400 invalid_request`, and identifiable malformed host commands return `invalid_command` without disconnecting. The exact SDK and direct-HTTP cases leave the live host connected. |

## Harness correction

Agent shells export `BB_CLI` to the daemon-managed installed binary. The
current-branch CLI intentionally re-executes that binary unless `BB_CLI` is
unset, which can create false cross-version failures while testing a worktree.
Every CLI result in this plan is run after `eval "$(scripts/bb-dev-app env)"`
and `unset BB_CLI`. Earlier `displayName` and popout-settings CLI failures from
the installed binary are excluded from the bug catalog; the browser failure is
independent and reproducible.

## Final acceptance

- [x] Every planned item is pass, explicitly blocked, or linked to a cataloged bug.
- [x] Every fixed bug has a focused regression test and a live-browser/API/CLI verification.
- [x] Generated declarations/templates remain current; the overnight fixes did not change public declarations.
- [x] Focused typechecks/tests pass without a resource-heavy broad local run.
- [x] One GPT-5.6 Sol high read-only review found no code, security, privacy, protocol, version, cleanup, or evidence blocker. Its sole `REQUEST CHANGES` was that the reviewed local commits had not yet been pushed; this was resolved by the final push without a second review round.
- [x] Consolidated branch is pushed; PR #716 remains open and unmerged.
