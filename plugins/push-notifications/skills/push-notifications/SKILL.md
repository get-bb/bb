---
name: push-notifications
description: "Register mobile devices, toggle mobile, web, and desktop notification channels, or test delivery for BB push notifications."
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
bb plugin config push-notifications set <mobileEnabled|webEnabled|desktopEnabled> <true|false>
bb plugin config push-notifications set expoPushUrl <url>
```

- `add` upserts by token: a known token refreshes its label and last-seen time
  and keeps its id. Expo tokens that are no longer registered are removed after
  a failed delivery.
- `list` shows token suffixes only.
- The three channel switches default to `true` and apply immediately to this
  server. `bb plugin disable push-notifications` stops all delivery.
- `test` broadcasts to every connected, permitted client of that type and
  fails when the channel is disabled. Success confirms the broadcast, not that
  the OS showed a banner; system notification settings can still suppress it.

Inspect `status` before changing a channel, and change only the requested
channel or device.
