# bb-plugin-echo-provider

The **third-party canary** for bb's provider plugin API. It is a complete
agent provider — a picker entry, a bridge, a bb tool, plugin settings, and
its own timeline vocabulary — that answers every prompt by echoing it back.
Useless as an agent, complete as a proof: it exercises **every** capability
a provider plugin has, and it does so through the public SDK alone.

## The rule

Everything under this directory imports only:

- `@get-bb/plugin-sdk` (and its published subpaths `/provider-bridge`,
  `/host`, `/app`),
- `zod`,
- node built-ins and the plugin's own files.

Tests may add `@get-bb/plugin-sdk/provider-bridge/testing` and the test
runner. **No `@bb/*` workspace package is imported anywhere**, and
`public-sdk-only.test.ts` fails the suite if one ever is. A marketplace
plugin cannot resolve bb's private packages; if this example needed one, the
public API would have a hole.

## What it demonstrates

Registration (`server.ts`, `bb.providers.register`):

| Capability                                                                                                                                                              | Where                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `experimental_strings` — sign-in and expiry hints, install URL, brand prefix, plan-mode copy, icon tint                                                                 | `server.ts`                                        |
| `experimental_reasoningLevels` — labelled picker options beside the coarse ladder                                                                                       | `server.ts`                                        |
| `experimental_serviceTiers` and `capabilities.supportsServiceTier`                                                                                                      | `server.ts`                                        |
| `capabilities` — permission modes, fork, archive/rename, maintenance facts                                                                                              | `server.ts`                                        |
| `composerActions: ["plan"]`                                                                                                                                             | `server.ts`                                        |
| `experimental_models.fallback` — the cold-cache model list                                                                                                              | `server.ts`                                        |
| `experimental_env.passthrough` — one daemon env var the bridge may read                                                                                                 | `server.ts`, read in `src/provider-bridge.ts`      |
| `experimental_deriveProviderOptions` — the plugin's `shout` setting (`bb.settings.define`) travels to the bridge as `providerOptions`                                   | `server.ts`, read back in `src/provider-bridge.ts` |
| `experimental_extensionKinds` — one item kind (`echo-provider/receipt`) and one state kind (`echo-provider/mood`), each with a zod schema the server enforces at ingest | `src/vocabulary.ts`                                |
| `bb.agents.registerTool` with `experimental_presentation` — a bb tool whose row reads the way the plugin says                                                           | `server.ts`                                        |
| `bb.host` — one artifact carrying the bridge and a host RPC entry                                                                                                       | `host.ts`, `contract.ts`                           |

The bridge (`src/provider-bridge.ts`, grammar v3). Every accepted prompt runs
the same scripted turn:

| Capability                                                                                                       | Delta                               |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Handshake reports `grammarVersions: [3, 3]`, `steerMode`, `sessionRestore`, `approvalEnforcedBy`                 | `initialize`                        |
| `presentation` on **every** `item.open` and `item.close`                                                         | all items                           |
| A shell command with streamed output                                                                             | `command` + `item.outputDelta`      |
| A file read                                                                                                      | `fileRead`                          |
| A content search                                                                                                 | `search`                            |
| Delegated work with a real child turn linked through `parentRef`                                                 | `delegation` + keyed `turn.open`    |
| A plan snapshot                                                                                                  | `planSteps`                         |
| A bookkeeping tool whose row clients collapse                                                                    | `tool` with `presentation.suppress` |
| The plugin's bb tool, called over `item/tool/call` and stamped `server: "bb"` with the definition's presentation | `tool`                              |
| The extension item, validated server-side against the declared schema                                            | `extension`                         |
| The extension state, latest snapshot wins                                                                        | `extension.state`                   |
| The echoed message, reporting the derived `providerOptions` and the passed-through env var                       | `item.textDelta` / `item.textClose` |
| Usage and the context-window meter                                                                               | `usage`, `contextWindow`            |
| A zero-work turn (`/noop`) that still settles                                                                    | `turn.boundary` with `claimIfIdle`  |
| A malformed extension payload (`malformed-receipt`) the server replaces with `provider/unhandled`                | `extension`                         |

## How it is proven

1. **The public testing kit** (`@get-bb/plugin-sdk/provider-bridge/testing`):
   - `provider-bridge.conformance.test.ts` drives the bridge through the
     canonical Provider Bridge Protocol suite — all twelve scenarios,
     including the zero-work turn.
   - `provider-bridge.stream.test.ts` plays the runtime's part (including the
     `item/tool/call` reply), runs the bridge's deltas through the **real**
     delta assembler the kit ships, and asserts every capability above on the
     assembled events.
   - `provider-bridge.parity.test.ts` replays `recordings/echo-agent/turn-tools`
     — a real recording bb made of this plugin's built artifact (record
     mode, `BB_PROVIDER_BRIDGE_RECORD_DIR`) — through the bridge the way the
     runtime spawns it, and diffs the assembled events against the
     recording's own: zero diffs, every recorded-cell conformance rule green.
     The same test re-records the bridge lane beside a copy of the recording,
     the workflow a deliberate bridge change follows. This is the regression
     oracle the first-party bridges use, reached through the public kit.
   - `public-sdk-only.test.ts` guards the rule.
2. **The server**: `apps/server/test/providers/echo-provider-canary.test.ts`
   installs this plugin from its path, builds the real thread command, runs
   it on the real agent runtime, ingests every event through the real
   routes, and asserts the persisted rows — including the `provider/unhandled`
   a malformed receipt becomes.

## How the bridge reaches a host

1. On install/reload the server builds `dist/host.js` and records
   `{pluginId, digest, byteLength, path}` — the same host artifact registry
   every `bb.host` plugin uses.
2. Thread commands for `echo-agent` carry a `bridgeLaunch` spec —
   `{source: {kind: "artifact", pluginId, digest, byteLength}}` — over the
   daemon wire, beside the `providerOptions` the plugin derived and the
   `dynamicTools` (with presentation) the server resolved.
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
bb plugin install ./examples/plugins/echo-provider --yes
bb plugin config echo-provider set shout true   # optional: prove the settings round trip
```

Then pick "Echo" in the provider picker and send a message. After editing
sources, `bb plugin reload echo-provider`.

## Test

```
pnpm exec turbo run test --filter=bb-plugin-echo-provider
```

## Re-record

The recording under `recordings/` is never rewritten. To capture a new one,
start a dev bb with `BB_PROVIDER_BRIDGE_RECORD_DIR=<dir>` exported in the
daemon's environment, install this plugin, spawn a thread on `echo-agent`,
then package the thread's lanes:

```
printf 'echo-agent\tturn-tools\t<threadId>\t\n' > /tmp/cells.tsv
node scripts/provider-recordings/package-cells.mjs --raw <dir> --cells /tmp/cells.tsv \
  --out examples/plugins/echo-provider/recordings \
  --versions '{"echo-agent":"bb-plugin-echo-provider 0.1.0"}'
```

The packager redacts the lanes (home paths, tokens, emails) and refuses to
finish if a secret shape survives.
