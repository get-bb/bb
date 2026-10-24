---
name: push-notifications
description: "Register mobile devices, toggle mobile, web, and desktop notification channels, set per-thread notification levels, or test delivery for BB push notifications."
---

# Push notifications

The plugin notifies when a thread asks a question, finishes a turn, or stops on
an error. Mobile devices receive Expo push messages even when the app is
closed. Web and desktop clients receive system notifications only while a bb
tab or app window stays open, and each browser grants permission separately in
the plugin settings.

```sh
bb push-notifications status [--json]
bb push-notifications list [--json]
bb push-notifications add --token <expo-push-token> --platform <ios|android> --label <device-name> [--json]
bb push-notifications remove <id> [--json]
bb push-notifications test <web|desktop> [--json]
bb push-notifications notify --message <text> [--thread <thread>] [--json]
printf '%s\n' 'Build finished' | bb push-notifications notify --message-stdin [--thread <thread>] [--json]
bb push-notifications thread <thread> [--level inherit|all|input-only|muted]
bb plugin config push-notifications set <mobileEnabled|webEnabled|desktopEnabled> <true|false>
bb plugin config push-notifications set <agentNotifications> <true|false>
bb plugin config push-notifications set <agentNotifyCooldownMinutes> <0|1|5|15|60>
bb plugin config push-notifications set defaultLevel <all|input-only|muted>
bb plugin config push-notifications set childLevel <inherit|all|input-only|muted>
bb plugin config push-notifications set expoPushUrl <url>
```

- `add` upserts by token: a known token refreshes its label and last-seen time
  and keeps its id. Expo tokens that are no longer registered are removed after
  a failed delivery.
- `list` shows token suffixes only.
- The three channel switches default to `true` and apply immediately to this
  server. Sends select registered devices, then read settings immediately before dispatch. Later changes do not recall an in-flight send. `bb plugin disable push-notifications` stops new delivery and drains admitted sends.
- `test` broadcasts to every connected, permitted client of that type and
  fails when the channel is disabled. Success confirms the broadcast, not that
  the OS showed a banner; system notification settings can still suppress it.
- `notify` sends for one thread immediately, ignoring that thread's
  notification level and read state. It needs `agentNotifications` on and
  respects `agentNotifyCooldownMinutes` (default 5), which refuses a second
  attempt on the same thread inside the window. Failed delivery attempts also consume the cooldown; a send with no available channel or device does not. The cooldown is kept in memory
  and resets on plugin reload or server restart. Explicit sends do not suppress automatic notifications; use `muted` for only requested pushes. Web/desktop notifications share a per-thread tag, so the browser or OS may replace an earlier notification without a separate banner or re-alert. The agent's `notify_user` tool and the `notifications.send` RPC use the same path. Success confirms web/desktop publication or mobile relay acceptance, not display; an enabled web/desktop channel can succeed with no connected client. No enabled web/desktop channel and no eligible mobile device, or a mobile relay failure, is an error. Use `--message-stdin` instead of `--message <text>` to read one nonempty line from piped stdin without putting the message in process arguments.
- `agentNotifications` (default `true`) lets the agent push when you asked it
  to, for example when a task finishes or it is blocked. `agentNotifyCooldownMinutes`
  (`0`, `1`, `5`, `15`, or `60`, default `5`) sets the per-thread cooldown;
  `0` disables the limit.
- `thread` prints a thread's resolved notification level and its source;
  `--level` sets the thread's own level. A thread uses its own level, else
  `childLevel` if it has a parent (default `input-only`; `inherit` follows
  `defaultLevel`), else `defaultLevel` (default `all`). Every ancestor's own
  level also caps its child threads. `all` notifies on finished turns too,
  `input-only` keeps questions, approvals, and errors only, and `muted` sends
  nothing.

Inspect `status` before changing a channel, and change only the requested
channel or device.
