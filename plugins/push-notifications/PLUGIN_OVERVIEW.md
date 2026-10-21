Get a notification when an agent asks a question, finishes a turn, or stops on an error. Choose mobile, web, and desktop delivery independently in Settings → Push notifications.

## Delivery

Mobile devices receive push messages through Expo, including when the app is closed. Web browsers and the desktop app receive system notifications over bb's live connection while a tab or window stays open; web delivery needs HTTPS (or localhost) and notification permission. Mobile WebViews use mobile push only.

Each thread has a level: `all` (questions, approvals, errors, finished turns), `input-only` (no finished turns), or `muted`. A thread uses its own level, else `childLevel` if it has a parent, else `defaultLevel`; every ancestor's own level caps it. Muting a parent mutes its whole subtree, but a parent never makes workers louder. The level applies on top of the suppressions below.

Click a notification to open its thread; on Linux desktop the click also restores and focuses the window. Events arriving together are combined, with pending questions taking priority. Read, archived, deleted, and hidden threads are suppressed. Tabs of the same origin deduplicate delivery.

## Notification Hint

After a sent thread runs longer than 60 seconds or waits for input, a composer Hint offers undecided notification permission. Status banners take priority. **Turn on** requests permission; success confirms for three seconds, and denial hides the Hint. **Not now** snoozes it for 14 days, then permanently on a second dismissal. Suppression is shared per install; permission remains local.

## Thread menu

Unarchived thread menus offer **Notifications**: Default, All activity, Needs input only, Muted. Default names its fallback; a footnote identifies parent limits.

## Settings

- `mobileEnabled`, `webEnabled`, `desktopEnabled`: channel switches, all true by default.
- `defaultLevel`: `all`, `input-only`, or `muted`. Default: `all`.
- `childLevel`: `inherit` (uses `defaultLevel`), `all`, `input-only`, or `muted`. Default: `input-only`.
- `expoPushUrl`: mobile relay, default `https://exp.host/--/api/v2/push/send`.

Channel switches apply to this server and save immediately. Browser permission is granted per device with **Allow notifications**. **Send test notification** confirms broadcast, not OS display.

## CLI and SDK

- `bb push-notifications list [--json]`: registered mobile devices, with redacted tokens.
- `bb push-notifications add --token <expo-push-token> --platform <ios|android> --label <device-label> [--json]`: register or refresh a mobile device.
- `bb push-notifications remove <id> [--json]`: remove a mobile device.
- `bb push-notifications hint [--reset] [--json]`: read or reset Hint state without changing permission.
- `bb push-notifications status [--json]`: switches, defaults, relay, device count, and last mobile send.
- `bb push-notifications test <web|desktop> [--json]`: broadcast a test to connected clients of that type. Fails if the channel is disabled.
- `bb push-notifications thread <thread> [--level inherit|all|input-only|muted] [--json]`: print the resolved level and source; `--level` sets it.
- `bb plugin config push-notifications set <mobileEnabled|webEnabled|desktopEnabled> <true|false>`: change a channel.
- `bb plugin config push-notifications set <defaultLevel|childLevel> <level>`: change a default.

Every command takes `--help`. A failure with `--json` prints `{ "ok": false, "error": { "code", "message" } }` on stdout and the readable text on stderr.

Agents can use the SDK's plugin settings API for the same switches and `sdk.plugins.callRpc` with method `notifications.test` (`{ channel }`), `threadNotifications.list` (`{ threadIds }`, up to 200), or `threadNotifications.set` (`{ threadId, level }`). Permission requests still require a click in the target client.

`notificationsHint.state` and `notificationsHint.reset` take `{}` to read/reset Hint state. See the shipped skill for eligibility and action RPCs.
