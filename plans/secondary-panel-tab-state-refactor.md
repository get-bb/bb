# Secondary Panel Tab State Refactor

## Goal

Make secondary-panel tabs a single state model and remove the extra ownership
paths that currently make the right panel hard to reason about.

Requested outcomes:

- One secondary-panel tab-state module owns all 8 tab kinds:
  - `thread-info`
  - `git-diff`
  - `workspace-file-preview`
  - `host-file-preview`
  - `thread-storage-file-preview`
  - `browser`
  - `new-tab`
  - `terminal`
- Generic `openTab`, `closeTab`, and `activateTab` operations are keyed by a
  full stable tab identity.
- The secondary panel's wide-viewport open/closed state comes from tab state,
  not from a separate atom/storage key.
- Delete the URL `secondaryPanel` round-trip sync.
- Replace the per-kind open/close/activate callback families in
  `useThreadFileTabs.ts`.
- Browser native-view visibility is owned per browser deck, not by a renderer
  global singleton.
- Extend the mount-once/toggle-visibility pattern from browser tabs to diff
  cards and iframe previews.
- Replace the effect/ref-guard style in `useGitDiffPanelState.ts` with reducer
  state and explicit dispatches from the events that already request changes.

## Current State

- `apps/app/src/lib/fixed-panel-tabs-state.ts` already stores a union for all
  8 tab kinds, but ids are not uniformly full identities. Workspace file tabs
  are keyed by `kind:path` while `environmentId` is a separate field, so the
  same path in two environments collides.
- `apps/app/src/lib/fixed-panel-tabs.ts` owns thread-info, git-diff, terminal
  activation, localStorage persistence, and the one-shot URL sync.
- `apps/app/src/components/secondary-panel/useThreadFileTabs.ts` is 947 lines
  and owns workspace, host, storage, browser, and new-tab operations with
  repeated per-kind open/close/activate helpers.
- `apps/app/src/components/secondary-panel/threadSecondaryPanelAtoms.ts` stores
  `getThreadSecondaryPanelOpenAtom`, while `FixedPanelTabsState.secondary`
  also has `isOpen`.
- `apps/app/src/views/thread-detail/ThreadDetailView.tsx` reads/writes both the
  fixed tab state and the separate open atom, and terminal/browser/file flows
  also write the separate open atom.
- `apps/app/src/components/secondary-panel/browserViewVisibilityCoordinator.ts`
  has one module-level shared coordinator. Current tests assert this global
  sharing; the requested behavior needs the opposite invariant.
- `apps/app/src/components/git-diff/GitDiffCard.tsx` unmounts the body when
  hidden/collapsed, and `apps/app/src/components/secondary-panel/FilePreview.tsx`
  remounts HTML iframes when switching preview/source or changing active file
  content.
- `apps/app/src/components/secondary-panel/git-diff/useGitDiffPanelState.ts`
  is 714 lines and mixes query display state, parse scheduling, selected diff
  state, pending scroll/commit atoms, refs, and 9 effects/layout effects.

## Stable Identity Model

Add a single explicit identity type in the new tab-state module:

```ts
interface SecondaryPanelTabIdentity {
  kind: SecondaryFixedPanelTab["kind"];
  path: string;
  environmentId: string | null;
}
```

Use one canonical serializer for ids:

```text
kind:encodeURIComponent(path):encodeURIComponent(environmentId ?? "none")
```

Identity mapping:

- `thread-info`: path `thread-info`, environment `null`
- `git-diff`: path `git-diff`, environment `null`
- `workspace-file-preview`: path is workspace path, environment is the owning
  environment id or `null`
- `host-file-preview`: path is host path, environment `null`
- `thread-storage-file-preview`: path is storage path, environment `null`
- `browser`: path is an immutable generated browser instance id, environment is
  the thread environment id at open time or `null`; URL remains mutable tab data
- `new-tab`: path `new-tab`, environment `null`
- `terminal`: path is terminal id, environment `null` unless terminal ownership
  should intentionally follow environment lifetime

