Open your bb from a phone or another computer. Once this bb is signed in to your bb account, it answers at `https://<handle>.getbb.app` for anyone signed in to your getbb.app account.

## What you get

- Remote access to the full bb app through a tunnel. Your bb makes an outbound connection, so you do not open ports or change your router.
- Port shares. Publish a local HTTP server, such as a dev server, at a share URL. The link opens from any device with your session.
- Pairing for the bb mobile app with a QR code or a one-time code.
- A Remote access section in Settings, and a sidebar shortcut to it, with the connection state and the remote URL.

## How it works

Remote access uses the bb account plugin. Sign in from Settings → Remote access, Settings → bb account, or `bb account login`. A pairing code from the getbb.app dashboard also works: paste it in Settings or run `bb connect --code <code>`. Remote access starts as soon as the account is signed in. Before each connection, the plugin gets a five-minute ticket from getbb.app, so the account credential never leaves bb account. The plugin reconnects after a drop.

`bb connect off`, or the Remote access switch in the plugin settings, turns remote access off and keeps this bb signed in; `bb connect on` turns it back on. `bb account logout` forgets the pairing. Disable the plugin to cut all remote access at once.

## For agents

When you view bb remotely, agents are told to share servers with `bb connect expose <port>`. A localhost link would not open. The `share-server-links` skill explains the flow. Other commands: `bb connect status`, `bb connect unexpose <port>`, `bb connect shares`, `bb connect servers`, and `bb connect machine-code`.

## Requirements

A getbb.app account and the bb account plugin. Share links open only for viewers with your getbb.app session; they are not public. Mobile pairing needs the "Mobile app" experiment.
