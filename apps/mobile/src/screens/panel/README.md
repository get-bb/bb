# Workspace panel (`src/screens/panel`)

The mobile counterpart of the web's secondary panel (`ThreadSecondaryPanel` on
a compact viewport): a tall bottom sheet with a horizontal tab strip — fixed
entries **Info · Diff · Files · Terminal**, then the thread's closable file tabs
— and one content view. The shell (sheet, strip, tab state, sync) lives here;
what each tab _shows_ is registered by the feature that owns it.

```
WorkspacePanelProvider          state + controller + <WorkspacePanelSheet/>
  ThreadWorkspacePanelProvider  thread scope (ThreadDetailScreen)
  ProjectWorkspacePanelProvider project scope / root compose (home ComposeDock)
usePanel()                      PanelController (open / close / openFile / …)
registerPanelTabContent(kind, Component)          tab kinds
registerPanelLauncherContent("files"|"terminal")  the two launcher pages
contents/index.ts               registration manifest (import your register.ts)
panel-model.ts                  pure: scope, view state, strip entries, reducer
```

## Scope

```ts
type PanelScope =
  | { kind: "thread"; threadId; projectId; environmentId; hostId }
  | { kind: "project"; projectId; environmentId; hostId }; // root compose
```

`environmentId` is the thread's environment (thread scope) or a reused
environment picked on the compose screen (project scope); `hostId` is the
machine terminals run on (`host_path` target in project scope). Info and Diff
only exist in thread scope; Files and Terminal exist in both.

## Tab state

- Tabs are the client-core `FixedPanelTabsState` (`@bb/client-core`
  `fixed-panel-tabs-state` / `secondaryPanelTabState` helpers). The strip's
  fixed view tabs (`thread-info`, `git-diff`) are reconciled in front of the
  file tabs; `Files` / `Terminal` are **launchers** (`PanelLauncherId`), not
  client-core tabs — they never persist or sync, a tab activation clears them.
- Device-local state: MMKV (`bb.preferences`) under the web's key
  `getFixedPanelTabsStateStorageKey({ threadId: panelStateId })`; the
  root-compose panel uses `root-compose:<profileId>` (`@/data/thread-tabs`
  `createFixedPanelTabsStore`). The active tab survives leaving the thread;
  sheet visibility is transient.
- Server sync (thread scope): `useSyncedPanelTabs` mirrors the tab list
  against `GET/PUT /threads/:id/tabs` — server wins on read
  (`reconcileTabsStateWithServerTabs`), local writes go through a per-profile
  queue (`createThreadTabsSyncer`) with the cached revision; a 409 refetches
  and retries once, a second 409 adopts the server strip. Realtime
  `tabs-changed` invalidates `threadTabsQueryKey`. Kinds that never cross the
  wire from mobile: `side-chat` (legacy, dropped on read like the web),
  `plugin-page-fixed`, `new-tab`.
- Unsupported kinds (`browser`, `plugin-panel`, `plugin-page-fixed`) stay in
  the strip (they are part of the synced list) and render the "Available on
  desktop/web" card; they can be closed like any tab.

## Registering a tab content

```ts
// src/screens/diff-tab/register.tsx
import { registerPanelTabContent } from "@/screens/panel/registry"; // leaf import, not the barrel
import { DiffTabContent } from "./DiffTabContent";

registerPanelTabContent("git-diff", DiffTabContent, {
  retainWhenInactive: true,
});
```

then add `import "@/screens/diff-tab/register";` to `contents/index.ts` (the
manifest). Register from the **leaf** `@/screens/panel/registry` module: the
barrel imports the manifest last, and a register file that imports the barrel
would see it half-initialized.

Props the content receives:

```ts
interface PanelTabContentProps<T extends FixedPanelTab = FixedPanelTab> {
  scope: PanelScope;
  tab: T; // narrowed to the registered kind
  active: boolean; // the view on screen (retained views render hidden)
  panelVisible: boolean; // the sheet is presented — pause work when false
}
interface PanelLauncherContentProps {
  scope: PanelScope;
  launcher: "files" | "terminal";
  active: boolean;
  panelVisible: boolean;
  filesParams: FilesLauncherParams | null; // files launcher: { section: "search" | "storage", initialQuery }
}
```

