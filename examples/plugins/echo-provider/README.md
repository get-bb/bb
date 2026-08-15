# bb-plugin-echo-provider

A complete third-party **agent provider** in ~300 lines: it registers an
"Echo Agent" provider that answers every prompt by echoing it back. Useless
as an agent, complete as a template — it exercises the entire provider
plugin surface: the declaration, the bridge build target, artifact delivery
to hosts, and the official conformance kit.

## What it demonstrates

- **`bb.agents.experimental_registerProvider`** (`server.ts`) — the provider
  declaration: stable id, picker display name, pre-session capability facts
  (all `false` here; permission mode `full`, reasoning level `medium`), and
  the `bridge: { entry: "provider-bridge" }` reference naming the built
  bundle.
- **`bb.providerBridge`** (`package.json`) — the bridge entry point.
  `bb plugin build` compiles `src/provider-bridge.ts` into a fully
  self-contained `dist/provider-bridge.mjs` (everything inlined; only node
  builtins external) plus `dist/provider-bridge.meta.json` recording its
  `{sha256, byteLength}`.
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
  (its exported `handleLine` + captured stdout) and asserts all eleven
  scenarios pass. Ship this test with every provider bridge.

## How the bridge reaches a host

1. On install/reload the server builds `dist/provider-bridge.mjs` and
   records `{pluginId, sha256, byteLength, path}`.
2. Thread commands for `echo-agent` carry a `bridgeLaunch` spec —
   `{source: {kind: "artifact", sha256, byteLength}}` — over the daemon
   wire.
3. The enrolled daemon downloads the bytes from
   `/internal/provider-bridges/:sha256`, verifies the sha256 **before**
   caching them under `<dataDir>/provider-bridges/`, and runs the artifact
   with its own node. It never executes unverified bytes.

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
