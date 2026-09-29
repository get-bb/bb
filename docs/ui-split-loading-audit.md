# UI split loading-policy audit — 2026-09-29

Scope: app-owned runtime imports in `apps/app/src`, excluding type imports,
stories, tests and plugin-provided URLs. This covers the shared-helper migration
and the four new boundaries. Decisions below are based on code, emitted module
graphs and observed requests, not usage telemetry. `render` means the first
actual mount, which may be caused by restored state or search as well as a click.

## Rules chosen

- Startup: only code required for the initial page or essential plugin runtime.
- Idle: not a default for optional UI. Moving bytes off the critical path while
  downloading them on every visit does not save transfer or evaluation work.
- Intent: explicit small targets such as picker and panel-toggle buttons.
  Warm on pointer enter, focus or pointer down; never mount merely to warm.
- Render/data demand: use for content-dependent views and optional timeline rows.
  Avoid speculative loads triggered by hovering many rows while scrolling.
- Retain UI after first opening when closing must preserve its state. Rendering
  a hidden lazy component is still a download; gate its first mount explicitly.
- Keep data fetching outside a code boundary when it can run alongside the import.
- Do not preload a built-in renderer when a plugin completely replaces it.

## Shared UI boundaries

| Boundary | Chosen trigger and gate | Rationale / nested loads |
| --- | --- | --- |
| Footer customization | Render only after Customize footer is selected | Rare settings action with a usable header/Done and a small skeleton. Hovering More is not sufficiently specific intent. |
| Sidebar visibility customization | Render when customization opens | Same decision as footer. Preserve Done/Back/Escape and list dimensions. |
| Secondary-panel shell | Intent on compose/thread/window/plugin panel toggles; mount only on first open; retain afterwards | **Changed:** removed compose's blanket idle preload. Closed desktop panels retain only their lightweight resizable shell, and compact drawers keep their existing deferred realization. The old idle load fetched dnd-kit even on a page with no queue. |
| Browser deck | Render when a browser tab is first selected; retain after that | **Changed:** mounting the shell or a non-browser tab no longer imports the browser renderer. Its independent eager lifecycle observer still cleans up persisted native browser views. Intent on the generic panel toggle must not fetch every possible tab implementation. |
| Terminal panel | Render when the terminal tab content is realized | A restored active terminal is real demand. xterm and add-ons remain deferred until the terminal view starts. No page-wide terminal preload. |
| New-tab page | Render when a new-tab surface is shown | Opening the panel does not imply opening a new tab. Keep the established panel skeleton. |
| Workspace/host/host-scoped/project/thread-storage file tabs | Render the selected file-tab wrapper | These five exports share one module. FilePreview is a further data/type-dependent stage. Do not warm every possible file viewer from a generic file-list hover. |
| FilePreview | Render when a file preview is needed | After content/type is known, a code file may request SourceCodeHost. Preserve plugin replacement and non-code paths; preloading the built-in editor for every file would defeat these gates. |
| Thread storage tree | Data demand: nonempty storage paths cause the model hook to import the tree; the view mounts when the model is ready | The existing model loader is already the first import. The UI wrapper is not the only gate. Empty storage does not load the tree. Preserve this ordering because constructing the model requires its library. |
| Timeline file diff | Render when the file-change body's expansion logic requests it | Keep parsing and rendering code off collapsed rows. There is a later DiffHost/Pierre worker stage; retain its skeletons. Warming the built-in renderer eagerly would penalize plugin replacements. |
| BbDiff / BbSourceCode | Render only when BB's renderer is selected or a plugin delegates to Original | A replacement that never uses Original must not download BB rendering code. Worker initialization follows actual renderer demand and has its own fallback. |
| Timeline terminal output | Render only for expanded command output, including search-driven expansion | Full-output fetching stays outside the lazy renderer, parallel with the import. ansi-to-html and its legacy entity tables are one optional chunk. No timeline-wide idle or hover warming. |
| Queued messages | Data demand: a nonempty queue, pending queue summary, or inline edit | Pending details warm the chunk while data loads; empty queues do not mount it. There is no single reliable pointer trigger because queues can appear remotely. |
| Model menu | Intent on the real trigger; render on first open | Trigger, shortcuts, state, provider tabs and search input stay eager. Preserve typed query and keyboard selection through the download; retain compact drawer content after first open. No idle preload for a menu that may never open. |
| Command palette body | Render when the palette first opens in command mode | Keyboard and native-menu entry points provide no earlier specific pointer intent. The eager shell preserves query text, Escape and focus. Thread-search mode keeps its separate existing chunk. Holding a general modifier key is too weak a signal to justify downloading the palette. |

