# Agent provider API

### bb.providers.register — agent providers

A plugin can contribute a full agent provider: a picker entry whose threads
run on a **provider bridge** the plugin ships. The working reference is
`examples/plugins/echo-provider` — declaration, bridge, and conformance test
in one small package.

The contract lives in two documents in the bb repository (see
distribution.md for getting a checkout): `docs/provider-plugin-api.md` (the
declaration fields and their limits, handshake, vocabulary, presentation,
interactions, rendering, and delivery) and `docs/provider-bridge-protocol.md`
(the JSON-RPC wire grammar). This reference covers how to build, test, and
ship a provider plugin.

```ts
bb.providers.register({
  id: "echo-agent", // stable public id; thread rows persist it
  displayName: "Echo Agent", // 1-80 chars, shown in the picker
  icon: "./icons/echo.svg", // optional; see "The icon" below
  family: "echo", // optional grouping key for related providers
  // Copy core surfaces render (usage banners, pickers, the guide).
  strings: {
    signInHint: "Run `echo-agent login` on the machine to sign in.",
    expiredHint:
      "Your Echo session expired. Run `echo-agent login`, then reload.",
    installUrl: "https://example.com/echo-agent",
    brandPrefix: "Echo ", // optional; stripped from model display names
    planModeCopy: "Echo will plan without executing.", // optional
    iconTint: { light: "#334155", dark: "#CBD5E1" }, // optional
  },
  experimental_bridgeOptions: { launch: { command: "echo-agent" } },
  experimental_visibility: "always", // default; "installed" needs health
  // Which sessionless provider/* methods the bridge supports.
  maintenance: { health: false, usage: false, installation: false },
  capabilities: {
    supportsServiceTier: false,
    supportsNativeUserQuestion: false,
    fork: "none", // "none" | "tip" | "checkpoint"
    supportsManualCompaction: false,
    supportsThreadArchive: false, // bb mirrors archive/unarchive onto it
    supportsThreadRename: false, // bb forwards renames to it
    permissionModes: ["full"], // non-empty, no duplicates
    reasoningLevels: ["medium"], // coarse fallback ladder
  },
  reasoningLevels: [{ id: "medium", label: "Medium" }], // labelled picker options
  serviceTiers: undefined, // e.g. [{ id: "default", label: "Default" }, { id: "fast", label: "Fast" }]
  composerActions: [], // skills typeahead is implicit; ["plan"] opts into plan mode
  models: { fallback: [], scope: "workspace" },
  env: { passthrough: ["BB_ECHO_AGENT_EXECUTABLE"] },
  deriveProviderOptions(ctx) {
    return {
      verbose: ctx.settings.verbose === true,
      plan: ctx.promptMode === "plan",
    };
  },
});
```

Put the provider's own knobs in the plugin's `bb.settings.define` values and
pass them to the bridge through `deriveProviderOptions`. Use
`experimental_bridgeOptions` for immutable launch facts, `extensionKinds` for
provider-specific item or state payloads, and `completedTurnDisplay: "flat"`
when your agent narrates its work in text the user should keep reading. Each
field's contract and limits are in `docs/provider-plugin-api.md` §1.

**The icon.** `icon` takes the two shapes of `bb.branding.icon` — a named
host glyph (`"Zap"`) or a plugin-relative SVG path (`"./icons/echo.svg"`) —
plus one `bb.branding.icon` itself refuses: one of the plugin's declared
icons by its namespaced glyph (`"<pluginId>/<name>"`, an entry of
`bb.branding.experimental_icons`; the plugin id must be this plugin's and
the name declared, else the plugin fails to load). A path-shaped SVG is
served as declared behind `nosniff` and a `default-src 'none'` CSP; it is
not in the manifest, so `bb plugin build` cannot check it — keep it free of
the script vectors the build refuses in a logo. A path or a declared icon is
served to clients as a `logoUrl` and drawn as a `currentColor` mask, so a
monochrome mark follows the bb theme (and the declared `strings.iconTint`)
with no frontend bundle; a full-colour logo renders as a silhouette. A glyph
name carries no bytes, so there is no `logoUrl` and clients draw the glyph
from the shared icon set. For custom inline React, register
`app.slots.experimental_providerIcon({ providerKind, providerId, icon })`
from an `app.tsx`:

```tsx
// app.tsx
import { definePluginApp } from "@get-bb/plugin-sdk/app";

function EchoIcon({ className }: { className?: string }) {
  return (
    <svg fill="currentColor" viewBox="0 0 24 24" className={className}>
      <path d="…" />
    </svg>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_providerIcon({
    providerKind: "agent",
    providerId: "echo-agent",
    icon: EchoIcon,
  });
});
```

A provider plugin's `app.tsx` loads in the deferred boot pass like every
other plugin's (`docs/provider-plugin-api.md` §5), so keep it small.

### `bb.providers.experimental_contributeEnv` — per-command provider environment

A plugin can contribute environment variables to any provider, including one
registered by another plugin. Register one resolver per provider id:

```ts
bb.providers.experimental_contributeEnv("claude-code", async (context) => [
  {
    name: "ANTHROPIC_BASE_URL",
    value: { serverPath: `/plugins/my-proxy/${context.hostId}` },
    reason: "Route Claude through the plugin's authenticated proxy",
  },
]);
```

The server calls the resolver for every matching start, resume, fork, and turn
command. Its `ExperimentalPluginProviderEnvContext` has `threadId`, `projectId`,
and `hostId`; return at most 32 `ExperimentalPluginProviderEnvEntry` values.
Names must match `[A-Z_][A-Z0-9_]*`; `reason` is required. A
literal `value` is forwarded as-is. `{ serverPath: "/..." }` is expanded by
the selected host against its authenticated `BB_SERVER_URL`, which is the
right form for a server route that must work from enrolled machines.

Contributions override the host shell environment. If multiple plugins return
the same name, the earlier registration wins and BB logs the conflict. A
resolver that throws, times out after five seconds, or returns invalid entries
contributes nothing for that command without blocking other plugins. BB passes
values to the provider and reports them as-is in `provider.env-resolved`
timeline events, provider output, and diagnostics.

When the contributed environment supplies credentials that replace a local
login, pair the resolver with
`bb.providers.experimental_contributeEnvHealth(providerId, resolve)`. Its
host-scoped `ExperimentalPluginProviderEnvHealthContext` contains `hostId`.
Return an `ExperimentalPluginProviderEnvHealth` `{ label, statusMessage }` only
while the proxy is usable, or `null` otherwise. BB uses it only when the
provider bridge reports `unauthenticated` or `expired`, and only when the same
plugin registered an env resolver for that provider. Installation and unknown
failures are preserved.

### Native skill and command roots

Declare fixed host-home or workspace-relative roots with
`experimental_nativeSkillRoots` and `experimental_nativeCommandRoots`. When
only the host can find them (a moved config directory, installed vendor
plugins), set `experimental_resolvesNativeRoots` and implement
`experimental_nativeRootsHostContract` from `@get-bb/plugin-sdk/host` in the
host entry. Return absolute paths with a `user` or `project` origin, and run
`experimental_filterResolvedNativeRoots` before returning so one bad root does
not reject the complete answer; it limits each side and applies the correct
skill or command shape. Root semantics and precedence are in
`docs/provider-plugin-api.md` §1.

### The bridge

A provider bridge ships inside the plugin's `bb.host` artifact — the same
artifact a host RPC entry ships in, and a plugin may have both. Export it by
name:

```ts
// host.ts (bb.host)
import { experimental_defineProviderBridge } from "@get-bb/plugin-sdk/provider-bridge";

export const experimental_providerBridge = experimental_defineProviderBridge({
  handleLine(line) {
    /* one JSON-RPC line from the runtime */
  },
  // Optional; called once before the first line, with this plugin's
  // persistent dataDir and this process's own tempDir.
  start({ pluginId, dataDir, tempDir }) {},
  onClose() {}, // stdin closed: the runtime is gone
  onSigterm() {},
  onSigint() {},
});
```

Do not start the bridge yourself: the server builds and delivers the
artifact, and the daemon imports this export and owns the process
(`docs/provider-plugin-api.md` §2, §6). Importing the module must start
nothing, which is also what lets your conformance test drive `handleLine`
in-process. A bridge runs only for an installed, enabled plugin.

