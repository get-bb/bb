# UI split loading-policy audit — 2026-09-29

Scope: app-owned runtime imports in `apps/app/src`, excluding type imports,
stories, tests and plugin-provided URLs. This covers the shared-helper migration
and the four new boundaries. Decisions below are based on code, emitted module
graphs and observed requests, not usage telemetry. `render` means the first
actual mount, which may be caused by restored state or search as well as a click.

## Rules chosen

- Startup: warm the right-panel shell and model menu when the workspace route mounts.
- Idle: warm command-palette code after paint. This favors
  fast first use; it still spends transfer, parsing and evaluation work on visits
  where those features remain closed. Customization stays on demand.
- Intent: explicit small targets such as picker and panel-toggle buttons.
  Warm on pointer enter, focus or pointer down; never mount merely to warm.
- Render/data demand: use for content-dependent views and optional timeline rows.
  Avoid speculative loads triggered by hovering many rows while scrolling.
- Retain UI after first opening when closing must preserve its state. Rendering
  a hidden lazy component is still a download; gate its first mount explicitly.
- Keep data fetching outside a code boundary when it can run alongside the import.
- Do not preload a built-in renderer when a plugin completely replaces it.

## Shared UI boundaries

| Boundary                                                    | Chosen trigger and gate                                                                                              | Rationale / nested loads                                                                                                                                                                                                |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Footer customization                                        | Render only after Customize footer is selected                                                                       | Rare settings action with a usable header/Done and a small skeleton. Hovering More is not sufficiently specific intent.                                                                                                 |
| Sidebar visibility customization                            | Render when customization opens                                                                                      | Same decision as footer. Preserve Done/Back/Escape and list dimensions.                                                                                                                                                 |
| Secondary-panel shell                                       | Startup from SplitWorkspaceRoute, plus intent on panel toggles; mount on first open and retain                       | Warm the shell on compose/thread/plugin workspace pages without mounting hidden content. Register inside the route to keep resizable-panel dependencies out of boot. Compact drawers retain their deferred realization. |
| Browser deck                                                | Preload when the right panel opens; mount when a browser tab is first selected; retain                               | Code warming must not mount hidden browser views. Its eager lifecycle observer still cleans up persisted native views.                                                                                                  |
| Terminal panel                                              | Preload when the right panel opens; mount when terminal content is realized                                          | The terminal component warms alongside other panel tabs. xterm and add-ons still wait for actual terminal initialization.                                                                                               |
| New-tab page                                                | Preload when the right panel opens; mount when a new-tab surface is shown                                            | Warm common tab actions ahead of selection; retain the existing panel skeleton for cold opens.                                                                                                                          |
| Workspace/host/host-scoped/project/thread-storage file tabs | Warm with the shell on workspace page load; mount the selected wrapper                                               | All five exports share a module with GitDiffTabContent, which the shell imports. Opening the panel also explicitly warms these wrappers.                                                                                |
| FilePreview                                                 | Warm with the shell on workspace page load; mount when a preview is needed                                           | The shell’s shared Git-diff module reaches FilePreview. Code renderers, workers and data requests remain type/demand-dependent. A plugin replacement still avoids BB rendering code.                                    |
| Thread storage tree                                         | Data demand: nonempty storage paths cause the model hook to import the tree; the view mounts when the model is ready | The existing model loader is already the first import. The UI wrapper is not the only gate. Empty storage does not load the tree. Preserve this ordering because constructing the model requires its library.           |
| Timeline file diff                                          | Render when the file-change body's expansion logic requests it                                                       | Keep parsing and rendering code off collapsed rows. There is a later DiffHost/Pierre worker stage; retain its skeletons. Warming the built-in renderer eagerly would penalize plugin replacements.                      |
| BbDiff / BbSourceCode                                       | Render only when BB's renderer is selected or a plugin delegates to Original                                         | A replacement that never uses Original must not download BB rendering code. Worker initialization follows actual renderer demand and has its own fallback.                                                              |
| Timeline terminal output                                    | Render only for expanded command output, including search-driven expansion                                           | Full-output fetching stays outside the lazy renderer, parallel with the import. ansi-to-html and its legacy entity tables are one optional chunk. No timeline-wide idle or hover warming.                               |
| Queued messages                                             | Idle download when a thread view mounts; render on a nonempty queue, pending queue summary, or inline edit             | Thread routes and split panes prefetch the chunk without evaluating it. Pending details warm the import while data loads; empty queues do not mount it. There is no single reliable pointer trigger because queues can appear remotely. |
| Model menu                                                  | Workspace-page mount, or a standalone picker shell mounting                                                          | Common UI gets early warming. Trigger, shortcuts, state, provider tabs and input stay eager; preserve typing and keyboard selection during a cold download.                                                             |
| Command palette body                                        | Idle after its eager shell mounts, or earlier first open                                                             | Warm common keyboard UI after paint. Input, Escape and focus stay eager; thread-search mode keeps its separate chunk.                                                                                                   |

