import type { BbPluginApi } from "@get-bb/plugin-sdk";

/**
 * First-party Claude Code provider plugin (see
 * plans/agent-provider-plugin-surface.md). The
 * declaration is the only source of this provider: with the core catalog seed
 * deleted, disabling this plugin removes the provider.
 */
export default function plugin(bb: BbPluginApi) {
  bb.agents.experimental_registerProvider({
    id: "claude-code",
    displayName: "Claude Code",
    icon: "./icons/claude-code.svg",
    capabilities: {
      experimental_providerHealth: true,
      experimental_providerUsage: true,
      supportsServiceTier: false,
      supportsNativeUserQuestion: true,
      fork: "checkpoint",
      supportsManualCompaction: true,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      supportsWorkflows: true,
      permissionModes: ["accept-edits", "auto", "full"],
      reasoningLevels: ["low", "medium", "high", "xhigh", "ultracode", "max"],
    },
    composerActions: ["plan"],
  });
}
