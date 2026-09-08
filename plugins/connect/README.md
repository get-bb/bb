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

Cloud code consumption and local persistence are separate operations. Acquire
revokes the new device if persistence reports a failure. A process death after
Cloud redemption but before persistence still requires Cloud-side idempotent
redemption or lookup support to reconcile; a completed acquire is durably
revocable before enrollment.
