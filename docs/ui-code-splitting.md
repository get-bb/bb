# UI code splitting

Use `apps/app/src/lib/define-split.tsx` for new app UI boundaries. This is an
app-local contract, not a Plugin SDK API. Existing plain `lazy` wrappers can be
migrated when their feature is touched; avoid a repository-wide mechanical sweep.

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
  preload: "intent",
});
```

The returned component accepts the implementation's props and owns its Suspense
and error boundaries. `loading` receives those props. An optional `error`
component receives the props plus `retry`. The default error UI is one red line with an inline Try again action;
customize it when a panel needs structural layout or a feature
needs a close button. Loading and error components must themselves be lightweight.

The loader is shared between speculative preload and rendering. A failed import
clears the helper's promise cache. Retry creates a fresh React lazy component,
so a rejected lazy instance does not permanently trap the feature in its error
state. Browser module caching can still prevent recovery from a failed download, module
evaluation, or stale deployment URL; use the browser reload in that case. A blocked
chunk request in Chromium demonstrated this: retry stayed local but required
a reload to recover. Errors thrown
while rendering the loaded subtree are also contained locally.

Do not declare splits during render. Use a literal dynamic import path. Import
implementation types with `import type` or `typeof import(...)`; do not re-export
the implementation through a barrel imported by the shell.

## Download policy and mounting

| Policy    | Behavior                                                                                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `render`  | Load when rendered. No speculative scheduling.                                                                                                                    |
| `intent`  | Load on rendering or a trigger's pointer-enter, focus, or pointer-down.                                                                                           |
| `idle`    | The owning page schedules a load after two animation frames, then browser idle with a one-second timeout; browsers without idle callbacks use a one-second timer. |
| `startup` | The owning page starts the load when it registers its preload scope.                                                                                              |

Wire intent on the actual trigger:

```tsx
<button {...Editor.intentProps} onClick={openEditor}>
  Open editor
</button>
```

If a trigger already handles one of those events, compose the handlers instead
of overwriting one. `.preload()` is an explicit, safe warm-up available under any
policy; it catches speculative failures, leaving rendering able to try again.

Register startup/idle splits in the page or shell that owns them:

```tsx
useEffect(() => scheduleSplitPreloads([ActivityPanel, Editor]), []);
```

Registration is explicit: a feature inside an unopened subtree cannot arrange
its own page-load preload. The scheduler ignores `render` and `intent` policies,
cancels outstanding idle scheduling on unmount, and deduplicates imports through
the split's shared loader. Once started, imports cannot be cancelled. Multiple
eligible imports may run together; avoid a large startup preload list. Startup
means this scope's registration, not a global `window.load` event.

Downloading and mounting are separate. Keep the existing persistent responsive
drawer's deferred realization and retained content. Preloading must not mount
hidden UI, run its component effects, or replace the drawer. Avoid rendering a
split merely to preload it.

Pilots:

- `LazySidebarFooterCustomize`: render on demand; loading/error retain Done and
  Escape so slow or failed downloads do not trap customization mode.
- `LazyFilePreview`: render on demand; a local panel skeleton.
- `LazyThreadSecondaryPanel`: prop-aware desktop/drawer placeholders and an idle
  preload scope in `RootComposeRightPanelToggle`, plus explicit focus/pointer
  warm-up. Inline failure preserves the resizable Panel structure.

## Enforce the boundary

Add the heavy source module to `splitBoundaries` in
`apps/app/bundle-budget.json`, listing `boot` and any measured route closure
from which it must remain absent. The checker uses actual emitted module
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
prove that a feature is lazy. Moving code out of boot can increase the additional
route closure; report both. Do not increase limits to hide a regression.

## Review loading states

The Ladle stories under `performance/Split review` render the real pilot wrappers
inside `SplitPreviewProvider`. Hold loading, show failure, then release to the
real UI. Retry in the forced error state releases the preview. These controls
work even after the module is cached and can be driven in desktop/mobile widths.

The provider affects matching descendants, supports nested overrides, and does
not reset browser module caches or cancel separately scheduled preloads. Forced
loading/error does not invoke the target component loader itself. This is a
rendering preview; verify actual cold-network loading separately using browser
request interception against an isolated production build.

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
2. A deterministic story using the real wrapper and its loading/error UI.
3. Desktop and compact-width loading, failure, and loaded screenshots, plus
   observations about focus, close actions, layout shifts, and preserved input.
4. A running isolated review server, its BB Connect URL, exact story/route and
   interaction steps, and ownership/cleanup information. Never use production
   data or give a remote user an inaccessible localhost link.
5. Focused tests, relevant UI verification, and explicit platform limitations.

Review each loading experience before integration. Build and check the combined
result too: shared chunk changes mean independent byte savings are not additive.
