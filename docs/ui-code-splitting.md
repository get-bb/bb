# UI code splitting

Use `apps/app/src/lib/define-split.tsx` for every app UI boundary. This is an
app-local contract, not a Plugin SDK API. App code sorts into three tiers:

| Tier      | What belongs here                                                        | Mechanism                                       |
| --------- | ------------------------------------------------------------------------ | ----------------------------------------------- |
| Core      | What the first paint of the boot shell or a page needs                   | Static imports                                  |
| `preload` | Common UI that is not visible at first paint, such as the right panel    | `defineSplit({ tier: "preload" })`              |
| `intent`  | Rare UI, such as customization, setup dialogs and context-menu contents | `defineSplit({ tier: "intent" })`               |

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
success or exhaustion. Other loader errors and component render errors fail
immediately. There is no retry loop, automatic page reload, or URL rewriting.
A failed import clears the helper's promise cache after the attempts finish. Retry creates a fresh React lazy component,
so a rejected lazy instance does not permanently trap the feature in its error
state. Browser module caching can still prevent recovery from a failed download, module
evaluation, or stale deployment URL; use the browser reload in that case. A blocked
chunk request in Chromium demonstrated this: retry stayed local but required
a reload to recover. Errors thrown
while rendering the loaded subtree are also contained locally.

Do not declare splits during render. Use a literal dynamic import path. Import
implementation types with `import type` or `typeof import(...)`; do not re-export
the implementation through a barrel imported by the shell.

## Tiers and mounting

| Tier      | Behavior                                                                                                                   |
| --------- | -------------------------------------------------------------------------------------------------------------------------- |
| `intent`  | Load when rendered, or earlier on a trigger's pointer-enter, focus, or pointer-down.                                      |
| `preload` | Queued when the split is defined. The queue drains at browser idle (one-second timeout/fallback) once no critical load is pending: the route import, the current page's split, and any split being rendered. Intent and rendering still load it earlier. |

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
loads settle, which also defers plugin frontend boot until the page's own code
has arrived. Splits defined by modules that load later (a route
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

Pilots:

- `LazySidebarFooterCustomize`: render on demand; loading/error retain Done and
  Escape so slow or failed downloads do not trap customization mode.
- `LazyFilePreview`: render on demand; its code already warms through the panel
  shell’s shared Git-diff dependency on workspace-page load, and is explicitly
  included in panel-open warming.
- `LazyThreadSecondaryPanel`: prop-aware desktop/drawer placeholders, preload
  tier, intent on panel toggles, and `mountWhen` first open with `keepMounted`. Opening also warms browser, terminal, new-tab and file-preview code. Closed desktop panels
  retain a lightweight resizable Panel shell; loaded content stays mounted after
  closing. Inline failure preserves the resizable Panel structure.

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
prove that a feature is lazy. Moving code out of boot can increase a page
journey; report both. Do not increase limits to hide a regression.

## Review loading states

Use browser request interception against an isolated production build to hold or
fail the actual chunk download. Capture desktop and compact-width screenshots
of loading, failure, and loaded states. Temporary review stories and fixtures
belong in the review worktree, not the shipped change.

Keep code-loading and data-loading reviews separate: releasing the split may
reveal another loading state while the feature fetches data. Keep focus and
close controls usable, preserve panel geometry, and check the transition to
real content. Do not add artificial production delays for screenshots.

## Parallel implementation contract

Establish the helper and pilots on a common base before fanning out. Give each
child a separate worktree, one feature boundary, and an explicit preload policy.
Each child returns:

1. A focused diff and independent boundary guard, with an eager-import negative
   control and before/after boot and route sizes.
2. Reproduction steps using the real wrapper and its loading/error UI; keep any
   temporary review harness out of the final diff.
3. Desktop and compact-width loading, failure, and loaded screenshots, plus
   observations about focus, close actions, layout shifts, and preserved input.
4. A running isolated review server, its BB Connect URL, exact story/route and
   interaction steps, and ownership/cleanup information. Never use production
   data or give a remote user an inaccessible localhost link.
5. Focused tests, relevant UI verification, and explicit platform limitations.

Review each loading experience before integration. Build and check the combined
result too: shared chunk changes mean independent byte savings are not additive.

## Audited loading policies

See [the September 29 loading-policy audit](ui-split-loading-audit.md) for the
complete inventory, actual mount gates, intent wiring, nested loads and rationale.
A policy label alone does not make a hidden mounted component lazy. Keep the
implementation behind an explicit first-use gate, then retain it where closing
must preserve state. Choose idle warming deliberately for commonly used UI; keep
customization and content-dependent renderers gated by actual demand.
