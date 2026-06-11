# Flexible Panel Layouts

## Goal

After fixed secondary and bottom panels use generic typed tabs, replace the fixed
panel arrangement with a flexible per-thread layout that supports moving and
splitting tab groups.

User-facing outcomes:

- open terminals in the secondary panel
- drag terminal tabs from the bottom panel into the secondary panel
- drag file/info/diff/terminal tabs between groups
- split groups horizontally or vertically
- persist layout shape, group sizes, active tabs, and tab placement per thread

## Prerequisites

This plan should start only after:

- fixed secondary and bottom panels use generic typed tabs.
- terminal lifecycle is separated from bottom-panel chrome.
- file preview content can render from tab params instead of a single active
  `fileTabContent` prop.

The arbitrary file preview plan is not required, but any file-opening behavior
it adds should already target generic tab actions by the time this plan begins.

## Architecture Recommendation

Use Dockview for desktop layout.

Reasons:

- tabs and tab groups are core concepts
- drag-to-reorder and drag-to-split are built in
- JSON persistence exists
- implementing robust tab dragging on top of `react-resizable-panels` would
  create another custom layout subsystem

Use a thin adapter:

- app-owned typed layout state is the domain model
- Dockview JSON is a render/persistence adapter detail
- tab renderers are registered by typed `kind`
- invalid drops are rejected before they mutate app state
- compact viewport bypasses Dockview and renders a single drawer tab group

Keep `react-resizable-panels` only as a fallback if Dockview cannot be made to
fit app theming or runtime constraints.

## Layout State

Persist layout per thread.

```ts
type ThreadDetailLayoutState = {
  version: 1;
  root: LayoutNode;
  activeGroupId: string;
  lastUsedAt: number;
};

type LayoutNode = SplitNode | TabGroupNode;

type SplitNode = {
  id: string;
  direction: "horizontal" | "vertical";
  children: LayoutNode[];
  sizes: number[];
};

type TabGroupNode = {
  id: string;
  tabs: ThreadDetailLayoutTab[];
  activeTabId: string | null;
};
```

Initial desktop layout should mirror the current fixed layout:

```txt
Split(vertical)
  Split(horizontal)
    Group: timeline
    Group: secondary tabs
  Group: bottom terminal tabs
```

## Tab Kinds

Start with the generic fixed-panel tab kinds, then add timeline when movable
timeline work starts.

```ts
type ThreadDetailLayoutTab =
  | TimelineTab
  | ThreadInfoTab
  | GitDiffTab
  | WorkspaceFilePreviewTab
  | HostFilePreviewTab
  | ThreadStorageFilePreviewTab
  | TerminalTab;
```

V1 rules:

- terminal tabs are move-only, not cloneable
- file tabs are deduped by content key
- `thread-info`, `git-diff`, and `timeline` are singleton tabs
- at least one timeline tab must exist once timeline becomes movable
- leaf groups are capped, default 4, via a named config constant

## Implementation Plan

### Phase 1 - Dockview Shell With Fixed-Like Layout

Goal: replace the desktop layout shell while preserving the visible layout.

Scope:

- Add Dockview dependency after checking current peer dependencies.
- Add Dockview CSS/theme integration using app tokens.
- Add a layout adapter:
  - hydrate Dockview from typed layout state
  - write layout changes back to typed layout state
  - map tab kinds to existing renderers
  - handle tab close and activation through app actions
- Seed desktop layout to match current fixed positions.
- Keep compact viewport on the current drawer path.
- Disable arbitrary drag/split if needed until behavior is verified.

Exit criteria:

- Visual layout closely matches the fixed panel layout.
- Info, Diff, file previews, and bottom terminals render in Dockview groups.
- Existing header buttons focus the expected group/tab.
- Refresh restores group sizes and active tabs.
- `pnpm exec turbo run typecheck --filter=@bb/app` passes.

### Phase 2 - Move Terminal Tabs Between Groups

Goal: terminals can be moved from bottom to secondary/right groups.

Scope:

- Allow terminal tab drag between existing groups.
- Ensure moving a terminal tab does not duplicate the terminal.
- Remove or narrow "hide bottom panel closes clean terminals":
  - hiding/collapsing a group detaches the view only
  - closing a terminal tab closes the server terminal session
  - moving a terminal tab changes only placement
- Add "new terminal in this group" action to group chrome or a group menu.
- Keep header terminal button as "focus/open bottom terminal group".
- Ensure only one mounted `ThreadTerminalView` exists per terminal id.

Exit criteria:

- Create terminal in bottom group.
- Create terminal in secondary group.
- Drag terminal from bottom to secondary.
- Terminal scrollback replays after move.
- Hiding bottom group does not close a terminal moved elsewhere.
- Closing a terminal tab closes the PTY/session.
- Focused tests cover move vs close vs hide semantics.
- `pnpm exec turbo run typecheck --filter=@bb/app` passes.

### Phase 3 - Enable File/Info/Diff Tab Movement

Goal: non-terminal tabs can move between available groups.

Scope:

- Allow file, info, and diff tabs to move between groups.
- Keep dedupe behavior across the full layout tree.
- Make open-file/open-diff actions focus the existing tab wherever it lives.
- Confirm each file preview tab fetches from its own params.
- Reject unsupported tab and thread-state combinations, such as hidden git UI for
  threads whose environments cannot use git UI.

Exit criteria:

- Drag file preview tabs between groups.
- Drag Info and Diff tabs between groups.
- Opening the same file focuses the moved tab.
- Refresh restores moved tabs.
- `pnpm exec turbo run typecheck --filter=@bb/app` passes.

### Phase 4 - Enable Splits

Goal: users can split groups horizontally and vertically.

Scope:

- Enable drag-to-split.
- Enforce the leaf group cap.
- Persist split direction, child order, sizes, and active tabs.
- Reject a fifth leaf group with a non-blocking toast.
- Add layout normalization for empty groups.

Exit criteria:

- Drag a tab to a group edge creates a split.
- Drag tabs between split groups.
- Attempting to exceed the leaf cap is rejected.
- Refresh restores the split layout exactly.
- `pnpm exec turbo run typecheck --filter=@bb/app` passes.

### Phase 5 - Movable Timeline

Goal: timeline and composer become layout content.

Scope:

- Add `timeline` tab kind.
- Render `ThreadTimelinePane` as timeline tab content.
- Keep composer inside the timeline tab.
- Prevent closing the last timeline tab.
- Validate sticky composer and scroll anchoring at narrow group widths.
- Keep compact viewport full-width timeline plus drawer tab group.

Exit criteria:

- Timeline tab can move between groups.
- Composer follows the timeline.
- Closing the final timeline tab is blocked.
- Scroll-to-bottom and unread/read behavior still work.
- Refresh restores timeline placement.
- `pnpm exec turbo run typecheck --filter=@bb/app` passes.

## Open Decisions

1. **Dockview final check.** Verify package peer dependencies, CSS scoping, and
   React/Vite compatibility immediately before implementation.
2. **Timeline movability.** Recommendation: defer until after terminal/file
   movement and splits work. The timeline has the highest layout risk because it
   owns composer and scroll behavior.
3. **Terminal duplicate views.** Recommendation: disallow duplicate visible
   terminal tabs in v1.
4. **Full layout URL state.** Recommendation: do not encode full layout in the
   URL. Persist per thread in localStorage.
5. **Floating panels.** Recommendation: keep disabled unless a clear use case
   appears.

## Out Of Scope

- Arbitrary path opening UI.
- Workspace file browser/sidebar.
- Cross-thread tab dragging.
- Floating windows.
- Duplicate live views of the same terminal.
- Free-form path linkification in terminal output or error strings.

## Validation

Run:

```sh
pnpm exec turbo run typecheck --filter=@bb/app
pnpm exec turbo run test --filter=@bb/app
```

Manual smoke:

- open Info and Diff
- open file previews
- open bottom terminal
- create terminal in secondary group
- drag terminal bottom to secondary
- drag file/info/diff tabs between groups
- split groups
- refresh and verify layout restoration
- compact viewport drawer behavior
