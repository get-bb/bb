# bb-plugin-echo-provider

A complete third-party **agent provider** in ~300 lines: it registers an
"Echo Agent" provider that answers every prompt by echoing it back. Useless
as an agent, complete as a template — it exercises the entire provider
plugin surface: the declaration, the bridge build target, artifact delivery
to hosts, and the official conformance kit.

## What it demonstrates

- **`bb.providers.register`** (`server.ts`) — the provider
  declaration: stable id, picker display name, and pre-session capability
  facts (all `false` here; permission mode `full`, reasoning level `medium`).
  Metadata only: the implementation is the bridge below, and a declaration
  without one is refused.
- **`bb.host`** (`package.json`) — the plugin's one host artifact.
  `bb plugin build` compiles `host.ts` into a fully self-contained
  `dist/host.js` (everything inlined; only node builtins external) plus
  `dist/host.meta.json` recording its digest. That artifact carries **both**
  host surfaces this plugin has, which is the point of the shape: the named
  `experimental_providerBridge` export (run by the daemon's bridge bootstrap
  in its own process) and the `default` host RPC entry (run by the daemon's
  host worker in another). Bridge authoring imports come from the published
  `@get-bb/plugin-sdk/provider-bridge` — a host artifact cannot import bb's private
  workspace packages.
- **The bridge protocol** (`src/provider-bridge.ts`) — a minimal but correct
  implementation of the canonical Provider Bridge Protocol
  (`docs/provider-bridge-protocol.md`): line-delimited JSON-RPC over stdio,
  the `initialize` handshake, `thread/start`/`thread/resume` identity,
  the full turn grammar (`turn/input/accepted` → `turn/started` →
  `item/started` → `item/agentMessage/delta` → `item/completed` →
  `turn/completed`) with bridge-minted, entropy-prefixed turn/item ids,
  honest `thread/stop` intents, and `-32601`/`-32602` reply hygiene keyed by
  the protocol package's own method vocabulary.
- **The conformance kit** (`provider-bridge.conformance.test.ts`) — drives
  `@bb/provider-bridge-protocol/conformance` against the bridge in-process
  (its exported bridge surface's `handleLine` + captured stdout) and asserts all eleven
  scenarios pass. Ship this test with every provider bridge.

## How the bridge reaches a host

1. On install/reload the server builds `dist/host.js` and records
   `{pluginId, digest, byteLength, path}` — the same host artifact registry
   every `bb.host` plugin uses.
2. Thread commands for `echo-agent` carry a `bridgeLaunch` spec —
   `{source: {kind: "artifact", pluginId, digest, byteLength}}` — over the
   daemon wire.
3. The enrolled daemon downloads the bytes from
   `/internal/plugins/:pluginId/host/:digest`, verifies the digest **before**
   caching them, and runs the artifact with its own node through the bridge
   bootstrap, which hands the bridge its plugin-scoped data and temp
   directories. It never executes unverified bytes.

Trust model: installation trust, exactly like every other plugin surface —
a bridge runs only for an installed, enabled plugin, and the daemon executes
only what its server instructs.

## Install

```
bb plugin install ./examples/plugins/echo-provider
```

Then pick "Echo Agent" in the provider picker and send a message. After
editing sources, `bb plugin reload echo-provider`.

## Test

```
pnpm --dir examples/plugins/echo-provider test
```