Keep browser URL out of identity because navigation mutates it. Keep title/URL
updates as tab data updates against the browser identity.

## Proposed Module Shape

Create a module near the existing secondary-panel code, for example:

```text
apps/app/src/components/secondary-panel/secondaryPanelTabState.ts
```

It should own:

- `SecondaryPanelTabIdentity`
- `SecondaryPanelTabAction`
- `openSecondaryPanelTab`
- `closeSecondaryPanelTab`
- `activateSecondaryPanelTab`
- `updateSecondaryPanelTab`
- `reorderSecondaryPanelTabs`
- `replaceTransientNewTabWithTab`
- selectors:
  - `getActiveSecondaryPanelTab`
  - `getOpenSecondaryPanelTab`
  - `getOrderedSecondaryPanelFileTabs`
  - `getBrowserTabs`
  - `isSecondaryPanelOpen`

Move low-level tab creation/id helpers out of `fixed-panel-tabs-state.ts` only
if it reduces coupling. Otherwise keep schemas/types there and import the new
identity serializer from the secondary-panel tab-state module. Avoid a second
parallel id builder.

## Phase 1 - Consolidate Tab Operations

Scope:

- Introduce the stable identity serializer and parser.
- Update tab factories so every secondary tab id is generated through the same
  identity path.
- Normalize old stored ids during `parseFixedPanelTabsState`:
  - map old workspace ids to include the stored `environmentId`
  - map old fixed ids (`thread-info`, `git-diff`, `new-tab`) to their canonical
    identity or support them through parser migration
  - update `activeTabId` to the migrated id
- Replace duplicated `findXTab` and `activateXTab` helpers with identity-based
  lookup.
- Replace `useThreadFileTabs` with either:
  - a smaller `useSecondaryPanelTabs` hook exposing generic actions and
    selectors, or
  - a pure tab-state module plus a thin hook that only binds thread id,
    recents, and storage/environment pruning.
- Keep real side effects at the boundary:
  - record workspace/thread-storage recents when those tabs are opened
  - prune workspace tabs when environment changes
  - prune storage tabs when storage file list changes

Exit criteria:

- `ThreadDetailView` no longer receives per-kind close/activate callbacks from
  `useThreadFileTabs`.
- Opening, closing, activating, reordering, and updating browser tabs all use
  generic identity-based actions.
- Workspace tabs for identical paths in different environments no longer
  collide.

Validation:

- Unit tests for open/close/activate across all 8 kinds.
- Unit tests for old-id migration and `activeTabId` migration.
- Unit tests for new-tab replacement behavior.
- `pnpm exec turbo run test --filter=@bb/app -- secondaryPanelTabState`
- `pnpm exec turbo run typecheck --filter=@bb/app`

## Phase 2 - Make Panel Open Derived From Tab State

Scope:

- Use `fixedPanelTabsState.secondary.isOpen` as the only persisted wide-layout
  right-panel open flag.
- Remove `getThreadSecondaryPanelOpenAtom`, its storage key, and all direct
  writes to it.
- Update:
  - `ThreadDetailView`
  - `threadSecondaryPanelSelection.ts`
  - `useThreadSecondaryPanelVisibility.ts`
  - terminal activation/start handlers
  - file/browser/new-tab open flows
- Keep compact drawer state local in `useThreadSecondaryPanelVisibility`; it is
  viewport UI state, not persisted panel-open ownership.
- Preserve `close` as `isOpen: false` without clearing tabs.
- Preserve `open` as:
  - open active tab if one exists
  - otherwise create/activate `thread-info`

Exit criteria:

- No imports of `getThreadSecondaryPanelOpenAtom` remain.
- No separate `bb.thread.secondaryPanel.open-*` writes occur.
- The right panel restores open/closed state from the fixed tabs state.

Validation:

- Unit tests for close/open/toggle preserving tabs.
- Manual QA:
  - open a file tab, reload, panel restores from fixed state
  - close panel, reload, tabs remain but panel is closed
  - compact drawer opens/closes independently of persisted wide state
- `pnpm exec turbo run typecheck --filter=@bb/app`

