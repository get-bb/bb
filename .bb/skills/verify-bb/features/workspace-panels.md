# Panels, files, terminals, splits, and embedded browser

Status: **source-documented; not live-verified in the initial smoke pass**.

## Setup and entry points

Synthetic workspace with text, Markdown, CSV, image, HTML, PDF, and binary fixtures. Some browser integrations require Electron.

Follow the main skill’s isolated launch, doctor, evidence, and cleanup rules.
CLI examples below omit the `pnpm --silent bb:dev` prefix; use that source CLI
against the same dev instance. Resolve IDs with list/show and inspect the named
command’s `--help` before mutation. Use fresh browser snapshots for controls.

## Source

- `apps/app/src/views/SplitWorkspaceRoute.tsx`
- `apps/app/src/components/secondary-panel/FilePreview.tsx`
- `apps/app/src/components/secondary-panel/SidebarSplitContainer.tsx`
- `apps/cli/src/commands/thread/open.ts`
- `apps/cli/src/commands/thread/pane.ts`
- `apps/cli/src/commands/file.ts`
- `apps/cli/src/commands/terminal.ts`

## Feature recipes

| Feature | Drive | Observable success |
| --- | --- | --- |
| Open, close, and reopen tabs | Open New panel tab, select files/terminal/plugin content, close and reopen the last tab; reload. | Correct content and tab order persist without duplicating sessions. |
| Panel tab concurrency | Read thread tabs show, modify tabs from one client, then submit a stale revision with tabs set. | Conflict is surfaced rather than overwriting the other client’s tab state. |
| Split and focus panes | Open a thread in split, drag/reorder, focus previous/next/numbered panes, maximize and restore, then close one. | Focus and layout refer to the right thread; closing the last remaining pane is handled deliberately. |
| Agent pane controls | With the same thread open in a connected client, use thread pane maximize/restore/toggle/spotlight/clear-spotlight. | Delivered result matches visible client action; a delivered event is not assumed proof without observing the UI. |
| Quick open and file tree | Search a unique path with Quick open file, expand tree folders, and open a line-specific link. | Results and displayed content match the selected host/workspace; missing paths remain explicit. |
| Read-only previews | Open each fixture type, a large text file, and an unsupported binary. | Renderer or download fallback matches type/size; original bytes are unchanged. |
| Host, workspace, and thread-storage files | Open a same-named fixture from each source and compare file read/project content/thread storage APIs. | Source identity is maintained; no accidental cross-root content leak. |
| File mutation CLI | Use file mkdir/write/list/paths/read/move/remove on a temporary subtree only; verify bytes after each. | Path routing and recursive flags obey scope; errors preserve unrelated files. |
| Terminal scopes and output | Create terminals at thread, environment, and host scope using terminal create --help; run printf with a unique marker; attach and inspect output/wait. | Each terminal uses the requested working directory and output remains available after detach. |
| Terminal interaction and lifecycle | Send input, resize, rename, restart, and close a synthetic terminal. | Input reaches only the target; dimensions/title update; restart replaces the process in the same scope; close ends it. |
| Diff and Add to chat | Open environment diff, select changed lines, add them to the composer. | Selected patch and file identity are preserved with correct old/new line numbers. |
| External editor and file openers | Choose a configured editor/terminal, use Open in preferred app, and test one-off Open with. | Host-local opener receives the intended path and line; unavailable integration reports failure. |
| Embedded browser | In a capable desktop client open a local fixture URL, focus location, navigate, reload, find text, hide/show the panel, and close. | History/search and native view visibility follow the active tab; hidden views do not cover dialogs. |
| Thread storage and raw files | Inspect a synthetic thread’s storage location, list paths/files, and open text/binary assets through the documented storage/raw-file API and UI link. | Stored artifacts resolve from thread storage rather than the worktree, content bytes/MIME agree, and missing files fail explicitly. |
| Preview lifecycle | Request a fixture file preview through the public files API, follow its returned preview URL and test a missing/unsupported file. | Preview references only the chosen source and renders the expected bytes/error; the returned URL is not invented from a workspace path. |

## Evidence and cleanup

Record a result for each row separately, including the chosen entry point,
initial state, action, resulting state, and relevant persisted value. Repeat
mutations through the available agent interface to establish parity. Preserve
failed attempts and prerequisites; source documentation is not a passing test.
Restore preferences and remove only the fixtures and sessions created by this
recipe. External writes require a disposable test target and task authorization.
