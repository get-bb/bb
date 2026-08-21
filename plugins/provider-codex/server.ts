import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { codexExtensionKinds } from "./src/extension-kinds.js";

/**
 * First-party Codex provider plugin. The declaration is the only source of
 * this provider: disabling this plugin removes the provider.
 *
 * Codex's own knobs (native memories, native multi-agent tools) are this
 * plugin's settings and reach the bridge through the opaque `providerOptions`
 * bag derived below — core carries none of them.
 */
export default function plugin(bb: BbPluginApi) {
  bb.settings.define({
    memoryEnabled: {
      type: "boolean",
      label: "Codex memory",
      description:
        "Allow Codex to recall existing memories and generate new memories from bb threads.",
      default: true,
    },
    subagentsDisabled: {
      type: "boolean",
      label: "Disable provider subagents",
      description:
        "Prevent Codex from starting native subagents so agents use bb for delegation.",
      default: false,
    },
  });

  bb.providers.register({
    id: "codex",
    displayName: "Codex",
    icon: "./icons/codex.svg",
    experimental_strings: {
      signInHint: "Run `codex` on the machine to sign in.",
      expiredHint: "Your Codex session expired. Run `codex`, then reload.",
      installUrl: "https://developers.openai.com/codex/cli",
      brandPrefix: "GPT-",
    },
    capabilities: {
      experimental_providerHealth: true,
      experimental_providerUsage: true,
      experimental_providerInstallation: true,
      supportsServiceTier: true,
      supportsNativeUserQuestion: false,
      fork: "checkpoint",
      supportsManualCompaction: true,
      supportsThreadArchive: true,
      supportsThreadRename: true,
      permissionModes: ["accept-edits", "auto", "full"],
      reasoningLevels: ["low", "medium", "high", "xhigh", "max", "ultra"],
    },
    experimental_reasoningLevels: [
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium" },
      { id: "high", label: "High" },
      { id: "xhigh", label: "Extra High" },
      { id: "max", label: "Max" },
      {
        id: "ultra",
        label: "Ultra",
        description: "Max effort plus automatic task delegation.",
      },
    ],
    experimental_serviceTiers: [
      { id: "default", label: "Default" },
      { id: "fast", label: "Fast" },
    ],
    composerActions: ["plan", "goal"],
    experimental_deriveProviderOptions(context) {
      return {
        memoryEnabled: context.settings.memoryEnabled !== false,
        providerSubagentsEnabled: context.settings.subagentsDisabled !== true,
      };
    },
    // Codex goals (thread state) and the macOS permission profile (an item
    // beside an approval) are codex's own vocabulary, validated at ingest
    // against these schemas.
    experimental_extensionKinds: codexExtensionKinds,
  });
}
