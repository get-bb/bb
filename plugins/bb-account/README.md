# bb account

bb account links this bb server to a getbb.app account. It keeps the
long-lived `bbcred_` server credential in its plugin KV (`credential`, with the
cached profile under `profile` and the status revision under `revision`) and
never returns or logs it. Other plugins reach getbb.app through its RPC
methods.

## RPC contract

Call these with `bb.sdk.plugins.callRpc({ pluginId: "bb-account", … })` and
keep your own copy of the Zod schemas (see `src/contract.ts`). bb account
loads before most plugins but can be disabled or held, so call it lazily and
treat an HTTP 503 as signed out.

| Method                              | Input                          | Output                                                          |
| ----------------------------------- | ------------------------------ | --------------------------------------------------------------- |
| `bb-account.v1.status`              | `{}`                           | `{state, revision, account}`                                    |
| `bb-account.v1.waitForStatusChange` | `{afterRevision}`              | the status once `revision > afterRevision`, or after 25 seconds |
| `bb-account.v1.fetch`               | `{target, method, path, body}` | `{status, body}`                                                |

`account` is null exactly when `state` is `signed-out`. It carries `userId`,
`githubLogin`, `name`, `avatarUrl`, `handle`, `serverId`, `serverLabel`,
`serverUrl` (the gate origin) and `baseUrl` (the getbb.app origin). The
revision increases on sign-in, sign-out, credential rejection, and every
profile refresh, and it survives restarts.

`fetch` sends JSON to a fixed origin: `"api"` is `baseUrl` and `"gate"` is
`serverUrl`. The path must start with `/api/` and may not contain `..`, `//`,
a query, a fragment, or characters other than letters, digits, and `-._~/`;
anything else throws. Request and response bodies are capped at 1 MB,
redirects are returned rather than followed, and a non-JSON body comes back as
`null`. The credential goes in both `authorization: Bearer` and
`x-bb-connect-machine`. While signed out, `fetch` answers
`{status: 401, body: {error: "signed-out"}}` without a request. An upstream
401 clears the credential and signs the account out.

The unlisted methods serve the plugin's own UI and CLI and the connect
migration: `bb-account.v1.adoptConnectCredential`, `login.start`,
`login.poll`, `login.cancel`, `redeemCode`, and `signOut`.
`adoptConnectCredential` stores a credential from connect's old KV only while
signed out and only after `GET /api/account/me` accepts it; it is removed two
releases after the connect handoff ships.

## Sign-in

`login.start` calls `POST /api/account/link/start` with the machine hostname
and keeps the secret device code on the server. A background poll calls
`POST /api/account/link/poll` every `intervalMs`, adds five seconds after each
`slow-down`, and stops on approval, denial, expiry, or cancellation. Codes
from the dashboard go through `POST /api/connect/redeem`. Both paths then load
the profile from `GET /api/account/me`, which is refreshed at start and every
six hours. Sign-out posts `/api/connect/disconnect` to the gate before
clearing the credential.

The base URL is `https://getbb.app`. In development, `BB_DEV_CONNECT_BASE_URL`
may name an `http://bb.localhost:<port>` origin, and `--base-url` overrides it
per command.