## Existing boundaries outside the migration

These were inspected, not mechanically converted to `defineSplit`. Their existing
loading/error contracts remain in place; the new helper retry policy does not
silently change these loaders.

| Boundary                                                          | Existing policy retained                                                                              | Reason / explicit tradeoff                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SplitWorkspaceRoute                                               | Starts its import when App's module evaluates                                                         | Primary thread/compose route begins downloading alongside shell work. This also downloads on settings-only visits. Route-aware warming is a separate routing optimization; the optional-feature audit does not move the primary route behind an extra scheduling delay. |
| Settings, project settings, machine settings, tools/skills routes | React.lazy on route render                                                                            | Selected page is demand; loading every settings page at startup is unnecessary. Several tools exports share one module.                                                                                                                                                 |
| Plugin detail and plugin-panel hosts                              | React.lazy when that pane/route renders                                                               | Plugin panels are independently selected; retain existing pane fallback.                                                                                                                                                                                                |
| Thread-search palette mode                                        | React.lazy when search mode opens                                                                     | Separate from command-mode results. Typing in the palette is not permission to fetch every search implementation.                                                                                                                                                       |
| Plugin file context menu                                          | React.lazy after context menu opens                                                                   | Ordinary links remain lightweight; a visible menu is specific demand.                                                                                                                                                                                                   |
| External-file dispatcher                                          | React.lazy while an external-open request is queued                                                   | The queued request is the activation signal; no visible generic loading shell is needed.                                                                                                                                                                                |
| Plugin frontend runtime                                           | Immediate on a plugin-panel URL after config; otherwise after route paint/idle, with existing timeout | Plugin registrations power navigation, commands and slots, so this is required background initialization rather than an optional menu.                                                                                                                                  |
| Plugin URL imports                                                | Plugin runtime's enabled-module lifecycle                                                             | Dynamic remote modules have their own trust/version/registration contract; do not rewrite URLs for retry.                                                                                                                                                               |
| Pierre worker pool                                                | First renderer request                                                                                | Already demand-driven, shared and reference-counted. Failure falls back to main-thread rendering.                                                                                                                                                                       |
| Code-theme registration                                           | When code-theme consumers request registration                                                        | Kept with code rendering, not global shell preloading.                                                                                                                                                                                                                  |
| xterm and addons                                                  | When the terminal view initializes; addon imports run together                                        | WebGL remains an optional capability path. Preserve terminal resource cleanup.                                                                                                                                                                                          |
| KaTeX                                                             | When rendered Markdown contains the math marker                                                       | No math means no renderer import. Existing per-loader failure handling remains separate.                                                                                                                                                                                |
| Mermaid                                                           | When a diagram component renders                                                                      | No global diagram preload. Existing loader caches a rejected promise; this is a separate retry-adoption follow-up, not covered by defineSplit.                                                                                                                          |

## Automatic retries in defineSplit

The shared import attempt stays pending across two delayed retries: 500 ms and
1500 ms after recognized download failures, at most three calls to the loader.
All mounted instances and speculative preloads share that attempt; they do not
start independent retry storms. The skeleton remains visible until success or
exhaustion. A subsequent manual Try again starts a fresh bounded attempt.

Recognized errors are the browser dynamic-JavaScript-module-download messages.
Other loader errors (including syntax/initialization failures), CSS-preload errors
and component render exceptions go directly to the local red error line. Vite
marks CSS dependencies as seen before loading them; automatically retrying its
CSS error can skip the failed stylesheet and falsely render a successful but
unstyled feature, so it is deliberately excluded.
Retries already started may finish after the requesting view closes, just as
imports cannot be cancelled. There is no automatic reload or cache-busting URL.

This is recovery where the browser permits another import, not a guarantee of
another network request. In our Chromium request-abort experiment, the browser
retained the failed module URL: delayed import attempts still ended at the local
error line, with only one actual request. A full reload recovered. Rewriting a
single chunk URL does not reliably recover its failed transitive dependencies,
and an automatic reload could discard interaction state.

