# UI code splitting

Use `apps/app/src/lib/define-split.tsx` for every app UI boundary. This is an
app-local contract, not a Plugin SDK API. App code sorts into three tiers:

| Tier      | What belongs here                                                       | Mechanism                          |
| --------- | ----------------------------------------------------------------------- | ---------------------------------- |
| Core      | What the first paint of the boot shell or a page needs                  | Static imports                     |
| `preload` | Common UI that is not visible at first paint, such as the right panel   | `defineSplit({ tier: "preload" })` |
| `intent`  | Rare UI, such as customization, setup dialogs and context-menu contents | `defineSplit({ tier: "intent" })`  |

The router's page components in `App.tsx` stay plain `React.lazy`: they suspend
into the shared route boundary that marks route content painted, and a
per-component boundary would mark it before the page loads.

## Declare a boundary

Keep a small wrapper beside the heavy implementation. Other app modules import
the wrapper. Keep skeletons, shared types, and lightweight helpers out of the
heavy implementation's runtime exports.

```tsx
export const Editor = defineSplit({
  id: "document-editor",
  load: () =>
    import("./DocumentEditor").then((module) => module.DocumentEditor),
  loading: (props) => <EditorSkeleton title={props.title} />,
  tier: "intent",
});
```

The returned component accepts the implementation's props and owns its Suspense
and error boundaries. `loading` receives those props. An optional `error`
component receives the props plus `retry`. The default error UI is one red line with an inline Try again action;
customize it when a panel needs structural layout or a feature
needs a close button. Loading and error components must themselves be lightweight.

Prefer real surrounding controls, stable dimensions, and minimal loading content.
Use simple abstract skeleton bars or blocks without imitating individual controls.
Preserve established loading skeletons when migrating existing splits, including
those shared with a renderer's worker or data-loading stage. Footer customization
keeps its real header and Done button and reserves the expected content height
with a simple skeleton bar, without fake icons or rows.

The loader is shared between speculative preload and rendering, including automatic
retries. Recognized browser JavaScript chunk-download failures get two
additional attempts after 500 ms and 1500 ms; the loading UI stays visible until
success or exhaustion. Other loader errors, CSS-preload errors (retrying can
skip the failed stylesheet and render an unstyled feature), and component render
errors fail immediately. There is no retry loop or URL rewriting. Try again
starts a fresh bounded attempt with a new lazy component, but the browser's
module cache can still keep a failed download or stale deployment URL failing.
Errors thrown while rendering the loaded subtree are contained locally.

A Vite preload error triggers recovery only for a recognized JavaScript chunk
**download** failure. This covers route imports as well as `defineSplit` loads.
Recovery then fetches `/` without the HTTP cache and compares the deployed
entry script URL with the one the running document loaded. Entry filenames are
content-hashed and the entry references every lazy chunk by filename, so any
rebuilt chunk changes the entry URL. Only a different entry URL triggers a
reload; nothing is requested at startup. The app flushes unsent composer drafts
to local storage before reloading, then records the target entry URL in
`sessionStorage` and reloads once. Concurrent failures share one check; the
guard survives navigation and prevents another reload to the same entry, for
example when the reload still serves the stale document. A later deployment can
recover independently. Recovery leaves the error visible when the index fetch,
session storage, or draft persistence fails. Failures while the same entry is
deployed, stylesheet failures, module evaluation errors, and render errors never
trigger an automatic reload. This is not a general error handler.

Do not declare splits during render. Use a literal dynamic import path. Import
implementation types with `import type` or `typeof import(...)`; do not re-export
the implementation through a barrel imported by the shell.

## Tiers and mounting

| Tier      | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `intent`  | Load when rendered, or earlier on a trigger's pointer-enter, focus, or pointer-down.                                                                                                                                                                                                                                                                                                                                                                               |
| `preload` | Queued when the split is defined. The queue drains at browser idle (one-second timeout/fallback) once no critical load is pending: the route import, the current page's split, and any split being rendered. While the plugins that draw the thread list and sidebar navigation load first (bb's own until another plugin has drawn them), it also waits, for at most ten seconds, until plugin frontends have loaded. Intent and rendering still load it earlier. |

Wire intent on the actual trigger:

```tsx
<button {...Editor.intentProps} onClick={openEditor}>
  Open editor
</button>
```

If a trigger already handles one of those events, compose the handlers instead
of overwriting one. `.preload()` is an explicit, safe warm-up available in any
tier; it catches speculative failures, leaving rendering able to try again.
Use it from an explicit owner for data demand or related features, such as
warming panel tab code when the right panel opens.

