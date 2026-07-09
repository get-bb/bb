---
name: share-server-links
description: Share a local HTTP server with the user over bb connect. Use when an agent has started a local HTTP server (dev server, preview, static server) and wants to hand the user a link they can open — especially remotely ("start the dev server", "let me see it", "preview", "open it on my phone", "share a link"). Prefer this over pasting localhost URLs when bb connect may be paired.
---

# Share local server links via bb connect

When you start a local HTTP server the user should open, give them a connect
share URL — not a localhost URL (that only works on the machine running bb).

1. Check pairing: run `bb connect status --json`. If not paired / not
   connected, give the localhost URL and mention that `bb connect` enables
   remote URLs once paired from the getbb.app dashboard.
2. Share the port: `bb connect expose <port>` prints a share URL. Give the
   user that URL as a markdown link. It works for local and remote viewers
   who have the owner's getbb.app session (it is not a public internet link).
3. When the server stops, run `bb connect unexpose <port>` so the share is
   cleaned up.