## Existing boundaries outside the migration

These were inspected, not mechanically converted to `defineSplit`. Their existing
loading/error contracts remain in place; the new helper retry policy does not
silently change these loaders.

| Boundary | Existing policy retained | Reason / explicit tradeoff |
| --- | --- | --- |
| SplitWorkspaceRoute | Starts its import when App's module evaluates | Primary thread/compose route begins downloading alongside shell work. This also downloads on settings-only visits. Route-aware warming is a separate routing optimization; the optional-feature audit does not move the primary route behind an extra scheduling delay. |
| Settings, project settings, machine settings, tools/skills routes | React.lazy on route render | Selected page is demand; loading every settings page at startup is unnecessary. Several tools exports share one module. |
| Plugin detail and plugin-panel hosts | React.lazy when that pane/route renders | Plugin panels are independently selected; retain existing pane fallback. |
| Thread-search palette mode | React.lazy when search mode opens | Separate from command-mode results. Typing in the palette is not permission to fetch every search implementation. |
| Plugin file context menu | React.lazy after context menu opens | Ordinary links remain lightweight; a visible menu is specific demand. |
| External-file dispatcher | React.lazy while an external-open request is queued | The queued request is the activation signal; no visible generic loading shell is needed. |
| Plugin frontend runtime | Immediate on a plugin-panel URL after config; otherwise after route paint/idle, with existing timeout | Plugin registrations power navigation, commands and slots, so this is required background initialization rather than an optional menu. |
| Plugin URL imports | Plugin runtime's enabled-module lifecycle | Dynamic remote modules have their own trust/version/registration contract; do not rewrite URLs for retry. |
| Pierre worker pool | First renderer request | Already demand-driven, shared and reference-counted. Failure falls back to main-thread rendering. |
| Code-theme registration | When code-theme consumers request registration | Kept with code rendering, not global shell preloading. |
| xterm and addons | When the terminal view initializes; addon imports run together | WebGL remains an optional capability path. Preserve terminal resource cleanup. |
| KaTeX | When rendered Markdown contains the math marker | No math means no renderer import. Existing per-loader failure handling remains separate. |
| Mermaid | When a diagram component renders | No global diagram preload. Existing loader caches a rejected promise; this is a separate retry-adoption follow-up, not covered by defineSplit. |

## Automatic retries in defineSplit

The shared import attempt stays pending across two delayed retries: 500 ms and
1500 ms after recognized download failures, at most three calls to the loader.
All mounted instances and speculative preloads share that attempt; they do not
start independent retry storms. The skeleton remains visible until success or
exhaustion. A subsequent manual Try again starts a fresh bounded attempt.

Recognized errors are the browser dynamic-module-download messages and Vite's
CSS-preload error. Other loader errors (including syntax/initialization failures)
and component render exceptions go directly to the local red error line.
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
- `split-demand.test.tsx`: closed panel and inactive browser import neither module;
  first use loads only the requested surface, and closing retains panel state.
  It fails on the original eagerly mounted wrappers.
- `RootComposeRightPanelToggle.test.tsx`: pointer/focus intent still warms the panel,
  but merely becoming idle does not.
- Existing responsive-panel, browser-lifecycle and feature tests remain responsible
  for their own focus, tab, native-view, drawer and plugin contracts.
- Emitted-module and package guards measure the critical closures. They do not
  establish whether an idle effect downloads an optional chunk later; cold request
  capture is needed for that distinction.
