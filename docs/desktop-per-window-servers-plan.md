# Per-window servers in the desktop app

Status: implemented on
`bb/support-multiple-independent-bb-desktop-windows-thr_vwd67u4eap`. This is the
implementation spec. Once the feature ships, trim it to the product decisions,
the way `docs/server-move-plan.md` reads.

## Implementation notes

The build follows this spec, with these refinements:

- The store also remembers the last Connect server any window used, so it
  stays in the menu after every window leaves it, as the single remembered
  Connect server did before.
- The first runtime start at launch keeps the existing-server dialog and the
  detailed error pages without buttons. Later starts attach silently and show
  the retryable "Could not connect to bb server" page, as switching to the
  built-in server did before.
- The shared runtime request reads the move lock first. A window that picks
  This Mac while a committed move has gone unnoticed starts the move, so it
  follows the move with every other This Mac window.
- A server's system config sync starts once a window on it has loaded the
  app, as before. Starting it when the runtime process spawned logged a
  failed fetch.
- `DesktopBrowserViewManager.releaseWindow` now detaches the tab views of a
  window that stays open, which a server switch needs. Closed windows behave
  as before.
- After live testing, File ▸ New Window on and the palette's "Open … in New
  Window" were dropped (decision 3). New Window plus the Server menu covers
  the same need, and the desktop bridge and app code stay unchanged.

## Goal

Each desktop window targets its own bb server. Today the target is app-wide:
picking a server in any window reloads every window on that server. People who
run This Mac and a remote server, or several remote servers, want them side by
side.

Background: #1451 asks for this. #605 added per-window servers together with a
sidebar switcher, and #628 removed both two days later in favor of a global
target picked from the native menu. #2740 tried again and was closed as stale.
This design keeps #628's native-menu model and makes only the target per
window.

## Decisions

### Behavior

1. Picking a server switches only the window it was picked from. This applies
   to Window ▸ Server, bb ▸ Desktop Settings ▸ Server, the palette's
   "Switch to …", and an error page's "Choose server…". The Server menu's
   checkmark shows the focused window's server.
2. File ▸ New Window opens the focused window's server at its home page. When
   no window is open (dock click, second launch, nothing to restore), a new
   window opens on the server of the most recently focused window. This
   *default target* persists across launches and replaces today's global
   target.
3. No action opens a new window on a chosen server. To show another server in
   a new window, open it with New Window, then switch it.
4. Every window reopens on its own server after a quit, relaunch, or update. On
   upgrade, existing windows open on whatever the global target was.
5. While windows are open on two or more different servers, each window title
   ends with ` — <server name>`, using the same names as the menu. There is no
   in-app indicator.
6. The native menu, including shortcuts from the server's keybinding settings,
   and `nativeTheme` (light/dark) follow the focused window.
7. Set Server URL… edits the focused window's custom server. If that window
   isn't on a custom server, it acts as Add Server…. Add Server… switches only
   the focused window. Saving an edit moves every window on the old URL to the
   new URL. Clearing the URL removes the server and moves every window on it to
   This Mac.
8. Everything else is per window or per server:
   - When This Mac's server moves to another machine, only windows on This Mac
     follow it. The default follows too if it was This Mac.
   - Errors and their buttons belong to one window. A single Connect sign-in
     retries every window that was waiting on it.
   - Switching a window clears only that window's in-app browser tabs. Agents
     on a server can drive only windows on that server.
   - The local runtime keeps running when no window uses This Mac.
   - Any bb window, including a page served by a remote server, can switch
     itself, but only to servers already in the list.

### Out of scope

- A CLI or SDK way to do this. This is a deliberate exception to the AGENTS.md
  rule that features must work through the CLI and SDK. The existing Server
  menu has no such surface either, and the CLI has no channel to the desktop
  process. Letting plugins open windows stays with #5342.
- An in-app server switcher, such as #2740's sidebar indicator and Connection
  settings page.
- #5334: duplicate menu entries, and naming of getbb.app custom URLs.

### Smaller calls made in this spec

Flag any of these if you disagree:

- Per-window targets live in `server-target.json` under `windowTargets`, keyed
  by window state key, not in `window-state.json`. The store stays the only
  writer, and a switch is saved immediately, as the global target is today.
  Window size and position are still saved only on quit.
- The file keeps its v1 fields, which now describe the default target. A
  downgraded app therefore opens the default server with the saved list.
- If you choose or add a server from the menus while no bb window is open
  (macOS), it becomes the default target, as the global target did before. No
  window opens until New Window or a dock click.
