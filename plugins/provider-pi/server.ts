import type { BbPluginApi } from "@get-bb/plugin-sdk";

/**
 * First-party Pi provider plugin (see
 * plans/agent-provider-plugin-surface.md). The
 * declaration is the only source of this provider: with the core catalog seed
 * deleted, disabling this plugin removes the provider. The bridge entry is
 * validated now — bridge bundles are delivered to hosts in phase 5.
 */
export default function plugin(bb: BbPluginApi) {
  bb.agents.experimental_registerProvider({
    id: "pi",
    displayName: "Pi",
    icon: { asset: "icons/pi.svg" },
    kind: "agent",
    bridge: { entry: "provider-bridge" },
    capabilities: {
      supportsServiceTier: false,
      supportsHostAiServices: false,
      supportsNativeUserQuestion: false,
      supportsNativeFork: true,
      supportsNativeSessionRewind: true,
      supportsManualCompaction: true,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      supportsWorkflows: false,
      permissionModes: ["full"],
      reasoningLevels: ["none", "low", "medium", "high", "xhigh", "max"],
    },
    composerActions: [],
  });
}
