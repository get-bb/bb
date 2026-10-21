Get a notification when an agent asks a question, finishes a turn, or stops on an error. Choose mobile, web, and desktop delivery in Settings → Push notifications.

## Delivery

Mobile devices receive Expo push messages even when the app is closed. Web browsers and desktop clients receive system notifications over bb's live connection while a tab or window stays open. Web delivery needs HTTPS (or localhost) and permission. Mobile WebViews use mobile push only.

Thread levels are `all` (questions, approvals, errors, finished turns), `input-only` (no finished turns), or `muted`. A thread uses its own level, else `childLevel` when it has a parent, else `defaultLevel`. Every ancestor's own level caps it: muting a parent mutes its subtree.

Click a notification to open its thread; Linux desktop also restores the window. Nearby events combine, with questions taking priority. Read, archived, deleted, and hidden threads are suppressed. Tabs of the same origin deduplicate delivery.

Accepted Next steps hold completed results until the reminder time or the next app opening after acceptance, whichever comes first. Opening before completion releases the result when ready. Held results and cancellations survive restart. Cancel reminder suppresses delivery without stopping work. Legacy one-time suggestions notify on completion. Success uses `day2_result`; failure uses `failed` with a retry instruction. Current notification settings still apply. Anonymous `notification_sent` records only kind and channel, respects telemetry opt-out, and excludes tests.

## Thread menu and settings

Unarchived threads have a **Notifications** menu: Default, All activity, Needs input only, Muted. Metadata stores only the thread's own level; limits follow the current parent chain.

- `mobileEnabled`, `webEnabled`, `desktopEnabled`: channel switches, all default true.
- `defaultLevel`: `all` (default), `input-only`, or `muted`.
- `childLevel`: `inherit`, `all`, `input-only` (default), or `muted`; inherit follows `defaultLevel`.
- `expoPushUrl`: mobile relay, default `https://exp.host/--/api/v2/push/send`.

Switches apply to this server immediately. **Allow notifications** grants permission on this device. **Send test notification** confirms broadcast, not OS display.

## CLI and SDK

- `bb push-notifications list [--json]`: devices, with redacted tokens.
- `bb push-notifications add --token <expo-push-token> --platform <ios|android> --label <device-label> [--json]`: register or refresh a device.
- `bb push-notifications remove <id> [--json]`: remove a device.
- `bb push-notifications status [--json]`: settings, device count, and last mobile send.
- `bb push-notifications opened [--json]`: record a return and release ready result reminders using server time.
- `bb push-notifications test <web|desktop> [--json]`: test connected clients; disabled channels fail.
- `bb push-notifications thread <thread> [--level inherit|all|input-only|muted] [--json]`: resolve or set a thread's level.
- `bb plugin config push-notifications set <setting> <value>`: change the settings above.

Commands support `--help` and structured `--json` errors. SDK plugin settings use the same switches. With `sdk.plugins.callRpc`, call `notifications.test` with `{ channel }`, `threadNotifications.list` with `{ threadIds }` (up to 200), or `threadNotifications.set` with `{ threadId, level }`.

`experimental_day2AppOpened` takes `{}` and records server time; `experimental_cancelDay2Result` takes `{ automationId }` and cancels only that reminder, including before completion. Both return `{ ok: true }`. Core uses these paths for app openings and Cancel reminder; CLI `opened` uses the same sender path. Permission requests still require a client click.
