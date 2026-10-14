# End-to-end encryption for bb Connect

bb Connect relays traffic between your devices and your bb server through
getbb.app. The relay terminates TLS, so without further protection it can read
every request, response, file, and realtime message it forwards. Sealed
connections narrow that gap: a client and the bb server agree on keys the relay
never sees, and the client's API requests, files, and realtime traffic travel
inside that sealed channel. The coverage table below lists what stays
readable, and [Code integrity per surface](#code-integrity-per-surface) lists
which clients run code the relay served.

This document is the threat model and the coverage contract. The plugin that
implements it is `plugins/connect/` (server side) and `packages/sealed-channel/`
(the protocol, shared by every client).

## Threat model

Parties:

- **Owner devices**: a browser, the bb desktop app, or the bb mobile app that
  the owner signed in to getbb.app on.
- **bb server**: the owner's machine running bb with the Connect plugin.
- **Connect relay**: the getbb.app gate worker and per-server tunnel object.
  It authenticates the owner's account session, holds the outbound tunnel the
  server dialed, and forwards traffic in both directions.
- **Network**: everything between the parties, including the owner's ISP and
  any TLS-terminating middlebox.

Assumptions:

- The owner's getbb.app account gate keeps strangers out. Sealed connections
  add a second, independent check: the bb server itself must know the device.
- The bb server and its data directory are trusted. Keys and the device
  registry live in the Connect plugin's storage on that machine.
- Client code is trusted to the extent described under
  [Code integrity per surface](#code-integrity-per-surface). This is the
  boundary sealed connections cannot move on their own.

Goals:

- The relay cannot read or silently alter the content of API requests and
  responses, file uploads and downloads, or realtime WebSocket traffic that
  travels inside a sealed connection.
- With **Require end-to-end encryption** on, the relay also cannot make its
  own readable API calls. Without it (the default), bb's `/api/v1` has no
  application-level authentication, so an active relay can read and change
  anything through the readable tunnel even while every device you use is
  sealed. A server paired after this feature shipped turns the setting on at
  pairing time, so a new Connect setup has the active-relay boundary from
  its first connection and its first browser or phone waits for approval or
  a device code. A server paired before that keeps the setting off until the
  owner turns it on, so that the upgrade never locks out devices that cannot
  seal yet; until then it is protected against passive observation only, the
  plugin reports that it needs configuration so the choice is not silent,
  and the owner should approve their devices again and rotate the key when
  they turn it on.
- A relay that substitutes keys during pairing is detected, not trusted.
- With **Require end-to-end encryption** on, a device the owner revokes on the
  server stops working immediately, even if its getbb.app session is still
  valid. While the setting is off, a revoked device can enroll a fresh key and
  be approved automatically, and it can still use the readable tunnel.
- A client that expects a sealed connection never quietly falls back to the
  readable tunnel.

Non-goals:

- Bounded memory for very large uploads. A sealed upload is read into memory
  on the client and reassembled on the server before it reaches bb, so
  multi-hundred-megabyte files should still go over a direct connection.
- Hiding metadata from the relay. The relay still sees which account, handle,
  and label are involved, when traffic flows, and how much. It sees one
  WebSocket to the sealed endpoint per device and ciphertext frame sizes.
- Protecting against a compromised bb server or a compromised owner device.
- Port shares, machine daemons, and installers. See the coverage table. A
  machine daemon enrolled through the Connect URL still talks to the server
  in the clear, so the relay can read that daemon's traffic and act as it;
  enroll execution machines over a direct or tailnet address if that matters
  to you.

## What the relay sees

| Traffic                                          | Readable tunnel         | Sealed connection                                     |
| ------------------------------------------------ | ----------------------- | ----------------------------------------------------- |
| API requests and responses (`/api/v1/...`)       | Plaintext               | Ciphertext inside one WebSocket                       |
| File uploads, attachments, app-rendered previews | Plaintext               | Ciphertext (chunked inside the channel)               |
| Media a plugin page inserts into the DOM itself  | Plaintext               | Rerouted after insertion (best effort; see below)     |
| Realtime (`/ws`) and terminal WebSockets         | Plaintext               | Ciphertext, multiplexed inside the channel            |
| Paths, query strings, headers, cookies to bb     | Plaintext               | Ciphertext (only the sealed endpoint path is visible) |
| App shell HTML, JS, CSS, fonts, icons            | Plaintext (edge cached) | Plaintext (bootstrap; see code integrity)             |
| Plugin UI bundles (`/api/v1/plugins/*/assets/*`) | Plaintext               | Plaintext (loaded by the browser as code)             |
| Sealed handshake                                 | n/a                     | Ephemeral public keys and ciphertext                  |
| Port shares (`<label>--<port>.<domain>`)         | Plaintext               | Plaintext (excluded)                                  |
| Machine daemons (`/internal/*`)                  | Plaintext               | Plaintext (excluded)                                  |
| Installer routes (`/install*`), `/health`        | Plaintext               | Plaintext (public content)                            |

Plugin-inserted media is the one row without a hard guarantee: the browser
may start loading an `<img>` or `<iframe>` a plugin created before the sweep
rewrites it. The app's own previews resolve through the channel before
rendering; plugin authors who need the guarantee should fetch through the
page's `fetch`, which is sealed, rather than assign API URLs to elements.
The same applies to browser-managed requests the page patch does not cover:
`XMLHttpRequest`, form submissions, and context-menu navigation are not
rewritten. The app itself uses none of them against `/api`, and with
**Require end-to-end encryption** on the server refuses such requests, but
their path and query still reach the relay.

"Plaintext" means the relay handles the bytes after TLS termination. bb does
not record or store that traffic, but it is able to.

## Protocol

The sealed channel is a WebSocket to the Connect plugin's
`/api/v1/plugins/connect/http/sealed` route. The relay forwards it like any
other owner WebSocket. Inside:

1. **Key agreement.** Each side generates an ephemeral X25519 key. The shared
   secret and a transcript hash derive handshake keys with HKDF-SHA-256.
2. **Server authentication.** The server proves its long-lived Ed25519
   identity by signing the transcript, which covers both ephemeral keys. The
   client compares that identity with its pinned key.
3. **Device authentication.** The client signs the transcript with its own
   Ed25519 device key and may attach a proof: a one-time device code, or a
   delegation signed by an already approved device.
4. **Traffic keys.** Both sides derive one ChaCha20-Poly1305 key per direction
   from the shared secret and the full transcript. Every frame carries a
   counter nonce; replayed or reordered frames fail authentication and close
   the channel. Keys are forward secret; a stolen identity key does not
   decrypt recorded sessions.
5. **Multiplexing.** Inside the channel the client speaks the same framed
   protocol the tunnel uses between the relay and the server
   (`packages/tunnel-contract/`): HTTP requests, streamed bodies, and
   WebSocket streams share one connection. The server side executes those
   frames against bb's loopback listener with the same header rewriting the
   readable tunnel uses.

A malicious relay cannot read frames (no shared secret), cannot impersonate
the server (no identity key), and cannot impersonate an approved device (no
device key). Substituting its own key during a handshake produces a
fingerprint the client does not have pinned, which the client refuses.

## Pairing and verification

Every bb server has an encryption identity. Its **fingerprint** (24 hex
characters in six groups) is shown in Settings → Remote access and by
`bb connect encryption`. Read it from a trusted surface: the computer running
bb, the desktop app pointed at "This Mac", or the CLI. A fingerprint read
through the relay is only as trustworthy as the relay.

Devices reach the server in one of these states:

- **Approved automatically**: while **Require end-to-end encryption** is off,
  any device that passes the getbb.app account gate is approved on first
  contact. This keeps existing browsers, desktop apps, and phones working when
  the server upgrades, and it matches the trust the readable tunnel already
  extends to the account. Every device shows how it was approved. Turning the
  setting on demotes every device approved while it was off, however it was
  approved, closes their connections, and closes readable streams that were
  already open through the tunnel, so a relay that enrolled itself or opened a
  shell while the setting was off loses that access at that moment. Approve
  your own devices again after checking their fingerprints, or pair them with
  a device code. A relay with readable access could also have copied the
  server's identity key from disk through a terminal, and the switch cannot
  undo that: if this bb was reachable through Connect while the setting was
  off, run `bb connect rotate-key` afterwards so every device pins a key the
  relay never saw.
  Device approval, device codes, the require switch, key rotation, and mobile
  pairing refuse requests that arrive through the readable tunnel or through
  a sealed connection, so the relay cannot call them directly. That check
  guards one hop, not the server: an approved device has bb's full API,
  including terminals and agents on the server, and can run `bb connect ...`
  there. Code the relay injects into an approved page inherits that power for
  as long as the page runs. Treat approving a device as granting shell access
  to the server, and treat **Require end-to-end encryption** as the control
  that keeps the relay from becoming such a device on its own.
- **Pending**: with the setting on, a device that connects without proof is
  recorded and shows its device id plus the server fingerprint it saw. Approve
  it in Settings → Remote access → Sealed connections (on the computer
  running bb), or with
  `bb connect approve-device <id>`, after checking that fingerprint against the
  server's own.
- **Approved**: the device may open sealed connections. `bb connect devices`
  lists approved, pending, and revoked devices with their last connection.
- **Revoked**: `bb connect revoke-device <id>` or the Revoke button closes the
  device's live channel and refuses new ones. `remove-device` forgets the
  record so the device can enroll from scratch.

Ways to skip the manual approval safely:

- **Mobile QR code.** The QR code in Settings → Remote access carries the
  server key and a one-time device code. A phone that scans it pins the key as
  verified and is approved on its first connection. Only generate the QR code
  on a trusted surface.
- **Device code.** `bb connect device-code` (or the Device code button) mints
  a one-time twelve-character code that expires in ten minutes. The device and
  the server each prove they know it with a MAC over the handshake transcript;
  the code itself never crosses the wire, and a relay impersonating the server
  cannot pass the server's half of the proof. A relay that impersonates the
  server does receive the device's MAC and can test guesses against it offline;
  the twelve-character code has about 2^60 possibilities and no key
  stretching, so that search must finish inside the ten-minute window, but the
  code is a short-lived bootstrap, not a password. While a code is in play the
  device accepts nothing but an approved answer with that proof; a "pending" or
  "rejected" answer from a server that cannot prove the code is treated as an
  impostor and nothing is pinned. Entering it on a device that shows the
  "waiting for approval" screen approves the device in one step.

Trust on first use applies to browsers, to the desktop app's window, and to
phones paired by typing a code without then entering a device code: the first
sealed connection pins whichever server key it saw, marked unverified. In the
browser and the desktop window that first contact is a blocking screen: it
shows the fingerprint and sends nothing until the owner confirms the match,
enters a device code, or explicitly chooses to continue unverified. The
phone's native transport does the same for a first key it did not get from
a QR code: it holds every request and shows the fingerprint until the owner
confirms it, enters a device code, or continues unverified. Settings → General → Sealed transport shows the pinned
fingerprint with a **Mark as verified** button. A page inside the desktop app
or the mobile web view shows the key the host pinned and inherits the host's
verified flag; it does not count a host pin as verified on its own. Until you compare it with the
server's fingerprint, a relay that substituted its own key on first contact
would not be detected. Turning on **Require end-to-end encryption** on the
server prevents the other downgrade, where a relay hides the sealed endpoint
so the browser stays on the readable tunnel.

Recovery:

- **Lost device**: revoke it. Its device key is useless without approval.
- **Rotated or rebuilt server**: `bb connect rotate-key --yes` (or Rotate key)
  replaces the identity. A device that reaches the real server sees a key
  mismatch, shows both fingerprints, and refuses to continue until the owner
  confirms the new one. This is also what a device sees if a relay ever tries
  to impersonate the server after pairing. Rotation does not by itself evict
  a relay that copied the old private key while the server was reachable
  readable: such a relay can keep presenting the old identity to devices that
  still pin it, so after a rotation compare the new fingerprint on every
  device through a trusted channel (the machine itself, the CLI, or a QR
  code) rather than waiting for a mismatch to appear.
- **Reset a browser**: Settings → General → Sealed transport → Forget
  clears the pinned key and local device record. A pin that cannot be parsed
  stops the page with an error and a button that forgets it, rather than
  counting as no pin, and a pin that cannot be stored is an error rather than
  a silent success, so a browser without storage cannot be re-paired on every
  visit unnoticed.
- **Interrupted policy switch**: the policy generation is stored with the
  policy, so a device approved in an earlier generation, and any page
  delegated from such a device, is refused and demoted on its next
  connection even if bb stopped before the demotion loop finished.

No client falls back silently once it has a pinned key: a browser, phone, or
desktop app then opens only sealed connections to that origin, and if the
server is unreachable or refuses the device it shows an error and keeps
retrying. Before a key is pinned, a browser probes the server for the sealed
endpoint and seals only when the server reports that it is reached through
this relay host; a phone paired by typed code does the same. A relay that
hides that endpoint keeps such a client on the readable tunnel, which is why
**Require end-to-end encryption** matters: with it on, that downgrade fails
instead of working silently. A browser whose probe fails sends nothing until
the owner chooses "Continue with a readable connection" (remembered per
origin until Forget), then says so in Settings → General → Sealed transport;
a phone that lands there sends nothing until the owner accepts a readable
connection in the banner it shows, so the state is never silent on either
surface. A pending device shows the id derived from its
own key, and the client refuses a server answer that names any other device,
so an impostor server cannot steer the owner into approving a stranger. The desktop app's background
settings sync uses the readable path only until the window has pinned a key.

## Code integrity per surface

Sealed connections protect content in transit. They cannot protect a client
from running code the relay served. The honest status per surface:

- **Browser** (`https://<handle>.getbb.app`): the app shell and JavaScript are
  served through the relay. A relay that modifies that code could read keys
  and content inside the page. Sealed connections still stop passive reading
  and any tampering the relay does not carry out through the code it serves,
  and the pinned fingerprint exposes a substituted server. bb labels this
  surface **sealed transport**, not full end-to-end encryption.
- **Desktop app** targeting a Connect server: the window loads the same
  relay-served app, so the page has the browser's limits. The device key,
  however, lives in the desktop main process, protected by the OS keychain
  through Electron `safeStorage`; the page can only ask the main process to
  sign a handshake transcript (never arbitrary bytes, so it cannot mint
  delegations or export the key), and only the app window's main frame may
  ask, and only from the Connect server's origin or an origin the app has
  already pinned. The main process mirrors the page's pinned key for its own
  background sync; the page may mark that key verified (that is what the
  button does) but cannot swap in a different key as verified, and that mirror
  is no stronger than the page's pin. The sync never runs before the window
  has pinned a key and fails closed rather than falling back to the readable
  path; an unreadable trust file stops both the sync and the window with an
  error. Code the relay serves
  into that page can therefore still authenticate as the desktop device, and
  a channel it opened stays usable until it closes or the device is revoked,
  which is the same limit the browser has; through bb's API it can do anything
  the device is approved to do, including trust changes on the server. If the
  keychain is unavailable the window shows an error instead of continuing
  with a browser-style key. Custom-URL targets such as a LAN or tailnet
  address are not forced into sealed mode, because no relay sits on that
  path; the tunnel policy does not apply to them either. The desktop app's
  own background system-config sync uses the sealed channel with that key.
- **Mobile app, native requests**: the app's own requests, its realtime
  socket, push-subscription registration, and the thread lookup that routes a
  tapped notification use the sealed channel with a device key kept in the
  device keychain.
  A phone paired by QR code pins the server key from the code, not from the
  relay, so this surface is end-to-end encrypted with verified keys. A phone
  paired by typed code that finds no sealed endpoint holds every request
  until the owner accepts a readable connection. The
  native sealed fetch sends string and binary bodies; the app has no native
  multipart upload today, and one would need to be added to the transport
  before it could be used on a sealed profile.
- **Mobile app, web view**: the page inside the app is the relay-served web
  app and has the browser's limits. The page does not get the phone's key; it
  creates its own key and asks the native shell for a delegation signed by the
  phone's device key. The shell signs only for the page whose origin matches
  the active profile, binds the delegation to that profile's pinned server
  key, and limits it to twelve hours; the server re-checks the delegation and
  the phone's approval on every connection, and revoking the phone revokes its
  pages. Code the relay injects into the page can still request such a
  delegation and read what the page reads, so the web view's guarantee is the
  page's guarantee, bounded by those limits, including the API power of an
  approved device described above. The app does not load the web view for a
  Connect profile until the native transport has decided the policy: if the
  server offers no sealed endpoint the owner must accept a readable
  connection first, if the probe fails before any key is pinned the page is
  held, and once the phone expects sealing the page is told so and fails
  closed instead of probing the relay on its own. Demoting or revoking the phone removes its
  page records rather than revoking them, so a re-approved phone's web view
  enrolls again through a fresh delegation. The phone
  shows pending, refused, and key-mismatch states natively with a device code
  entry, and the page receives the phone's pinned server key, so it verifies
  rather than trusts on first use.

Reaching full code integrity on browser and web-view surfaces needs the app
bundle to come from somewhere the relay cannot alter, for example a bundle
shipped inside the desktop and mobile apps. That work is out of scope here and
the UI copy above reflects the current guarantees.

## Operating it

Policy (Settings → Remote access → Require encryption, or
`bb connect require-encryption on|off`; it is deliberately not a generic
plugin setting, so a remote page cannot flip it through the settings API).
Remote access is a Connect plugin feature end to end, so the plugin owns
this policy, its default, and the device registry; the server core has no
notion of sealed connections beyond the remote-caller flag it passes to
plugin CLIs:

- **Require end-to-end encryption** (on for servers paired after this
  feature, off for servers paired before it): refuse readable API and
  realtime traffic arriving through the tunnel. The tunnel client answers
  such requests with HTTP 403 `{"code":"sealed_required"}` and closes readable
  WebSockets with policy code 1008. What stays readable: the app shell and its
  assets (GET), plugin UI bundles (GET), installer routes (GET), `/health`,
  `GET /sealed/info` and the sealed WebSocket upgrade, port shares, and
  machine daemon traffic that carries a daemon bearer token plus the daemon
  join and WebSocket routes. Sharing a port that answers as this bb (its
  sealed info reports the same key) is refused, so the port-share exemption
  cannot reopen the API at share time; a shared service that later starts
  proxying to bb is still exempt, which is one reason port shares stay
  outside the guarantee. Minting enrollment keys and server-move
  downloads under `/internal` are refused from the tunnel whatever headers the
  request carries; other `/internal` routes pass only with an `Authorization`
  header, which the server then verifies against its enrolled daemons. Turning
  Other GET and HEAD requests outside `/api`, `/ws`, and `/internal` are
  treated as app-shell navigation and stay readable, because the shell serves
  every route path; a new data route must live under `/api` to be guarded.
  Turning the policy on also closes readable streams that are already open and demotes
  every device approved while it was off; the policy record carries a
  generation number that each switch-on increments, every approval records
  the generation it was made in, and an approval from an older generation is
  refused and demoted on its next connection, so an interrupted flip or a
  handshake racing the switch cannot leave an optional-era key approved. Turn the policy on once every device
  you use supports sealed connections, and rotate the key afterwards if the
  server was reachable through Connect before that. If the stored policy
  record is unreadable, the plugin treats encryption as required and logs a
  warning rather than silently reopening the readable path. The pending list
  keeps at most twenty devices and drops the least recently seen one when
  full; a device that is actively waiting refreshes its entry every few
  seconds, so junk enrollments cannot push it out.

CLI (`bb connect ...`): `encryption`, `require-encryption on|off`, `devices`,
`approve-device <id>`, `revoke-device <id>`, `remove-device <id>`,
`device-code`, `rotate-key --yes`. Each accepts `--json`. `bb connect
machine-code --json` includes the `sealed` block the mobile QR code encodes.

RPC (plugin `connect`) exposes read-only `sealedStatus`, and the plugin
publishes `SealedStatus` on the `connect-sealed` realtime channel. Every
change (approve, revoke, remove, device codes, the require policy, key
rotation, mobile pairing) goes through `bb connect ...` or the plugin's local
HTTP routes under `/api/v1/plugins/connect/http/sealed/`. Both refuse callers
that reached the server through bb Connect: the readable tunnel marks its
requests with `x-bb-connect-tunnel`, sealed sessions with
`x-bb-sealed-device`, and the relay gate with `x-bb-gate-auth`; the plugin
strips any client-supplied copies before adding its own.

Storage: the identity key and device records live in the Connect plugin's key
value storage inside `bb.db`. Disabling the plugin disconnects every sealed
device; enabling it restores them without re-pairing.

## Verification

- `packages/sealed-channel/test/`: handshake, key substitution, tamper and
  replay detection, delegation, and the multiplexer against an in-memory wire
  that must never contain plaintext.
- `apps/connect/src/sealed-relay.test.ts`: the real `TunnelDO` relays a sealed
  visitor through a real tunnel session guarded by the real plaintext policy
  to a real origin. Every frame the relay handled is decoded and checked for
  request paths, headers, a 3 MB upload, a 2 MB download, and realtime
  payloads; readable requests still work, `requireEncryption` refuses them,
  and a tunnel reconnect closes and reopens the sealed channel. The origin
  admits devices through the plugin's real `SealedAccess` and device
  registry: an unknown device stays pending while encryption is required, a
  device code approves it, and revoking it closes its channel through the
  relay. The test calls the tunnel object directly with a gate session
  already established; `apps/connect/src/worker.test.ts` covers the gate in
  front of it, including that an owner's sealed upgrade reaches the tunnel
  with the gate marker while anonymous and cross-account visitors are
  refused.
- `packages/tunnel-client/test/guard.test.ts`: raw frames with dot segments,
  encoded dot segments, or double slashes are refused before the policy runs,
  and the policy sees the percent-decoded path the origin router will use, so
  a relay cannot reach `/api` through `/install/../api` or `/%61pi`. Port
  share streams are forwarded untouched, and `reguard()` closes streams that
  were open before the policy changed.
- `apps/app/src/lib/sealed/media.test.ts`: images, videos, and previews on a
  sealed page load through the channel and render from `blob:` URLs,
  responsive `srcset` candidates that point at API media are dropped so the
  browser falls back to the sealed `src`, clicks
  on same-origin API download links (including plugin-rendered ones, with
  modifier keys or the middle button) are fetched through the channel instead
  of navigating, and a failed load is an error rather than a plaintext
  fallback. "Open in new tab" from the context menu is plain navigation and
  is refused by the server when encryption is required.
- `plugins/connect/src/sealed/sealed.test.ts`: the plugin route end to end
  with the fake plugin host: automatic approval while encryption is optional
  and demotion of every device approved in that state (account-gated or
  code-paired) when it is turned on, pending approval when it is required,
  device codes, server-bound delegations that are revalidated on every
  connection and removed with their parent (including a delegation from a
  parent whose approval predates an interrupted policy switch), key mismatch,
  forged
  `Authorization` headers against the `/internal` allowlist, a revocation that
  races with the device's own activity, an unreadable policy record failing
  closed, the require policy, and identity rotation.
- `apps/app/src/lib/sealed/*.test.ts`: the browser transport patch, the
  connection manager's pinning and no-fallback behavior, and the boot decision.
- `apps/mobile/src/lib/sealed/*.test.ts`: the native transport, probing,
  pinning, pending approval, key mismatch, and device codes.
