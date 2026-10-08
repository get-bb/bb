import { registerCodexAiService } from "./src/ai-service.js";
import { registerUsageSource } from "./src/usage-source.js";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { codexExtensionKinds } from "./src/extension-kinds.js";
import { CODEX_NATIVE_ROOTS_DECLARATION } from "./src/native-roots.js";
import {
  DAYBREAK_MODEL_OPTION,
  DAYBREAK_MODEL_OPTION_ID,
  DAYBREAK_ON,
} from "./src/daybreak.js";

export default function plugin(bb: BbPluginApi) {
  registerUsageSource(bb);
  registerCodexAiService(bb);

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
    strings: {
      signInHint: "Run `codex` on the machine to sign in.",
      expiredHint: "Your Codex session expired. Run `codex`, then reload.",
      installUrl: "https://developers.openai.com/codex/cli",
      brandPrefix: "GPT-",
    },
    models: { scope: "host" },
    ...CODEX_NATIVE_ROOTS_DECLARATION,
    maintenance: { health: true, usage: true, installation: true },
    capabilities: {
      supportsServiceTier: true,
      supportsNativeUserQuestion: false,
      fork: "checkpoint",
      supportsManualCompaction: true,
      supportsThreadArchive: true,
      supportsThreadRename: true,
      permissionModes: ["accept-edits", "auto", "full"],
      reasoningLevels: [
        "none",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
        "ultra",
      ],
    },
    reasoningLevels: [
      { id: "none", label: "None" },
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
    serviceTiers: [
      { id: "default", label: "Default" },
      { id: "fast", label: "Fast" },
      { id: "ultrafast", label: "Ultrafast" },
    ],
    experimental_modelOptions: [DAYBREAK_MODEL_OPTION],
    composerActions: ["plan", "goal"],
    deriveProviderOptions(context) {
      return {
        memoryEnabled: context.settings.memoryEnabled !== false,
        providerSubagentsEnabled: context.settings.subagentsDisabled !== true,
        daybreak:
          context.experimental_modelOptions[DAYBREAK_MODEL_OPTION_ID] ===
          DAYBREAK_ON,
      };
    },
    extensionKinds: codexExtensionKinds,
  });
}
