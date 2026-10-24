Get a notification when an agent asks a question, finishes a turn, or stops on an error. Choose mobile, web, and desktop delivery independently in Settings → Push notifications.

## Delivery

Mobile devices receive push messages through Expo, including when the app is closed. Web browsers and the desktop app receive system notifications over bb's live connection while a tab or window stays open; web needs HTTPS (or localhost) and permission. Mobile WebViews use mobile push only. Success means web/desktop publication or mobile relay acceptance, not a displayed banner. Web and desktop notifications share a per-thread tag, so clients may replace an earlier notification without a separate banner or re-alert.

Each thread has a level: `all` (questions, approvals, errors, finished turns), `input-only` (no finished turns), or `muted`. A thread uses its own level, else `childLevel` if it has a parent, else `defaultLevel`; every ancestor's own level caps it.

Click a notification to open its thread; on Linux desktop the click also focuses the window. Events arriving together are combined, with pending questions first. Read, archived, deleted, and hidden threads are suppressed. Tabs of the same origin deduplicate delivery.

## Agent notifications

A muted thread sends nothing on its own. Ask the agent to notify you: it calls `notify_user`, which sends for the current thread regardless of level and read state. Channel switches apply. `agentNotifications` (default on) is a kill switch; `agentNotifyCooldownMinutes` (default 5) refuses another attempt on the same thread inside the window. Attempts, including failed ones, consume the cooldown; a send with no channel or device does not. State is in memory and resets on reload or restart. Explicit and automatic notifications are independent, so a thread set to `all` can publish both. `bb push-notifications notify` and the `notifications.send` RPC use the same path. No enabled web/desktop channel and no eligible device, or a failed relay, is an error.

## Thread menu

Every thread menu has **Notifications** for unarchived threads: Default, All activity, Needs input only, Muted; it shows the current level and any parent limit. Metadata stores only a thread's own level.

## Settings

- `mobileEnabled`, `webEnabled`, `desktopEnabled` / **Channels**: phones, browsers, desktop clients. Default: true.
- `defaultLevel` / **Default notifications**: level for threads you haven't set. Default: `all`.
- `childLevel` / **Child thread notifications**: `inherit`, `all`, `input-only`, or `muted`. Default: `input-only`.
- `expoPushUrl` / **Expo push relay URL**: mobile relay endpoint.
- `agentNotifications` / **Model notifications**: let the agent push when it finishes or is blocked and you asked. Default: true.
- `agentNotifyCooldownMinutes` / **Model notification cooldown**: `0`, `1`, `5`, `15`, or `60`. Default: 5.

Switches save immediately and apply per send snapshot, so later changes do not recall an in-flight send. Browser permission is granted per device with **Allow notifications**.

## CLI and SDK

- `bb push-notifications status|list|add|remove|test <web|desktop> [--json]`: inspect switches and devices, manage phones, or send a test.
- `bb push-notifications notify --message <text> [--thread <id>] [--json]`: send for a thread, ignoring its level and read state. `--message-stdin` reads one line from stdin. Defaults to the invoking thread.
- `bb push-notifications thread <thread> [--level inherit|all|input-only|muted]`: read or set a level.
- `bb plugin config push-notifications set <key> <value>`: change a setting.

Failures with `--json` print `{ "ok": false, "error": { "code", "message" } }` on stdout and readable text on stderr. Agents can call `sdk.plugins.callRpc` with `notifications.send` (`{ threadId, message }`), `notifications.test`, `threadNotifications.list`, or `threadNotifications.set`; the builtin `notify_user` tool wraps `notifications.send`.
