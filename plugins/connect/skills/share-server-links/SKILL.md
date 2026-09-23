---
name: share-server-links
description: "Expose a local HTTP server through BB Connect and give the user its remotely accessible URL."
---

# Share local server links via bb connect

When you start an HTTP server the user should open, give them a connect share
URL — not a localhost URL. Shares work from threads running on any enrolled
host, and the command resolves the thread's host automatically.

1. Check remote access: run `bb connect status --json`. If `paired` is
   false, give the localhost URL and mention that remote URLs work once this
   bb is signed in to its bb account (`bb account login`). If `enabled` is
   false, the user turned remote access off with `bb connect off`; give the
   localhost URL and mention `bb connect on`. Don't turn it on or sign in
   yourself unless the user asks.
2. From the thread that started the HTTP server, run `bb connect expose
<port>`. It prints that host's share URL. Use `--host <name-or-id>` only
   when you intentionally need another enrolled host; outside a thread,
   sharing defaults to the machine running the bb server.
3. Give the returned URL to the user as a markdown link. It works for viewers
   who have the owner's getbb.app session; it is not a public internet link.
4. When the server stops, run `bb connect unexpose <port>` from the same
   thread (or with the same `--host`) so the share is cleaned up. Use
   `bb connect shares [--host <name-or-id>]` to inspect that host's shares.

`bb connect --help` and `bb connect <command> --help` print the commands and
their flags and exit 0. Unknown commands and flags fail with a suggestion —
`bb connect list` points at `bb connect shares` — and with `--json` a failure
prints `{"ok":false,"error":{"code":…,"message":…}}` on stdout while the same
message stays on stderr.

Server-host shares use `https://<server-label>--<port>.<base-domain>` through
the server tunnel. Other enrolled hosts use
`https://<machine-label>--<port>.<base-domain>` through their daemon. If a
machine was not enrolled through Connect, expose fails with instructions to
remove and re-add it under Settings > Machines.

## Remote access and the bb account

Remote access runs through the bb account plugin, which holds the getbb.app
pairing. `bb connect off` turns remote access off and keeps the account
signed in; `bb connect on` turns it back on. Both set the connect
`remoteAccess` setting (`bb plugin config connect set remoteAccess false`).
`bb account logout` forgets the
pairing, and `bb account status` shows which account is signed in.
`bb connect --code <code>` still pairs with a dashboard code as an alias of
`bb account login --code <code>`.

## Agent instructions setting

Settings → Installed plugins → Connect has a "Tell agents about remote access"
toggle, enabled by default. Use
`bb plugin config connect set sendRemoteInstructions false` to suppress the
remote-access message, or `true` to restore it. This controls only the message;
sharing still works. The message otherwise requires active or recent remote
usage. Changes apply when session instructions are next assembled.