References: [Vite load-error handling](https://vite.dev/guide/build#load-error-handling)
and [MDN dynamic imports](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import).

## Validation ownership

- `define-split.test.tsx`: bounded retry timing/exhaustion, deduplication across
  preload/render, manual retry and cached synchronous remounts. Automatic-retry
  tests fail on the original helper and pass with the repair.
- `split-demand.test.tsx`: page mount warms the shell without mounting it; panel
  opening warms all tab modules without mounting hidden views. Closing retains
  state. Disabling panel warming makes this test fail.
- `define-split.test.tsx` also covers idle scheduling with and without
  requestIdleCallback, cancellation, deduplication and synchronous cached mounts.
  Disabling idle scheduling makes both timing cases fail.
- `RootComposeRightPanelToggle.test.tsx`: pointer/focus intent still warms the panel,
  but mounting the toggle does not. This component-level test does not cover
  idle effects elsewhere in the parent page; production request capture does.
- Existing responsive-panel, browser-lifecycle and feature tests remain responsible
  for their own focus, tab, native-view, drawer and plugin contracts.
- Emitted-module and package guards measure the critical closures. They do not
  establish whether an idle effect downloads an optional chunk later; cold request
  capture is needed for that distinction.

## Combined result and verification limits

All four new boundaries are integrated with the retry and demand-gate changes.
The integrated build compared with the wave-2 base `fc92e220a6` measures:

| Payload                 | Raw bytes | Brotli bytes | Brotli change | New Brotli limit |
| ----------------------- | --------: | -----------: | ------------: | ---------------: |
| Boot                    | 1,489,954 |      368,769 |        −3,369 |          403,839 |
| Additional thread route | 2,127,197 |      577,459 |       −40,764 |          589,508 |

Raw limits are 1,640,415 boot and 2,163,849 route bytes. All four budgets were
ratcheted down by the integrated saving before review-scaffolding cleanup; they
remain unchanged after cleanup and the common-UI warming follow-up. Per-child gains
are not additive because
shared chunks move between closures. The later skeleton correction is included.

The integration run passed 204 focused tests. After narrowing retry to
JavaScript download failures, all 13 shared-helper tests passed. The panel policy
checks passed 61 tests across the demand gate, responsive layout, headers and
plugin panel. Subsequent cleanup removed the unused scheduler and preview
provider, replacing forced-preview tests with held/rejected module imports.
The focused cleanup run passed 88 tests; 16 additional tests passed after
updating existing picker setup and the palette anatomy source path. Independent
mutations confirmed the old and replacement tests catch missing host fallbacks,
broken sidebar close controls and lost model queries. Build, typecheck, lint and
the bundle check passed.

The common-UI warming follow-up passed 170 focused tests plus build, typecheck,
lint and the unchanged bundle budgets. Disabling idle scheduling or panel-open
warming made the corresponding tests fail. Existing drawer tests now flush all
callbacks per animation frame; plugin identity tests resolve their mocked file
modules before concurrent warming to avoid Vitest returning actual exports for
simultaneous imports of the same mocked module.

On the isolated production app, the palette downloads after paint and the panel
shell on workspace-page mount. The shell also fetches its shared Git-diff/file
preview dependencies and dnd-kit. Opening the panel requests BrowserTabDeck,
ThreadTerminalPanel and NewTabPage together without mounting inactive views.
Neither xterm nor the BB code renderers start merely from this warming. The
empty root fixture has no model picker; its startup import is initiated by the workspace route even before a picker is
shown. Standalone pickers also register startup warming; imports are shared. Customization, queue
and terminal-output chunks remain absent from this cold root visit.

The request-abort retry check used the real sidebar module on the Ladle server.
Phone-width checks used Chromium and verified the app root stayed free of inert
and aria-hidden. Native browser views and iOS Safari were not reverified in this
audit. The drawer realization mechanism itself was preserved.

## Bundle follow-up

- Markdown HTML: fetch the parser/sanitizer's bytes at workspace idle without
  importing them. Parse and execute only when HTML-enabled Markdown contains
  `<`. A cold first use preserves safe Markdown text with a small skeleton;
  the sanitizer remains mandatory. Fetch failures do not poison the module
  cache; the ordinary split loader owns actual import retries.
- Thread detail: load on thread demand. AppRoutes starts the import immediately
  on thread URLs, alongside the workspace route, including direct visits.
  New-thread and plugin-only pages do not import the thread detail screen.
- Plugin SDK ThreadChat: load when a plugin renders it. Its props and public API
  are unchanged. Registration alone no longer imports the conversation renderer.
  The SDK runtime closure is measured for split-boundary checks as PluginFrontend.
