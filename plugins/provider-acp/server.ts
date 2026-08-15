import type { BbPluginApi } from "@get-bb/plugin-sdk";

/**
 * First-party ACP provider plugin (phase 4 of
 * plans/agent-provider-plugin-surface.md). Registers only the Cursor
 * declaration for now — known/custom ACP composition stays server-side
 * transitionally (see README.md). The declaration mirrors the core catalog
 * entry exactly; the registry's builtin takeover replaces the core seed in
 * place, and disabling this plugin restores it. The bridge entry is validated
 * now — bridge bundles are delivered to hosts in phase 5.
 */
export default function plugin(bb: BbPluginApi) {
  bb.agents.experimental_registerProvider({
    id: "acp-cursor",
    displayName: "Cursor",
    icon: { asset: "icons/cursor.svg" },
    kind: "agent",
    bridge: { entry: "provider-bridge" },
    capabilities: {
      supportsServiceTier: true,
      supportsHostAiServices: false,
      supportsNativeUserQuestion: false,
      supportsNativeFork: true,
      supportsNativeSessionRewind: false,
      supportsManualCompaction: false,
      permissionModes: ["accept-edits", "full"],
      reasoningLevels: ["low", "medium", "high", "xhigh", "max"],
    },
    composerActions: [],
  });
}