- Windows on the same Connect server share one sign-in attempt and one renewal
  timer.
- A window's in-app browser stays registered with its server even while the
  window shows an error page, as today.
- The application menu is rebuilt every time a bb window gains focus.
- The title separator is ` — `, which keeps it distinct from the app's own
  ` · `. Loading and error pages read `bb — <server>`.
- When Connect account sync renames a server, titles and menus update right
  away. A URL change takes effect on the window's next load, as today.
- Server moves change behavior slightly; see section 8.

## Root cause

- `apps/desktop/src/desktop-window-factory.ts:331`: `loadUrl()` loads one URL
  into every window.
- `apps/desktop/src/main.ts:1754`: `applyServerTarget()` reads the single
  app-wide target from `server-target.json` and calls `loadUrl()`.
- `apps/desktop/src/main.ts:826`: `createNewWindow()` reuses
  `currentWindowUrl`.
- More app-wide singletons in `main.ts`: `currentWindowUrl`, `bbAppLoaded`,
  `startupErrorPage`, `startupActionPending`, `serverTargetGeneration`,
  `connectSessionRenewal`, `systemConfigSync`, `systemConfigRefreshToken`,
  `currentAppKeybindings`, `desktopBrowserBrokerClient`. The browser broker
  also keeps a single `hostId`.

Switching per window needs no renderer change. The palette already sends
`selectServer` over IPC, and the main process can answer for `event.sender`.
Remote servers on older app code get the new behavior from the desktop update
alone.

## Design

### 1. Targets and persistence: `apps/desktop/src/server-target.ts`

Export the target type, which is module-private today:

```ts
export type DesktopServerTarget =
  | { kind: "builtin" }
  | { kind: "connect"; server: ConnectServerRef }
  | { kind: "custom"; url: string };
```

`serverTargetId(target)` and `serverTargetName(target)` go in
`apps/desktop/src/server-list.ts`, next to `customServerId`. That avoids a
circular import.
- `serverTargetId` returns the menu's existing choice ID: `builtin`,
  `connect:<handle>`, or `customServerId(url)`.
- `serverTargetName` returns the menu label: `BUILTIN_SERVER_NAME`, the Connect
  server name, or the custom URL's host.

`server-target.json` keeps its v1 fields and gains `windowTargets`:

```json
{
  "target": "custom",
  "connectServer": { "handle": "brsbl", "name": "brsbl", "url": "https://brsbl.getbb.app" },
  "customServerUrl": "https://scott-beelink-ubuntu.hair-salmon.ts.net:38443",
  "customServerUrls": ["https://scott-beelink-ubuntu.hair-salmon.ts.net:38443"],
  "windowTargets": {
    "main": { "kind": "builtin" },
    "window-6f1c…": { "kind": "custom", "url": "https://scott-beelink-ubuntu.hair-salmon.ts.net:38443" },
    "window-a93e…": {
      "kind": "connect",
      "server": { "handle": "brsbl", "name": "brsbl", "url": "https://brsbl.getbb.app" }
    }
  }
}
```

- `target`, `connectServer`, and `customServerUrl` now describe the default
  target, written in the v1 shape. Older builds parse with a non-strict zod
  object and drop `windowTargets`.
- `windowTargets` maps window state keys (`main`, `window-<uuid>`) to full
  targets. A connect target stores the whole ref, so a window can restore
  before Connect account sync answers.
- On load, a missing `windowTargets` means `{}`. Invalid entries are dropped one
  at a time, so one bad entry can't reset the saved list. Custom URLs are
  normalized. A custom window target whose URL isn't in the saved list gets
  added to it.

New store interface:

```ts
export interface ServerTargetStore {
  load(): Promise<void>;
  getCustomServerUrls(): string[];
  getDefaultTarget(): DesktopServerTarget;
  setDefaultTarget(target: DesktopServerTarget): Promise<void>;
  getWindowTarget(stateKey: WindowStateKey): DesktopServerTarget | null;
  setWindowTarget(stateKey: WindowStateKey, target: DesktopServerTarget): Promise<void>;
  removeWindowTarget(stateKey: WindowStateKey): Promise<void>;
  pruneWindowTargets(keep: ReadonlySet<WindowStateKey>): Promise<void>;
  listReferencedConnectServers(): ConnectServerRef[];
  refreshConnectServer(server: ConnectServerRef): Promise<boolean>;
  addCustomServerUrl(url: string): Promise<string>;
  replaceCustomServerUrl(previousUrl: string, url: string): Promise<WindowStateKey[]>;
  removeCustomServerUrl(url: string): Promise<WindowStateKey[]>;
  retargetBuiltin(target: DesktopServerTarget): Promise<WindowStateKey[]>;
}
```