A preload-tier split needs no registration: defining it queues it, and
`RouteContentPaintSignal` in `App.tsx` starts the queue with
`startSplitPreloading()`, and marks route content painted only after critical
loads settle. On pages with expected surface providers (including the plugin
that owned the open thread panel tab last session) or a plugin panel, the plugin runtime download and shared plugin-list query start alongside system
config. Priority plugin bundles and styles preload as soon as the list resolves.
Activation still waits for system config. Pages without expected providers or a plugin panel
retain deferred boot after route paint and browser idle, with a 1.5-second
fallback. Plugin activation does not wait for the toaster to mount; startup
notifications queue until it attaches, including custom plugin toasts.
SDK Markdown, source-code, and diff wrappers use preload-tier splits. After
plugin registration settles, the app also queues the selected built-in source
and diff implementations on the same idle queue. A plugin replacement leaves
the corresponding built-in implementation cold unless it delegates to Original;
changing selection before idle cancels the obsolete warm-up. Rendering before
warming completes uses the existing skeleton and shares the pending import.
SDK diff/source and timeline diff entry components start the selected built-in
module and request its workers while their outer module is still loading.
Idle warming imports the lightweight split definitions statically and preloads
the implementations directly; it does not start workers. Worker readiness
remains a separate loading state.

Plugin builds record shared runtime dependencies in `app.meta.json` as
`runtimeSlots`. Before evaluating a bundle, the frontend matches those slots
against `lazyRuntimeGroups` and loads the matching groups in parallel while
preloading the bundle itself. Each group shares a cached, retryable loader.
Pierre's core and React bindings form the first lazy group; other runtime slots
remain eager. Older bundles without dependency metadata receive all slots for
compatibility. SDK component splits remain separate from this mechanism:
runtime slots must be installed before a plugin module evaluates, while SDK
components can load when rendered or warmed at idle.

Splits defined by modules that load later (a route
chunk, for example) join the queue and drain at the next idle period. Tests do
not start the queue, so defining a split never triggers a speculative import
there.

`.preload()` uses dynamic import: it downloads, parses, compiles and evaluates
the module graph. An idle callback only schedules its start; it cannot guarantee
that later evaluation happens while the main thread is idle. Download-only
prefetch defers parsing and execution until use, trading less speculative CPU
work for a slower first interaction. `modulepreload` parses/compiles early but
defers evaluation.

For download-only warming, register the split ID and implementation path with
`splitPrefetch` in `vite.config.ts`, and call `queueSplitDownload(id)` at module
scope in the owning page. The build embeds its hashed asset URLs and static
dependencies as inert JSON in the HTML, and the download joins the preload
queue. It makes low priority fetches into the HTTP cache without importing
modules; the real split stays in the `intent` tier. IDs must uniquely identify a
split. An import already started suppresses speculative downloads; an import
that follows a pending download waits for its bytes, avoiding duplicate
transfers. Asset responses must be cacheable for subsequent imports to reuse
them. BB serves hashed assets with immutable caching. Development HTML has no
manifest, so dev servers retain demand loading. This is currently used for
Markdown's sanitized HTML pipeline on workspace routes and queued messages when
a thread view mounts.

Mount gating is part of the split. `mountWhen(props)` keeps the implementation
unmounted until it returns true, rendering `unmounted` (default nothing) in the
meantime. With `keepMounted: true`, a split stays mounted after `mountWhen`
turns false again, so closing preserves its state. Downloading never mounts:
preload does not render hidden UI or run its effects.

Keep the existing persistent responsive drawer's deferred realization and
retained content. Avoid rendering a split merely to preload it.

## Enforce the boundary

Add the heavy source module to `splitBoundaries` in
`apps/app/bundle-budget.json`, listing `boot` and any measured page journey
(`ThreadPage`, `NewThreadPage`, `PluginFrontend`) from which it must remain
absent. A journey is the union of its lazy entry chunks' static closures beyond
the boot payload: what that page waits for after the shell paints. The checker uses actual emitted module
membership, including modules bundled into shared chunks without a facade.
Missing modules fail so deletion or renaming requires an intentional guard edit.

This protects the specified module, not every transitive dependency. Keep
`forbiddenBootPackages`, per-route forbidden packages, and `onDemandPackages`
for the heavier dependency contracts. Shared dependencies may legitimately be
used by other features; do not forbid them globally without checking those uses.