Everything a bridge compiles against is published at
`@get-bb/plugin-sdk/provider-bridge` — protocol schemas including the
`thread/delta` grammar, method maps, and the bridge kit — so list
`@get-bb/plugin-sdk` under `dependencies`, not just `devDependencies` (see
the host-entry dependency rule in backend-foundation.md; the echo example's
`package.json` shows the shape). A `bb.host` artifact cannot import bb's
private `@bb/*` workspace packages; an installed plugin could not resolve
them.

The bridge speaks the Provider Bridge Protocol, line-delimited JSON-RPC 2.0
over stdio. It emits parsed semantic deltas keyed by provider-native ids; the
runtime's delta assembler, never the bridge, mints every bb turn and item id.
Implement, following `docs/provider-bridge-protocol.md`:

- the `initialize` handshake ("Versioning and capabilities");
- `thread/start` / `thread/resume` / `thread/fork` with `thread/identity` and
  `session.reset` ("Identifiers", "Sessions");
- `turn/start` driving `thread/delta` batches ("The timeline lane", "Turn
  lifecycle", "Item lifecycle");
- `thread/stop` for both intents ("Turn lifecycle");
- reply hygiene for unknown methods and invalid params ("Transport");
- recovery hints where your provider fails recoverably ("Recovery hints").

The bridge package also exports helpers for JSON-RPC transport, child process
and environment setup, installation and version checks, tool presentation,
bounded output, and recording. Launch the provider CLI by name with
`experimental_spawnPortableProcess` (it resolves `PATH`/`PATHEXT` and npm
`.cmd` shims on Windows) and end it with `experimental_killPortableProcess`
(it terminates the whole process tree on Windows). Read
`provider-bridge-api-index.md` for every symbol, then read the installed
declaration for its exact signature.

For an ACP agent, use `@get-bb/plugin-sdk/provider-bridge/acp`. Re-export
`experimental_acpProviderBridge` as `experimental_providerBridge`. Supply a
validated `acpLaunchSpec` and an ACP dialect in the static bridge options. The
public ACP entrypoint includes the bridge, launch schema, agent probe, model
catalog, tool, and dialect contracts. It supports the `generic`, `cursor`, and
`grok` dialects.

### Testing a bridge

**Conformance.** Ship a test that drives the published kit,
`@get-bb/plugin-sdk/provider-bridge/testing`, against your bridge
in-process: export the bridge surface, wire `experimental_runBridgeConformance`
with your provider id and a transport whose `send` calls it and whose
`takeMessages` drains captured stdout
(`experimental_captureBridgeJsonRpcOutput().takeMessages`; the kit assembles
your `thread/delta` batches itself, through the runtime's real assembler), and
assert every scenario passes (see
`examples/plugins/echo-provider/provider-bridge.conformance.test.ts`). The
same kit assembles your deltas into canonical events, so a second test can
assert what each row becomes
(`examples/plugins/echo-provider/provider-bridge.stream.test.ts`). The kit
also provides the JSON-RPC harness, calibration checks, and recorded-cell
checks for parsing, request replies, semantic timeline output, and error
cases.

**Recorded replay.** Record a real session: start the host daemon with
`BB_PROVIDER_BRIDGE_RECORD_DIR=<dir>` in its environment and run a thread on
your provider (a bridge that spawns a CLI also calls
`experimental_recordProviderChildIo` right after `spawn()`); the layout is in
`docs/provider-bridge-protocol.md`, "Record mode". Redact and commit the lanes
under your plugin, then replay them in a test:
`experimental_resolveProviderBridgeLaunch({ modulePath, pluginId })` builds
the bridge process exactly as the runtime spawns it,
`experimental_replayRecording` drives the recorded runtime lane into it and
answers its requests with the recorded answers, and
`experimental_compareParity` diffs the assembled events against the
recording's own (`experimental_assembleRecordedEvents`);
`experimental_checkRecordedCellReplay` adds the recorded-cell conformance
verdicts. A bridge with a provider child passes a `ReplayProviderProfile`
whose `env` (or `rewriteRuntimeLine`) points the child at the kit's replay
script. When a deliberate bridge change alters the stream,
`experimental_rerecordCurrentBridgeLane` writes the new expectation beside
the recording (`bridge→runtime.current.ndjson`); the recording itself is
never rewritten. See
`examples/plugins/echo-provider/provider-bridge.parity.test.ts`.
