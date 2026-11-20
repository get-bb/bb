# tailscale (`bb--tailscale`)

Official plugin (bundled with bb, installed on request) that makes the bb
server reachable at `https://<machine>.<tailnet>.ts.net` through Tailscale
Serve, and offers that address as the `tailscale` server access provider.

## Pieces

- `src/tailscale-cli.ts` finds the `tailscale` CLI by absolute path (plugin
  workers don't get the launcher's PATH) and runs it with `execFile`.
  `BB_TAILSCALE_CLI` names a binary to use instead.
- `src/serve-config.ts` parses `tailscale status --json` (BackendState,
  `Self.DNSName`, `CurrentTailnet.MagicDNSEnabled`, `CertDomains`) and
  `tailscale serve status --json`, and finds an HTTPS mapping whose `/`
  handler proxies to bb's loopback port.
- `src/tailscale.ts` holds the state machine: status (cached for 5 s for
  `availability()`, which never waits for the HTTPS probe), setup, and
  teardown, the only two Serve writes; stopping or disabling the plugin
  changes nothing. Writes are serialized. It records the mapping it created in
  `bb.storage.kv` (`owned-serve-mapping`: `{ port, target }`) and only ever
  turns off a mapping that still matches that record.
- `src/plugin.ts` registers the provider, the RPC (`status`, `setup`,
  `teardown`), the CLI, a 30 s poll that publishes changes on the `tailscale`
  realtime channel and calls `bb.experimental_serverAccess.recheck()` when
  availability changes.

## Tests

`pnpm exec turbo run test --filter=bb-plugin-bb--tailscale` runs against
`src/testing/fake-tailscale.ts`, an in-memory CLI that models the node state
and the Serve config. Nothing touches a real tailnet.