- Removed: `getTarget`, `setTarget`, `getConnectServer`, `getCustomServerUrl`,
  `setConnectServer`, `setCustomServerUrl`.
- Writes keep the existing `pendingPersist` chain.
- `setDefaultTarget` and `setWindowTarget` skip the write when nothing changed,
  since focus changes call them often.
- `replaceCustomServerUrl` rewrites the saved list, the default, and every
  window target on the previous URL, and returns the affected state keys.
- `removeCustomServerUrl` drops the URL from the saved list and moves the
  default and every window target on it to builtin. It returns the affected
  keys.
- `retargetBuiltin(target)` points the default (if builtin) and every builtin
  window target at `target`, adding a custom URL to the saved list. It returns
  the affected keys. Server moves use it.
- `refreshConnectServer` updates the name and URL in the default and in every
  window target with that handle.
- `listReferencedConnectServers` returns the distinct Connect refs used by the
  default and by window targets. The menu uses it to list a window's server
  even when account sync doesn't return it. It replaces today's single
  `getConnectServer()`.

### 2. Window sessions: `apps/desktop/src/main.ts`

Replace the singletons with one record per application window:

```ts
interface ApplicationWindowSession {
  actionPage: StartupErrorPage | null;
  actionPending: boolean;
  appLoaded: boolean;
  awaitingConnectSignIn: boolean;
  browserWindow: BrowserWindow;
  generation: number;
  pageTitle: string;
  stateKey: WindowStateKey;
  target: DesktopServerTarget;
  themePreference: BbDesktopTheme | null;
}

const windowSessions = new Map<number, ApplicationWindowSession>();
let lastFocusedWebContentsId: number | null = null;
```

Lifecycle:

- `openApplicationWindow({ target, stateKey })` creates the window through the
  factory and records its session. It then calls
  `setWindowTarget(stateKey, target)`, shows the loading view, and runs
  `applyWindowTarget(session)`.
- `registerApplicationWindow(session)` keeps its current wiring. It also adds a
  `page-title-updated` handler (section 6) and registers the window with the
  browser broker under its server origin (section 7).
- `app.on("browser-window-focus")`, for a bb window: set
  `lastFocusedWebContentsId`, call `setDefaultTarget(session.target)`, apply
  the session's theme, and rebuild the menu. When the focused window switches
  server, the default updates too.
- `closed`: drop the session. Call `removeWindowTarget(stateKey)` unless the
  app is quitting, matching `removePersistedWindowState`. Then reconcile
  per-server services and recompute titles.
- `targetSession()` returns the focused bb window's session, otherwise the most
  recently focused one, otherwise null. Menu actions, dialogs, and New Window
  use it. `getFocusedApplicationWindow()` stays for dialog parents.

| Entry point | Target |
| --- | --- |
| File ▸ New Window | `targetSession()?.target ?? store.getDefaultTarget()` |
| `activate` or `second-instance` with no windows open | `store.getDefaultTarget()` |
| Restoring saved windows | `store.getWindowTarget(stateKey) ?? store.getDefaultTarget()` |

Startup in `runDesktopApp`:

1. `store.load()`, which also migrates the file.
2. Restore windows; the factory now returns their state keys. Resolve each
   window's target, save it, and show the loading view.
3. `pruneWindowTargets(restoredKeys)`.
4. `activateLocalServerMoveIfLocked()`. This may retarget builtin windows
   (section 8).
5. If any window targets builtin and no move is active, start the moved-server
   watcher and call `ensureBuiltinRuntime({ askBeforeAttaching: true })` once.
6. Run `applyWindowTarget` for every window, concurrently.
7. If any window targets a remote server, call `connectServerSync.syncNow()`.

### 3. Loading a window: `applyWindowTarget(session)`

This replaces `applyServerTarget()` and works on one session:

- Increment `session.generation` and capture it. Define
  `isCurrent = () => !session.browserWindow.isDestroyed() && session.generation === generation`.
- Clear the session's `actionPage` and `awaitingConnectSignIn`. If the window's
  server origin changed, move its broker instance (section 7) and reconcile
  per-server services.
