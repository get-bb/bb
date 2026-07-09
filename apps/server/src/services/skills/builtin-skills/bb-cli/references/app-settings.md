# bb app settings reference

Server-backed preferences in Settings → General. They are persisted on the
server, so every window and client sees the same value.

## Caffeinate (macOS only)

- Keeps the Mac awake while bb is running: when enabled, the server asks the
  primary host daemon to run `/usr/bin/caffeinate -i -w <daemon-pid>`. Turning
  it off stops that process.
- It only blocks idle sleep: closing a laptop lid or choosing Sleep manually
  still sleeps the Mac.
- The toggle is only shown when the connected primary host daemon reports
  macOS.
- The setting is re-applied automatically whenever the host daemon reconnects,
  and the caffeinate process exits on its own if the daemon dies.