## Phase 3 - Delete URL Round-Trip Sync

Scope:

- Remove `useFixedPanelTabsSecondaryPanelUrlSync`.
- Remove `getThreadSecondaryPanel` / `withThreadSecondaryPanel` if no longer
  used for other route construction.
- Remove `ThreadDetailView`'s `setThreadSecondaryPanelFromUrl` bridge.
- Decide compatibility for old links with `?secondaryPanel=git-diff`:
  - recommended: ignore the query after removal and leave route parsing simple
  - alternative: handle it once at route-entry outside tab state, but do not
    write back to the URL

Exit criteria:

- No effect reads secondary-panel state from `location.search`.
- No navigation exists solely to erase a secondary-panel query param.

Validation:

- Existing route path tests still pass or are updated if they expected the old
  query key.
- `pnpm exec turbo run test --filter=@bb/app -- route-paths`
- `pnpm exec turbo run typecheck --filter=@bb/app`

## Phase 4 - Per-Deck Browser Visibility Ownership

Scope:

- Replace `getBrowserViewVisibilityCoordinator` with deck-local creation:
  `useMemo(() => createBrowserViewVisibilityCoordinator(desktopBrowser), ...)`.
- Keep the browser view registry global only for lifecycle cleanup by
  thread/environment.
- Split close paths:
  - deck-owned tab close releases the deck coordinator, hides the view, detaches
    it, and removes the registry record
  - external cleanup by thread/environment directly hides/detaches registered
    views without consulting a global coordinator
- Update tests to assert:
  - one deck hides its previous visible tab before showing the next
  - separate decks do not share coordinator visibility state
  - registry cleanup still destroys only matching thread/environment records

Exit criteria:

- No module-level shared browser visibility coordinator remains.
- Browser view cleanup still handles deleted threads/environments.

Validation:

- `pnpm exec turbo run test --filter=@bb/app -- browserViewVisibilityCoordinator`
- Add or restore `BrowserTabDeck` tests around deck-local visibility.
- Manual desktop QA:
  - switch between browser tabs
  - close active/inactive browser tabs
  - delete a thread/environment with retained browser views

## Phase 5 - Mount Once, Toggle Visibility For Diff Cards And Iframes

Scope:

- Diff panel:
  - keep the diff panel content mounted while the secondary panel exists
  - hide/show the diff surface based on active tab instead of unmounting it
  - keep parsed diff cards mounted once they have entered the render queue
  - when collapsed or temporarily hidden, hide the body with DOM/CSS state
    instead of returning `null` for the body
  - reset mounted card state only when the diff identity actually changes
- Iframe previews:
  - keep an iframe preview mounted across preview/source toggles when the URL
    identity is unchanged
  - avoid remounting iframe content when switching away from and back to an
    already-open iframe-capable tab
  - preserve load/error state by iframe URL identity, not by incidental parent
    branch rendering
- Use `hidden`, `aria-hidden`, `display: none`, or class-based visibility where
  appropriate. Native browser views still need IPC visibility; ordinary DOM
  diff/iframe content does not.

Implementation options:

- Minimal path:
  - change `GitDiffCard` so the card body is always present after first mount
    and is hidden when collapsed
  - change `FilePreview` so HTML preview/source branches keep the iframe node
    mounted for the same URL
- Fuller path:
  - add a secondary content deck keyed by tab identity, similar to
    `BrowserTabDeck`, so browser, iframe file previews, and diff content share
    the same mount-once/toggle-visibility contract.

Recommended path:

- Start with the minimal path for diff-card body and HTML source/preview iframe
  toggles.
- Add the fuller content deck only if QA confirms iframe reload still happens
  on ordinary tab switching and preserving that state is required for this
  change.

Exit criteria:

- Diff cards do not lose body-local state when collapsed/expanded or when the
  diff panel is temporarily inactive.
- HTML iframes do not reload on preview/source toggles for the same URL.
- Any remaining iframe reload on file-tab switching is either fixed by a content
  deck or documented as out of scope.

Validation:

