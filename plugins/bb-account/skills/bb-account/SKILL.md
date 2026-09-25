---
name: bb-account
description: "Sign this bb in to or out of its getbb.app account with bb account, and check which account remote access and hosted services use."
---

# bb account

The builtin bb account plugin links this bb server to a getbb.app account and
holds the server credential. Remote access (`bb connect`) and hosted services
reach getbb.app through it; they never see the credential.

## Check the account

`bb account status [--json]` prints the signed-in name, GitHub login, handle,
and this server's label and URL, or `Not signed in`. A bb that holds a
pairing but couldn't load its account yet says so; it keeps retrying, and
remote access and hosted services start once it succeeds. With `--json` it
prints `{state, revision, account, login}`: `state` is `signed-in`,
`signed-out`, or `profile-pending`, and `login` is the pending browser
sign-in, if any.

## Sign in

- `bb account login [--json]` starts a browser sign-in. It prints a
  `https://getbb.app/link?code=XXXX-XXXX` link and the code, then returns.
  Open the link on any device, sign in with GitHub, claim a handle if asked,
  and approve. bb finishes signing in on its own; the code expires after 10
  minutes.
- `bb account login --wait [--json]` waits for that sign-in to be approved,
  denied, or expire, and exits non-zero unless it signed in.
- `bb account login --code XXXX-XXXX [--json]` pairs with a one-time code from
  the getbb.app dashboard. `bb connect --code <code>` is an alias.
- `--base-url <url>` points sign-in at `https://getbb.app` or
  `https://vibecodethis.site` (staging); a development build also accepts
  `http://bb.localhost:<port>`. Any other origin is refused. In a source
  checkout, `pnpm dev` sets `BB_DEV_CONNECT_BASE_URL` so sign-in uses that
  worktree's local Cloud.

Signing in again replaces the account this bb is signed in to, and revokes the
previous server on getbb.app when the new sign-in is for a different one.
Starting a new sign-in cancels one that is still waiting for approval.

## Sign out

`bb account logout [--json]` revokes this server's credential on getbb.app,
forgets it locally, and cancels a sign-in still waiting for approval. Remote
access and hosted services stop until you sign in again. If getbb.app can't be
reached, bb still signs out locally and says the server wasn't revoked; remove
it from the getbb.app dashboard. `--json` prints `{revocation, status}`. To
stop remote access but stay signed in, use `bb connect off`.

Settings → Plugins → bb account shows the same account, a Sign in button that
opens getbb.app, a pairing-code field, and Sign out.

## Imported servers

A server imported with `bb server import` starts with bb account and bb
connect held off, so a copy can't use the original server's account. Stop
the original server, run `bb server allow-connect`, then restart bb.