Build and check through:

```sh
pnpm exec turbo run build --filter=@bb/app
node apps/app/scripts/check-bundle-budget.mjs
```

Verify a negative control: temporarily make the implementation eager in a
protected closure, rebuild, and require the checker to reject that module for
the intended reason. Restore the split and rebuild. Byte budgets alone cannot
prove that a feature is lazy. Moving code out of boot can increase the page
journey; report both. Shared chunks move between closures, so byte savings
from separate splits are not additive; build and check the combined result. Do
not increase limits to hide a regression.

## Review loading states

Use browser request interception against an isolated production build to hold or
fail the actual chunk download. Capture desktop and compact-width screenshots
of loading, failure, and loaded states. Temporary review stories and fixtures
belong in the review worktree, not the shipped change.

Keep code-loading and data-loading reviews separate: releasing the split may
reveal another loading state while the feature fetches data. Keep focus and
close controls usable, preserve panel geometry, and check the transition to
real content. Do not add artificial production delays for screenshots.

## Choosing a policy

- Startup: common UI on the owning page, such as the right-panel shell and the
  model menu on workspace routes.
- Idle: commonly used UI that is not needed for first paint, such as the
  command palette body. Idle warming still spends transfer, parse, and
  evaluation work on visits that never open the feature.
- Intent: explicit small targets such as picker and panel-toggle buttons. Never
  mount a component merely to warm it.
- Render or data demand: customization, content-dependent views, and optional
  timeline rows. Avoid speculative loads from hovering many rows while
  scrolling.
- A policy label alone does not make a hidden mounted component lazy: gate its
  first mount explicitly, then retain it where closing must preserve state.
- Start data fetching outside the code boundary so it runs alongside the import.
- Do not preload a built-in renderer that a plugin can replace completely.

## Lazy waterfall audit (October 2026)

The audit covered runtime dynamic imports, React lazy components, and
`defineSplit` entry points in `apps/app/src`, plus browser loaders in `plugins`.
Type-only imports and schema `z.lazy` calls are not loading boundaries.

| Path                                                                 | Finding and disposition                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SDK diff/source → built-in renderer                                  | Fixed: the mounted outer entry starts the selected built-in import in parallel with its adapter, even before startup warming. Registered replacements keep built-ins cold.                                                                                                                            |
| Timeline diff block → built-in diff                                  | Fixed with the same selection-aware early load.                                                                                                                                                                                                                                                       |
| Renderer → worker pool                                               | SDK and timeline entries now request workers alongside code; initialization still has to finish before highlighted output. Idle warming does not request workers.                                                                                                                                     |
| Idle renderer warming → split definition → renderer                  | Fixed: split definitions are lightweight static imports, with direct preload calls. Source split definition extracted from the host.                                                                                                                                                                  |
| Secondary panel → tab modules                                        | Existing outer wrapper preloads tab modules while the panel loads. Terminal module loading starts xterm and addons in parallel.                                                                                                                                                                       |
| File preview → source renderer; git tab → diff renderer              | Existing preview/tab components start renderer and worker loading while data loads. These preloads currently do not check replacement selection; that is unnecessary warming, not a serial module wait.                                                                                               |
| SDK Markdown → HTML/math/Mermaid                                     | Residual content-dependent cold paths: the outer Markdown module must load before these features are detected. HTML and math can potentially be predicted from SDK content earlier; Mermaid visibility/render policy needs preserving. Idle warming reduces exposure but does not remove these waits. |
| Workspace route → thread/root view                                   | Fixed: the existing AppRoutes effects start destination modules alongside the workspace module. Held-request browser verification is recorded below.                                                                                                                                                  |
| SDK thread chat → thread query → environment query                   | Module-to-data wait remains; environment ID genuinely depends on thread data. The known thread ID could support fetching thread data alongside the outer module.                                                                                                                                      |
| Monaco plugin CSS → editor JavaScript                                | Existing serial independent asset requests in `plugins/monaco-editor/lib/monaco-loader.ts`. Start both together, still awaiting CSS before editor creation, in a focused plugin change.                                                                                                               |
| Menus, settings, onboarding, external-file dispatch, queued messages | Conditional entry points remain lazy. No additional unconditional module-to-module sequence identified in their loaders. Child features may still depend on data or subsequent interaction.                                                                                                           |