- Component tests for `GitDiffCard` body persistence.
- Component tests for iframe node persistence across preview/source toggles.
- Manual QA:
  - expand diff context, switch panel tabs, return
  - collapse/expand diff cards
  - open an HTML preview, toggle raw/preview, return to preview
- `pnpm exec turbo run test --filter=@bb/app -- GitDiffCard`
- `pnpm exec turbo run test --filter=@bb/app -- FilePreview`
- `pnpm exec turbo run typecheck --filter=@bb/app`

## Phase 6 - Reducerize Git Diff Panel State

Scope:

- Extract pure reducer state and actions from `useGitDiffPanelState.ts`.
- Move duplicated state/ref pairs into reducer state:
  - selected diff selection
  - displayed diff response identity
  - parsed files
  - expected file count
  - parse status
  - last parsed diff key
  - pending scroll/focus intent
  - pending commit selection intent
  - last focused scroll path
- Replace pending scroll/commit atoms with explicit actions from
  `useGitDiffPanel` event handlers:
  - `openDiffFile(path)` dispatches a scroll/focus intent and opens/activates
    the git-diff tab
  - `openCommitDiff(sha)` dispatches a commit selection intent and
    opens/activates the git-diff tab
- Replace environment-reset effects with dispatches at the environment-change
  boundary. If the boundary is still a hook effect, keep it as a single
  `environmentChanged` dispatch, not multiple field-level setters.
- Keep unavoidable side-effect boundaries as effects:
  - query result arrival
  - batched parse timers
  - DOM scroll after render
  - file content fetches through React Query
- The reducer should decide next state; effects should only perform IO/timers
  and dispatch results.

Exit criteria:

- No state+ref duplicate exists solely to dodge stale effects.
- Pending git diff scroll/commit atoms are removed.
- The hook's effects are reduced to side-effect boundaries, not derived state
  synchronization.
- Git diff behavior is unchanged for:
  - default all-changes selection
  - commit selection
  - pending diff-file scroll/focus
  - environment changes
  - placeholder diff retention while refetching
  - batched parsing

Validation:

- Pure reducer tests for:
  - environment change reset
  - commit selection request
  - diff-file focus request
  - stale selection reconciliation
  - displayed response retention/drop rules
  - parse reset/immediate/batched transitions
- Existing helper tests remain green.
- Manual QA:
  - open diff panel
  - select committed/uncommitted/single commit
  - click changed file from metadata and verify scroll/focus
  - change merge-base branch
  - switch environments/threads
- `pnpm exec turbo run test --filter=@bb/app -- gitDiffPanel`
- `pnpm exec turbo run typecheck --filter=@bb/app`

## Suggested Work Order

1. Build the new tab identity/actions module and tests.
2. Move all secondary-panel open/close ownership into fixed tab state.
3. Remove URL round-trip sync.
4. Change browser visibility coordinator ownership and tests.
5. Apply mount-once visibility behavior to diff cards and iframe previews.
6. Reducerize git diff panel state.

The first three phases should land together or behind a short-lived branch
because they all touch the same right-panel ownership model. Phases 4, 5, and 6
can land separately after that foundation is stable.

## Risks

- Stored tab migration can strand an `activeTabId` if old ids are not mapped in
  lockstep with tab ids.
- Browser tab identity must not use URL; URL changes constantly.
- Removing the separate open atom changes existing localStorage behavior. The
  fixed tabs state's `secondary.isOpen` should be treated as the migration
  target, not a new preference.
- Keeping more DOM mounted may increase memory use for large diffs or many file
  previews. Preserve the existing render queue and only keep mounted content
  after it has been intentionally rendered.
- The git diff reducer work is easiest after tab ownership is simplified; doing
  it before the pending-intent API is clear may just move effect coupling into a
  different file.

## Non-Goals

- Do not change desktop browser IPC contracts unless a cleanup edge requires a
  small detach/visibility helper.
- Do not add favicons or new browser tab UI.
- Do not redesign the secondary panel chrome.
- Do not change git diff parsing semantics.
- Do not add a generic content-deck abstraction unless the iframe preservation
  requirement truly needs it after the minimal iframe fix.