- **builtin:** if a local move is committed, show the moved view in this
  window. Otherwise await `ensureBuiltinRuntime()`. On failure, show its error
  in this window. On success, load `resolveDesktopWindowUrl` with the runtime
  URL.
- **connect:** call `authenticateConnectServer(server)`. If unauthorized, set
  `awaitingConnectSignIn` and show the Reconnect page. On success, start that
  server's renewal and load through `loadRemoteServerPage`, using this
  window's `loadUrl`, `loadStartupError`, and `isCurrent`.
- **custom:** `loadRemoteServerPage`.
- Finally, rebuild the menu if this window is the target session, and
  recompute titles.

Per-window helpers replace the global ones: `loadWindowUrl(session, url)`,
`loadLoadingView(session)`, `loadStartupError(session, args)`,
`loadActionView(session, args)`, and `loadBbApp(session, url)`.
`BB_DESKTOP_OPEN_DEVTOOLS=1` opens DevTools for the window that loaded.
`STARTUP_ACTION_CHANNEL` checks the request against
`windowSessions.get(sender.id)?.actionPage`, and
`runStartupAction(session, action)` uses that session's `actionPending`. Fatal
errors from `runDesktopApp().catch` still go to every window.

**Builtin runtime**

- `ensureBuiltinRuntime(options)` merges `initializeRuntime` and
  `ensureBuiltinRuntimeAttached` into one shared promise, so concurrent builtin
  windows start or attach the runtime once. It returns
  `{ ok: true; serverUrl: string } | { ok: false; error: LoadStartupErrorArgs }`.
- The first call at startup keeps the existing-server dialog (attach, start
  fresh, or quit). Later calls attach silently, as today. A failure clears the
  shared promise, so Try again runs it again.
- `startOwnedRuntime` returns its errors instead of loading them into windows.
- When the owned process exits, only builtin windows show "bb stopped".
- The runtime is never stopped just because no window uses it.

**Connect**

- `authenticateConnectServer(server)` wraps `authenticateConnectTarget` with one
  in-flight promise per server URL. Its `isCurrent` is "some window still
  targets this URL".
- Session renewal becomes `connectSessionRenewals: Map<string, ConnectSessionRenewal>`,
  keyed by server URL. A renewal starts on successful auth and stops during
  reconciliation once no window targets that URL. `did-become-active` calls
  `renewIfDue()` on each renewal. Each renewal's `authenticate` callback checks
  that a window still targets its URL.
- `openConnectSignIn(session)` derives the account URL from that session's
  server. When the account cookie lands, re-apply every session where
  `awaitingConnectSignIn` is set and whose server derives the same account URL.

### 4. Window factory: `apps/desktop/src/desktop-window-factory.ts`

- `createWindow` returns `{ browserWindow, stateKey }`, and
  `restoreSavedWindows` returns the same pairs.
- `loadUrl({ browserWindow, url })` loads a single window. Delete the loop that
  loads every window: it is the bug.
- `openDevTools(browserWindow)` replaces the version that opens every window.

`window-state.ts` keeps storing only window size, position, and state.

### 5. Server choices, menus, palette

**`apps/desktop/src/server-list.ts`**

- `buildDesktopServerChoices({ activeTarget, connectServers, customServerUrls })`
  sets `active` from the given window's target.
- Menu Connect servers are the account servers plus any
  `listReferencedConnectServers()` entries not in that list.
- `connectServerSync.onServers` calls `refreshConnectServer` for every
  referenced handle that sync returns, then rebuilds menus and titles.

**`apps/desktop/src/menu.ts`**

- Both Server submenus (bb ▸ Desktop Settings and Window) check the target
  session's server. Selecting one calls `selectServerForWindow(session, id)`.
- With no bb window open, selecting or adding a server sets the default
  target.
- Rebuild the menu when a bb window gains focus, when the target session
  changes server, when choices change, and when the focused server's
  keybindings change.
- `popupServerMenu(session)`, used by Choose server…, binds selection to that
  session.

**`apps/desktop/src/server-choice-ipc.ts`**

```ts
registerServerChoiceIpc({
  applicationWindowWebContentsIds,
  onListRequested,
  list: (webContentsId: number) => listServerChoices(webContentsId),
  select: (webContentsId: number, id: string) => selectServerForSender(webContentsId, id),
  onError,
});
```

- `get-server-choices` answers for the window that asked.
- `select-server` accepts a choice only if it isn't already that window's
  server.
- Both keep the existing check that the sender is a bb window's main frame.
- `server-choices-changed` sends each window its own list.

