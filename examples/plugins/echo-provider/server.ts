/**
 * Echo provider — a complete third-party agent provider plugin.
 *
 * Surfaces demonstrated:
 * - bb.agents.experimental_registerProvider: the provider declaration (id,
 *   picker metadata, and pre-session capability facts). Metadata only — the
 *   implementation is the bridge below, and a declaration without one is
 *   refused.
 * - bb.providerBridge (package.json): the bridge entry `bb plugin build`
 *   bundles into dist/provider-bridge.mjs. The server stores that artifact
 *   content-addressed and enrolled host daemons download, hash-verify, and
 *   run it for every thread on this provider.
 *
 * The bridge itself lives in src/provider-bridge.ts and implements the
 * canonical Provider Bridge Protocol (docs/provider-bridge-protocol.md)
 * minimally but correctly — its conformance test drives the official kit
 * against it in-process.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default function plugin(bb: BbPluginApi) {
  bb.agents.experimental_registerProvider({
    id: "echo-agent",
    displayName: "Echo Agent",
    capabilities: {
      supportsServiceTier: false,
      supportsHostAiServices: false,
      supportsNativeUserQuestion: false,
      fork: "none",
      supportsManualCompaction: false,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      supportsWorkflows: false,
      permissionModes: ["full"],
      reasoningLevels: ["medium"],
    },
    composerActions: [],
  });
}
