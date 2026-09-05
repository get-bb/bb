# Desktop application

Status: **source-documented; platform execution pending**.

## Setup and entry points

Use a graphical macOS or Linux test host with the source desktop build. Follow
the main launch preflight and fresh-store marker, then use
`scripts/bb-dev-app current --desktop` in place of the web-only launch. Confirm
that Electron and its owned runtime use this checkout's isolated store. Browser
automation against the web app cannot prove native menu, window, or update behavior.
Native actions need OS/Electron automation and inspected screenshots.

## Source

- `apps/desktop/src/main.ts`
- `apps/desktop/src/menu.ts`
- `apps/desktop/src/desktop-browser-view.ts`
- `apps/desktop/src/server-url-dialog.ts`
- `apps/desktop/src/desktop-auto-update.ts`

## Feature recipes

| Feature | Drive | Observable success |
| --- | --- | --- |
| Application menus | Exercise About, Settings, New thread, New tab, Reopen closed tab and New window from the actual menu. | Each action reaches the intended focused window and corresponding app state. |
| Window lifecycle | Open two windows, resize/move one, close/reopen, minimize and use platform window actions. | Window bounds/focus restore according to platform policy without losing the surviving window’s thread. |
| Close routing | Close an active side tab then close the window through keyboard/menu controls. | The intended tab/window closes; the command does not destroy another pane’s session. |
| Server URL and switching | Set a disposable local/remote server URL, cancel another edit, and switch among known test servers. | Selected server is marked and loaded; bad URLs and unavailable servers have an actionable error. |
| Connect server discovery | Pair only with the local cloud test account; refresh the native Server menu and renew a test session. | Authorized machines are listed, selection follows identity, and unavailable/expired credentials show their reason. |
| Owned and existing runtimes | Start with a test runtime absent, already running, and occupying an incompatible endpoint. | Desktop launches/reuses/prompts as appropriate and does not stop a runtime it does not own. |
| Embedded browser | Open a local fixture URL in a browser tab; navigate/back/forward/reload, focus address, find, and use supported link actions. | Native browser view matches the active pane bounds and location; app shortcuts route to the focused view. |
| Browser policy | Use local fixture links for new-window, external schemes, downloads and disallowed navigation cases from policy tests. | Each is opened or rejected by the documented policy without escaping into a privileged renderer context. |
| Reload, zoom and editing | Use Reload/Force reload, zoom controls, undo/redo/cut/copy/paste/select-all and spelling/context-menu actions. | Actions reach the focused web/editor/native control and preserve documented state. |
| Logs and developer tools | Open Server & Daemon Logs and devtools, change the viewed log, and test unavailable log source. | Displayed data belongs to the owned instance; unavailable actions are disabled or fail explicitly. |
| Updates | On a disposable installation, inspect update status, download/apply only a test release and relaunch. | Version and readiness match updater results; failure preserves a usable install and restart path. |
| Quit and platform appearance | Change theme/transparency settings, then quit with test work idle and inspect owned PIDs. | Window frame/transparency follow platform behavior; quit cleans owned runtime processes and leaves foreign runtimes running. |

## Evidence and cleanup

Record each row and platform separately with the actual entry point, observed
state, persisted side effect, and evidence. Missing hardware/service access is
a prerequisite gap, not a pass. Stop only owned sessions/processes, restore
preferences, and remove only synthetic resources after evidence is preserved.
