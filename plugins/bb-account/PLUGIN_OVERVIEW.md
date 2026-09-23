Sign this bb in to your getbb.app account once. Remote access and hosted services, such as generated thread titles and commit messages, then use that account.

## What you get

- A Settings section with your avatar, GitHub login, handle, this server's label, and a Sign out button.
- Sign-in from any device. bb shows a code and a getbb.app link; you approve it in a browser, even when bb runs on a headless or remote machine.
- One place that holds this server's getbb.app credential. Other plugins make requests through it and never see the credential.

## How it works

Click Sign in, or run `bb account login`. Open the getbb.app link, sign in with GitHub, claim a handle if you have none, and approve this bb as a new server or as a replacement for one you already have. bb picks up the approval on its own. If you have a pairing code from the getbb.app dashboard, paste it in Settings or run `bb account login --code <code>`.

`bb account status` shows the account and `bb account logout` signs out. Signing out revokes the server credential on getbb.app, so remote access and hosted services stop until you sign in again. Add `--json` to any command for machine-readable output.

## Requirements

A GitHub account to sign in to getbb.app. An imported server keeps bb account off until you run `bb server allow-connect`.