Contents render inside the bottom-sheet modal, which @gorhom/bottom-sheet
mounts through the portal host at the app root: only app-root contexts
(theme, profiles / QueryClient, sheets, toasts) and `PanelContext` (the
sheet re-provides it) reach them. A screen-local context (e.g. the
timeline's `TimelineRowHostProvider`) does not; pass what you need through
the scope or re-provide it inside your content.

`retainWhenInactive: true` keeps the content mounted (display none) while
another tab is active and the tab still exists — terminals (socket + WebView),
the diff list and the Files launcher (its search text) want this; plain
previews do not. The content host renders the active view and the retained
views in one keyed sibling list, so a view that moves between active and
retained keeps its React instance (rendering the active view in a separate
slot would remount it on every switch).

Layout: the sheet's children sit in a plain flex-1 `View` (not
`BottomSheetView`, which is absolutely positioned and collapses to its
content). @gorhom's content container has an explicit height — the snap
point minus the handle, plus an over-drag / keyboard padding at the bottom —
so a flex-1 child fills exactly the visible content box; `bottom: 0` on
`BottomSheetView` would run into that padding and push the last rows (a
terminal's accessory bar) below the screen. The sheet only resizes for its
own `BottomSheetTextInput`s; a content that raises the keyboard itself (the
terminal WebView) wraps in `KeyboardPaddingView`.

Tab kinds → owner: `git-diff` (Diff agent), `workspace-file-preview` /
`host-file-preview` / `thread-storage-file-preview` + the `files` launcher
(Files agent), `terminal` + the `terminal` launcher (Terminal agent).
`thread-info` is here (`ThreadInfoTabContent`).

## Controller (`usePanel()`)

```ts
panel.open(); // present (last view)
panel.openDiff(path?); // Diff tab; path → panel.view.diffPath until consumeDiffPath()
panel.openFiles({ section: "storage" }); // files launcher; → view.filesParams until consumeFilesParams()
panel.openTerminal(terminalId?, target?); // tab of a session, or the launcher
panel.openFile({ kind: "workspace" | "host" | "storage", path, line?, endLine?, source?, statusLabel? });
panel.activate({ kind: "tab", tabId } | { kind: "launcher", launcher });
panel.closeTab(id); panel.closeOtherTabs(id); panel.closeAllTabs(); panel.close();
panel.view / panel.activeView / panel.entries / panel.scope / panel.visible
```

`useOptionalPanel()` returns null outside a provider (markdown local-file
links in dev showcases). The Diff content reads `panel.view.diffPath` on
mount / change, scrolls, then calls `panel.consumeDiffPath()`; the Files
launcher does the same with `filesParams`.

## Entry points

- The thread screen's native header → `PanelToggleButton`
  (`thread-panel-button`, icon `PanelBottom`) → `panel.open()`; also the
  "Workspace" row of the "…" menu.
- Home `ComposeDock` → "Workspace" in the composer's "+" menu.
- Info tab: changed files → `openDiff(path)`, storage row →
  `openFiles({ section: "storage" })`, parent / forks → thread route.

## Test ids

`workspace-panel`, `workspace-panel-tab-strip`, `panel-tab-thread-info`,
`panel-tab-git-diff`, `panel-tab-files`, `panel-tab-terminal`,
`panel-tab-file-<kind>` (closable), `panel-tab-close`,
`workspace-panel-content`, `panel-info`, `panel-info-<row>`
(`directory`, `branch`, `git-status`, `changed-files`, …),
`panel-content-unsupported`, `panel-content-placeholder-<kind|launcher>`.

## Tests

`panel-model.test.ts` (strip entries, active view, open-file tabs, reducer),
`@/data/thread-tabs/*.test.ts` (sync reducer + 409 retry queue, MMKV store).
Maestro: `e2e/flows/phase6-panel.yaml`.