**Contract, preload, and app**

No change. The palette's "Switch to X" already omits the active choice, which
is now the asking window's server, and `selectServer` already acts on the
window that sends it.

### 6. Window titles

New `apps/desktop/src/window-title.ts`:

```ts
export function formatApplicationWindowTitle(args: {
  pageTitle: string;
  serverName: string | null;
}): string;

export function shouldShowServerInWindowTitles(targetIds: Iterable<string>): boolean;
```

- Each bb window handles `page-title-updated`: call `preventDefault()`, save the
  page title on the session, and `setTitle(...)`.
- `applyWindowTitles()` recomputes every window's title when a window opens,
  closes, or changes server, and when a Connect server is renamed.
- Local views (loading and error pages) have the page title `bb`, so they read
  `bb — brsbl`.

### 7. Per-server services

`reconcileServerServices()` runs after any change of server, window open or
close, and runtime attach or stop. It works out which server URLs are in use
(builtin resolves to the runtime URL), then starts or stops:

- **System config sync:** a local WebSocket for builtin and a 5-minute poll for
  remote servers, as today. Each sync stores that server's keybindings.
- **Desktop browser broker clients.**
- **Connect session renewals.**
- **The moved-server watcher:** running while any window targets builtin and no
  move is committed.

**Keybindings and theme**

- `keybindingsByServerUrl: Map<string, AppKeybindings>`. Menu shortcuts come
  from the target session's server. If none are known yet, use
  `DEFAULT_APPLICATION_MENU_ACCELERATORS`.
- `resolveAppCommand(input, hostWebContentsId)`, which handles shortcuts inside
  in-app browser tabs, uses the host window's server keybindings.
- `bb-desktop:set-theme` stores the preference on the sender's session. It sets
  `nativeTheme.themeSource` only if the sender is the target session. When
  focus moves, apply the newly focused session's stored preference.

**Desktop browser broker**: `desktop-browser-broker.ts` and
`desktop-browser-broker-client.ts`

- Each instance carries its window's server origin, set by
  `registerWindow(window, serverOrigin)`.
- New `setWindowServer(webContentsId, serverOrigin)`:
  - revokes the instance's leases;
  - calls `manager.releaseWindow(webContentsId)`, which disposes that window's
    tabs and their popups;
  - clears the instance's threads and snapshots;
  - gives it a new generation;
  - notifies registry listeners.

  `resetServer()` goes away.
- `hostId` becomes per origin, via `setHostId(serverOrigin, hostId | null)`.
  `getTarget(webContentsId)` and `reveal` use the instance's origin.
- `listInstances(serverOrigin)`, `subscribe(serverOrigin, listener)`, and
  `execute(serverOrigin, command)` see only instances for that origin.
  `requireInstance` rejects an instance that belongs to another origin. This is
  the security boundary that keeps server A's agents out of windows on
  server B, and it needs a test.
- The client takes a fixed `serverOrigin` instead of calling `getServerUrl()`.
  `main.ts` keeps a `Map<string, client>` keyed by origin, and reconciliation
  replaces `reconnect()` on switch.
- The wire messages don't change, so `HOST_DAEMON_PROTOCOL_VERSION` stays the
  same. Each connection still sends `register`, change events, and results;
  only the set of windows it registers changes.

### 8. Server moves: `apps/desktop/src/server-moved.ts`

- `applyServerMove` and `openServerMoveTarget` take the new store and call
  `retargetBuiltin(move.target)`. `main.ts` re-applies the affected sessions.
  The notice still shows once per `moveId`.
- **Behavior change:** today, the first time the app notices a move, it
  retargets even if the app was on a remote server (`applyServerMove`,
  `server-moved.ts:359`). Now only builtin windows, and the default if it was
  builtin, follow the move.
- `handleWatchedServerMove` stops the watcher when no window targets builtin.
  For a custom destination it still waits for `/health`. The affected sessions
  then reload, each checking its own generation.
- `selectBuiltinServer(session)` shows the moved view in that window when a
  committed move exists. Its Open \<host\> button retargets only that window.

### 9. Custom server edits: `openSetServerUrlDialog`

- It acts on `targetSession()`. Edit mode opens only if that window is on a
  custom server; otherwise the dialog is Add Server…. With no window open,
  adding a server makes it the default target.
- **Add:** `addCustomServerUrl`, then switch the target session to it.
- **Edit:** `replaceCustomServerUrl`, then reload every affected window.
- **Clear:** `removeCustomServerUrl`. Each affected window goes through
  `selectBuiltinServer`.

