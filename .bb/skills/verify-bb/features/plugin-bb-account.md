# bb account sign-in

Status: **2026-09-22: 0 passed, 5 not run** (new plugin; a source smoke run covered link sign-in, code sign-in, sign-out, and fetch through bb-ai). Run against the local cloud from hosted-web.md.

## Setup and entry points

Settings → bb account; bb account --help. Use `pnpm cloud:dev` and a fresh dev
store; `pnpm dev` points the plugin at that local cloud. Never sign an imported
store in, and never sign a test store in to getbb.app.

Use the main skill’s isolated targets and evidence rules. A plugin can be present
in this checkout but disabled in an installation. Enable it only in the test
store before checking its surfaces. Read its current command/schema definitions
from the source below; CLI references use the matching source CLI described in
SKILL.md. Inspect nested `--help` before selecting flags and IDs.

## Source

- `plugins/bb-account/package.json`
- `plugins/bb-account/src/plugin.ts`
- `plugins/bb-account/app.tsx`

## Feature recipes

| Feature | Drive | Observable success |
| --- | --- | --- |
| Browser link sign-in | Run `account login`, open the printed `/link` URL, claim a handle if asked, approve; repeat with `--wait` and once with Deny. | Status turns signed in only after approval; the profile shows the handle and server; a denial or expiry leaves the store signed out. |
| Pasted code sign-in | Create a dashboard code, paste it into Settings → bb account → Have a pairing code?, and separately run `account login --code`. | Both sign in once; a reused or expired code fails with a clear message. |
| Sign out and revocation | Sign out from Settings and with `account logout`; separately revoke the server from the dashboard. | Connect's tunnel closes and bb cloud reports not ready; a revoked credential signs the store out on its next hosted call. |
| Fetch boundary | Call `plugin rpc call bb-account bb-account.v1.fetch` with an `/api/` path, a path with `..` or a query, and while signed out. | Allowed paths return status and JSON without the credential; other paths are refused; signed out answers 401 `signed-out` without a network call. |
| Imported-store hold | Import a synthetic store with `server import`, start it, then run `server allow-connect`. | bb account and Connect stay off until the hold is released; no hosted call uses the imported credential. |

## Evidence and cleanup

Record each row’s UI/tool/CLI action and observed result separately. Never
record credentials or cookies. Sign out, remove local cloud accounts created by
the run, and delete only this run’s fixtures.
