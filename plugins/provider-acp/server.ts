import type { BbPluginApi } from "@get-bb/plugin-sdk";

/**
 * First-party ACP provider plugin (see
 * plans/agent-provider-plugin-surface.md). Registers only the Cursor
 * declaration for now — known/custom ACP composition stays server-side
 * transitionally (see README.md). The
 * declaration is the only source of this provider: with the core catalog seed
 * deleted, disabling this plugin removes the provider.
 */
export default function plugin(bb: BbPluginApi) {
  bb.agents.experimental_registerProvider({
    id: "acp-cursor",
    displayName: "Cursor",
    icon: "./icons/cursor.svg",
    capabilities: {
      experimental_providerHealth: true,
      experimental_providerUsage: true,
      experimental_providerInstallation: true,
      supportsServiceTier: true,
      supportsNativeUserQuestion: false,
      fork: "tip",
      supportsManualCompaction: false,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      supportsWorkflows: false,
      permissionModes: ["accept-edits", "full"],
      reasoningLevels: ["low", "medium", "high", "xhigh", "max"],
    },
    composerActions: [],
  });
}
