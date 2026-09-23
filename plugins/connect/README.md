# Connect

Connect holds no getbb.app credential. Every hosted request goes through the
bb account plugin's `bb-account.v1.fetch` RPC, and connect follows sign-in
changes with `bb-account.v1.waitForStatusChange`. While bb account is signed
out, stopped, or held, connect treats this bb as signed out.

## Tunnel

Before each dial, connect asks for `POST /api/connect/tunnel-ticket` through
bb account and dials the returned `tunnelUrl` with
`authorization: Bearer <ticket>`. Every reconnect gets a new ticket. A gate
rejection retries with a new ticket; a rejected credential signs bb account
out, which tears the tunnel down.

The `remoteAccess` setting (`bb connect off` and `bb connect on`) closes and
reopens the tunnel and machine shares without signing out.

## Legacy pairing

Older connect versions kept `{serverUrl, handle, credential}` under the KV key
`credential`. On start, connect hands it to
`bb-account.v1.adoptConnectCredential`. It deletes its copy once bb account
adopts it, reports a signed-in account, or refuses it. While bb account is
unavailable, connect keeps the copy and tries again later.

## Server access

Connect redeems machine codes on the server and returns the grant's server URL
and authentication headers. Its plugin KV stores one record per machine,
under `server-access-grant:<hostId>`, outside settings descriptors and the UI.

The record contains either a pending redemption (code and expiry) or a completed
grant (credentials and Cloud device ID). Connect persists the pending record
before redeeming and the completed grant before returning it to core.

If a redemption response is lost, acquire and release look up the original code
through the authenticated Cloud machine-code lookup. If consumed, Connect
revokes its device before issuing a replacement. If unconsumed, a valid code can
be reused; an expired code is replaced. An unavailable or ambiguous lookup keeps
the pending record and reports that dashboard revocation may be needed. It does
not silently issue another grant. Acquire reports this recoverable state with a
typed failed result; unexpected thrown errors remain private at the plugin boundary.

Release revokes the completed grant's device even if enrollment never finished.
The record is deleted only after successful cleanup; failures keep it for retry.