### 10. Compatibility

| Pairing | Result |
| --- | --- |
| This desktop build, any server version | The app code is unchanged, so the palette's Switch to works on every server and switches only the asking window. |
| Downgrade after using this build | The older app opens the default server with the saved list and ignores per-window targets. |
| Host daemon | No protocol change. |

## Tests

`apps/desktop` (these files exist unless marked new):

- `server-target.test.ts`, `server-target-persistence.test.ts`:
  - A v1 file loads as the default target plus the saved list, with no window
    targets.
  - Window targets round-trip.
  - A bad entry is dropped without losing the rest.
  - The v1 fields are still written.
  - Replace, remove, and retarget rewrite the default and only the matching
    window targets, and return their keys.
  - `refreshConnectServer` updates every reference.
  - An unchanged `setDefaultTarget` doesn't write.
- `desktop-window-factory.test.ts`:
  - Loading a URL into one window leaves the other window's URL unchanged. This
    is the regression test for the root cause.
  - `createWindow` and restore return state keys.
- `server-choice-ipc.test.ts`:
  - List and select answer per sender.
  - Select rejects the sender's current server and unknown IDs.
- `window-title.test.ts` (new):
  - The suffix appears only with two or more distinct servers.
  - Separator.
  - A null server name gives no suffix.
- `desktop-browser-broker-*.test.ts`:
  - Instances are listed per origin.
  - `execute` rejects an instance from another origin.
  - `setWindowServer` revokes leases, disposes only that window's tabs, and
    changes its generation.
  - `getTarget` uses the origin's host ID.
- `server-moved.test.ts`:
  - Builtin windows and a builtin default follow a move.
  - Remote windows don't, even the first time the move is noticed.
  - The notice shows once.

The orchestration in `main.ts`, including the menu checkmark that follows
focus, runs Electron, so it isn't unit-tested; the live run below covers it.
Run `pnpm exec turbo run typecheck test --filter=@bb/desktop` and write the
output to a file.

## Docs

- `apps/desktop/README.md`, "Saved servers": per-window targets, the default
  target, New Window, the Set Server URL… rules, `windowTargets` in
  `server-target.json`, and the palette's per-window Switch to.
- `apps/desktop/README.md`, "Server moves": only windows on This Mac follow a
  move.
- `.bb/skills/verify-bb/features/desktop.md`: update "Server URL and
  switching", and add a per-window servers recipe.

## Verification

Live run on the Mac:

1. Run this checkout's `pnpm dev` through Portless
   (`PORTLESS_TAILSCALE=1 portless`). The dev desktop app treats it as
   This Mac.
2. Start a second throwaway server with its own `BB_DATA_DIR` through
   `portless run --tailscale`, and add it with Add Server….
3. Run `pnpm exec turbo run dev --filter=@bb/desktop` with its own
   `BB_DESKTOP_USER_DATA_DIR` and a CDP port in `BB_DESKTOP_ELECTRON_ARGS`.

Checks:

- Window A on This Mac, window B switched to server 2: A doesn't reload, titles
  gain suffixes, and the checkmark follows focus.
- New Window opens on the focused window's server. With every window closed,
  choosing a server in the menu sets where the next window opens.
- Quit and relaunch: both windows come back on their servers.
- Edit server 2's URL with two windows on it: both follow. Clear it: both move
  to This Mac.
- Stop server 2: only its window shows the error, and Try again recovers it.
- `bb browser instances` (dev CLI pointed at each server) lists only that
  server's windows.
- Native-menu steps need macOS Accessibility automation. If it isn't already
  allowed, list those steps for a manual click-through instead.
- Connect paths are covered by unit tests. Check them live only if the Local
  Cloud setup in `docs/debugging-and-qa.md` is available; otherwise report them
  as not verified.
- Afterwards, stop every server and the dev app.

## Implementation order

1. Store and server choices (section 1; `server-list.ts` in section 5).
2. Per-window loading in the factory (section 4).
3. Window sessions, per-window loading, restore, and the default target
   (sections 2 and 3).
4. Per-server services, plus the menu and theme following focus (section 7,
   except the broker).
5. Per-origin browser broker (section 7).
6. Server moves (section 8) and custom server edits (section 9).
7. Titles (section 6).
8. Per-window server choice IPC (section 5).
9. Docs, live verification, and the PR. The PR body states the CLI/SDK
   exception.
