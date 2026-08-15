import type { BbPluginApi } from "@get-bb/plugin-sdk";

/**
 * First-party Codex provider plugin (phase 4 of
 * plans/agent-provider-plugin-surface.md). The declaration mirrors the core
 * catalog entry exactly; the registry's builtin takeover replaces the core
 * seed in place, and disabling this plugin restores it. The bridge entry is
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
      permissionModes: ["accept-edits", "auto", "full"],
      reasoningLevels: ["low", "medium", "high", "xhigh", "max", "ultra"],
    },
    composerActions: ["plan", "goal"],
  });
}
