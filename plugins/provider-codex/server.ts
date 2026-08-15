import type { BbPluginApi } from "@get-bb/plugin-sdk";

/**
 * First-party Codex provider plugin (see
 * plans/agent-provider-plugin-surface.md). The
 * declaration is the only source of this provider: with the core catalog seed
 * deleted, disabling this plugin removes the provider. The bridge entry is
 * validated now — bridge bundles are delivered to hosts in phase 5.
 */
export default function plugin(bb: BbPluginApi) {
  bb.agents.experimental_registerProvider({
    id: "codex",
    displayName: "Codex",
    icon: { asset: "icons/codex.svg" },
    kind: "agent",
    bridge: { entry: "provider-bridge" },
    capabilities: {
      supportsServiceTier: true,
      supportsHostAiServices: true,
      supportsNativeUserQuestion: false,
      supportsNativeFork: true,
      supportsNativeSessionRewind: true,
      supportsManualCompaction: true,
      supportsThreadArchive: true,
      supportsThreadRename: true,
      supportsWorkflows: false,
      permissionModes: ["accept-edits", "auto", "full"],
      reasoningLevels: ["low", "medium", "high", "xhigh", "max", "ultra"],
    },
    composerActions: ["plan", "goal"],
  });
}