The audit is a source review, not a claim that every route and plugin is free
of network waterfalls. The SDK regression test holds adapter downloads open
and requires renderer downloads and worker requests to start before resolving
them; it also checks that plugin replacements suppress those requests.

### Core-route verification

`AppRoutes` owns route-specific code preparation through the existing
`useRouteState` matcher. `AppLayout` owns the thread bootstrap observer, including
parallel timeline prefetch and realtime subscription. The loaded thread view
reuses those query keys and ingested thread/environment/host data. No additional
route preparation layer is needed for these two paths.

In a production-build mobile-viewport check with browser cache disabled and the
workspace module response held for 1.5 seconds:

| Destination     | Required work started                                   | Workspace response completed |
| --------------- | ------------------------------------------------------- | ---------------------------- |
| New thread      | Compose module at 78 ms                                 | 1,539 ms                     |
| Existing thread | Bootstrap and timeline at 68 ms; thread module at 72 ms | 1,529 ms                     |

These timings demonstrate request independence under an artificial hold, not a
performance improvement or representative load-time benchmark. The inactive
view warmed only after the held critical load completed. The route regression
test holds workspace loading unresolved, verifies destination module requests,
and checks that new-thread startup does not request the thread view. Removing
the existing route-preload effects makes it fail.

### Composer startup follow-up

The bootstrap hook now observes thread execution defaults and queued messages
alongside bootstrap and timeline. The prompt area shares these queries. A late
observer reuses the active owner's baseline; the first observer after a
zero-owner interval refreshes stale data. Realtime invalidation still refetches
active queries, queue focus refresh remains enabled, and unresolved execution
defaults still gate sending.

The existing new-thread route preload effect also prefetches unscoped environment
and machine provider catalogs using the same query options as the composer.
Project-specific catalogs still wait for selection. Hosts already have an early
consumer; model/execution catalogs retain their scope-dependent resolution.
Terminals, file previews, and unopened panels retain their existing demand policy.

A production-build Chromium check used a fresh isolated server store, disabled
browser cache, cleared local/session storage, a 390×844 mobile viewport, and the
existing `bb.onboarding.seen=1` preference. Requests for system config and the
destination module were held unresolved; the existing-thread run also held
bootstrap. The thread was a synthetic scheduled thread with no provider turn.

| Destination     | Work requested while prerequisites were held                                                   | Held requests released |
| --------------- | ---------------------------------------------------------------------------------------------- | ---------------------- |
| New thread      | Environment/machine catalogs at 105 ms; plugin list/runtime at 106 ms                          | 2,578 ms               |
| Existing thread | Defaults/queue at 116 ms; bootstrap and plugin list/runtime at 117 ms; thread module at 118 ms | 2,585 ms               |

Each unscoped catalog, thread defaults, and queue request occurred once through
composer mounting after release. Both composers rendered, and the existing thread
showed its scheduled queue. These are request-order observations under artificial
holds, not representative performance measurements. Chromium mobile emulation
is not iOS Safari verification.

Without the recognized onboarding preference, a separate run confirmed that
OnboardingGate withheld routes until config resolved, even on the configured test
server. Plugin list/runtime and priority bundles still downloaded during that
hold. Changing onboarding rendering policy remains separate work.

The regression tests hold config, workspace code, or bootstrap unresolved and
require independent work to begin. Restoring each former prerequisite gate makes
its test fail. Query ownership coverage also checks late consumers, realtime
invalidation, reopening, and disabled routes; reverting the mount policy detects
duplicate fetches.

The same controlled hold was subsequently run against baseline `612383411c`:

| Request                            | Before   | After  |
| ---------------------------------- | -------- | ------ |
| New-thread plugin runtime          | 2,616 ms | 106 ms |
| Existing-thread plugin runtime     | 2,607 ms | 117 ms |
| New-thread unscoped catalogs       | 2,932 ms | 105 ms |
| Existing-thread defaults and queue | 2,945 ms | 116 ms |

Baseline holds released at 2,585 ms (new) and 2,584 ms (existing). The plugin
list already started at 124/123 ms through another consumer on these routes;
the hook change removes its own config dependency but establishes no measured
route-level improvement for that request.

Production build sizes (KiB Brotli) moved from 378.2 to 381.0 for boot,
165.2 to 162.1 for PluginFrontend beyond boot, 452.7 to 450.0 for ThreadPage,
and 223.0 to 219.8 for NewThreadPage. Earlier query imports shift approximately
2.8 KiB into boot. Closure sizes overlap and must not be added together as savings.
