# Connect

bb account owns this server's getbb.app credential. Every hosted request goes
through the bb account plugin's `bb-account.v1.fetch` RPC, which serves
`/api/connect/` paths only to the connect plugin, and connect follows sign-in
changes with `bb-account.v1.waitForStatusChange`. While bb account reports any state other
than `signed-in`, or is stopped or held, connect treats this bb as signed out.

## Tunnel

Before each dial, connect reads the server credential from bb account's
connect-only `bb-account.v1.connectCredential` RPC and dials
`wss://<handle>.getbb.app/__tunnel` with `authorization: Bearer <credential>`,
as bb builds from before bb account do.

When the gate refuses the credential (401 or 403), connect retries with
backoff and passes the credential to bb account's connect-only
`bb-account.v1.confirmRefusedCredential`. bb account checks it with
`GET /api/account/me` and signs out if getbb.app no longer accepts it, which
tears the tunnel down. bb account being briefly unavailable also retries with
backoff.

The `remoteAccess` setting (`bb connect off` and `bb connect on`) closes and
reopens the tunnel and machine shares without signing out.

## Copy of the pairing for older builds

bb builds from before bb account keep `{serverUrl, handle, credential}` under
connect's KV key `credential`. Connect keeps that record so a bb that is
downgraded, or rolled back to an older release, still finds its pairing.
`credentialCopyOf` holds the SHA-256 of the credential connect last shared
with bb account. On every bb account change connect reconciles the two:

- bb account signed in: connect writes its credential to `credential`. If the
  stored record isn't the one connect last shared (an older build re-paired
  after a downgrade), connect first offers it to
  `bb-account.v1.adoptConnectCredential` with `replaces` set to bb account's
  current credential.
- bb account signed out: a record connect shared is removed, so older builds
  see the sign-out too. A record connect never shared (the upgrade from an
  older build) is offered with `replaces: null`.

Adoption copies. Neither side deletes or revokes a pairing while adopting. A
record getbb.app rejects stays for older builds to clear, and connect doesn't
offer it again until it restarts. While bb account is unavailable or can't
reach getbb.app, connect leaves the record alone and tries again later. Keep
this copy for at least two releases after the first release with bb account.

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
