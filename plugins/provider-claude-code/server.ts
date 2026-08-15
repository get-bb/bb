import type { BbPluginApi } from "@get-bb/plugin-sdk";

/**
 * First-party Claude Code provider plugin (phase 4 of
 * plans/agent-provider-plugin-surface.md). The declaration mirrors the core
 * catalog entry exactly; the registry's builtin takeover replaces the core
 * seed in place, and disabling this plugin restores it. The bridge entry is
 * validated now — bridge bundles are delivered to hosts in phase 5.
 */
export default function plugin(bb: BbPluginApi) {
  bb.agents.experimental_registerProvider({
    id: "claude-code",
    displayName: "Claude Code",
    icon: { asset: "icons/claude-code.svg" },
    kind: "agent",
    bridge: { entry: "provider-bridge" },
    capabilities: {
      supportsServiceTier: false,
      supportsHostAiServices: false,
      supportsNativeUserQuestion: true,
      supportsNativeFork: true,
      supportsNativeSessionRewind: true,
      supportsManualCompaction: true,
      permissionModes: ["accept-edits", "auto", "full"],
      reasoningLevels: ["low", "medium", "high", "xhigh", "ultracode", "max"],
    },
    composerActions: ["plan"],
  });
}
