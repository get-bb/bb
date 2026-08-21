/**
 * Echo provider — a complete third-party agent provider plugin.
 *
 * Surfaces demonstrated:
 * - bb.providers.register: the provider declaration (id, picker metadata,
 *   and pre-session capability facts). Metadata only — the
 *   implementation is the bridge below, and a declaration without one is
 *   refused.
 * - bb.host (package.json): the plugin's one host artifact. host.ts exports
 *   both the provider bridge (named export, run by the daemon's bridge
 *   bootstrap) and a host RPC entry (default export, run by the daemon's host
 *   worker) — one artifact, two consumers, two process lifecycles. The server
 *   stores it content-addressed and enrolled host daemons download,
 *   hash-verify, and run it.
 *
 * The bridge itself lives in src/provider-bridge.ts and implements the
 * canonical Provider Bridge Protocol (docs/provider-bridge-protocol.md)
 * minimally but correctly — its conformance test drives the official kit
 * against it in-process.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default function plugin(bb: BbPluginApi) {
  bb.providers.register({
    id: "echo-agent",
    displayName: "Echo Agent",
    capabilities: {
      experimental_providerHealth: false,
      experimental_providerUsage: false,
      experimental_providerInstallation: false,
      supportsServiceTier: false,
      supportsNativeUserQuestion: false,
      fork: "none",
      supportsManualCompaction: false,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      permissionModes: ["full"],
      reasoningLevels: ["medium"],
    },
    composerActions: [],
  });
}
