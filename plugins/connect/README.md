# Connect server access

The server-access provider redeems Cloud machine codes on the server. It returns
`{ id, serverUrl, headers: { "x-bb-connect-machine": credential } }` and persists
the Cloud `connectMachineId` with the grant before returning it. Release uses
that identity to revoke access even if the machine never enrolled; failures keep
the record for retry, including across server restart. Existing enrolled grants
can still resolve their identity from host detail.

This closes the previous redeem-before-enrollment cleanup gap for new grants.
Old grants redeemed by an earlier machine without reporting their Cloud identity
cannot be reconstructed from a code; those legacy devices still require dashboard
revocation. Pending v1 bundles are upgraded by core on preparation to v2 headers.

The Cloud redeem endpoint accepts only a code and stores a new device ID, owner,
credential hash and creation time. It does not derive a name from the caller's
hostname, IP or user agent. The dashboard uses the nullable stored name and falls
back to `Machine <first eight ID characters>`. Moving redemption to the server
therefore does not change device naming. Production checks are recorded in the
PR verification report; no caller name field is invented.

Acquisition intent and credential-bearing grants use the SDK secret settings path
(private 0600 files outside SQLite). KV holds only grant/device IDs, acquisition
keys, hashed code IDs and recovery messages. All existing plaintext grants migrate
during plugin initialization, before the provider is registered. Secret persistence succeeds before each KV value is
replaced with metadata; a failed migration retries on the next initialization.

Intent, including code expiry, is durable before redemption. A lookup-confirmed
unconsumed code is renewed when expired (or when legacy intent has no expiry);
a still-valid code is reused. Ambiguous lookup results retain the recovery warning.
After an interrupted request, acquire and release use authenticated GET /api/connect/machine-code with the original code
in x-bb-connect-code. Cloud resolves the exact server-owned code to its device;
the plugin revokes that device before requesting a replacement. Cloud must deploy
the lookup and deterministic code-derived device identity together. Until then,
lookup failure retains the intent and reports “Cloud device may need dashboard
revocation” in machine status and Settings → Machines. Retries never silently
mint a replacement while the original device is unresolved. Old randomly named
devices cannot be resolved by this lookup and retain the same visible warning.

Already delivered v1 bundles remain accepted by the CLI and installer. A legacy
Connect client redeems once on the machine, saves the upgraded headers locally,
and uses those headers for artifact download, enrollment and daemon requests.

Release revokes both the stored grant device and any distinct trusted Cloud
identity reported by the host. This covers a delivered v1 bundle redeemed after
the server separately upgraded its pending copy; both identities are retained
for retry until revocation completes.

Malformed legacy payloads are scrubbed from KV during initialization. Only
validated cleanup identities and a quarantine flag remain; raw malformed data
is discarded. A safe diagnostic is logged, and General → Machine access shows
“N legacy access records need attention” without disabling healthy grants.
Quarantined hosts cannot acquire replacement access until their known device is
revoked through normal removal; records without a recoverable device identity
retain the dashboard-revocation diagnostic.

The same diagnostic is available in `serverAccess.providers[].attention` through
SDK `system.config()` and `bb settings show --json`.
