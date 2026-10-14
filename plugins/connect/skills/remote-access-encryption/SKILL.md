---
name: remote-access-encryption
description: "Inspect or manage bb Connect end-to-end encryption: fingerprints, device approval and revocation, device codes, and the require-encryption policy."
---

# bb Connect end-to-end encryption

Remote devices reach this bb through the getbb.app relay inside a sealed
connection the relay cannot decrypt. Use these commands when the user asks to
approve a browser or phone, check a fingerprint, revoke a device, or make the
relay unable to read traffic.

1. `bb connect encryption --json` prints the server key `fingerprint`,
   `required`, `activeChannels`, and `devices` (each with `id`, `name`,
   `surface`, `status` pending/approved/revoked, `fingerprint`, `lastSeenAt`,
   `connected`).
2. To approve a waiting device, ask the user to compare the server fingerprint
   the device displays with the one from step 1, then run
   `bb connect approve-device <id>`. Never approve a device the user has not
   identified.
3. `bb connect device-code` mints a one-time code (ten minutes) the user types
   on the device instead of waiting for approval. Only relay a code through a
   channel the user trusts; treat it like a password.
4. `bb connect revoke-device <id>` closes the device's connections at once;
   `bb connect remove-device <id>` forgets the record.
5. `bb connect require-encryption on` refuses readable API and realtime
   traffic from the relay (HTTP 403 `sealed_required`), closes readable
   streams that are already open, makes new devices wait for approval, and
   demotes every device approved while the policy was off, so the user must
   approve their own devices again; `off` allows readable
   traffic and approves account-gated devices automatically. The app shell,
   port shares, machine daemons, and installers stay readable either way.
   Warn the user that clients older than this feature stop working remotely
   while it is on, and suggest `bb connect rotate-key` afterwards if the
   server was reachable through Connect before, because a relay with readable
   access could have copied the identity key. Approving a device grants it
   bb's full API on the server, including terminals, so the "local only"
   checks on trust commands stop the relay itself, not an approved device.
6. `bb connect rotate-key --yes` replaces the server key; every device then
   shows a key mismatch until the user confirms the new fingerprint.

Pairing a server turns the policy on unless a policy record already exists,
so servers paired before this feature keep readable access until the user
turns it on.

`bb connect machine-code --json` includes a `sealed` block; the mobile QR code
pins the key and approves the phone automatically. The full threat model,
including what the relay still sees, is in
`docs/connect-end-to-end-encryption.md`.
