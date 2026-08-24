import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { codexExtensionKinds } from "./src/extension-kinds.js";
import { CODEX_NATIVE_ROOTS_DECLARATION } from "./src/native-roots.js";

/**
 * First-party Codex provider plugin. The declaration is the only source of
 * this provider: disabling this plugin removes the provider.
 *
 * Codex's own knobs (native memories, native multi-agent tools) are this
 * plugin's settings and reach the bridge through the opaque `providerOptions`
 * bag derived below — core carries none of them.
 */
export default function plugin(bb: BbPluginApi) {
  // The ChatGPT-backed helper inference and voice transcription: served from
  // this plugin's host entry, chosen by the user with `BB_INFERENCE` /
  // `BB_TRANSCRIPTION` = `codex/<model>`. Core carries no Codex client.
  bb.experimental_aiServices.register({
    id: "codex",
    displayName: "Codex (ChatGPT account or API key)",
    kinds: ["inference", "voice"],
  });

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
    // Codex answers `model/list` from account state and ignores the workspace
    // path, so one probe per machine serves every workspace on it.
    models: { scope: "host" },
    // Where Codex keeps its own skills, so bb can list them beside its own and
    // offer them in the composer: the static workspace and home roots, plus
    // the flag that makes bb ask this plugin's host entry for the host-only
    // ones (`$CODEX_HOME/skills`, its `.system` directory, and every enabled
    // codex plugin's skills), since `CODEX_HOME` can move them and plugin
    // installs differ per machine. See `src/native-roots.ts`.
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
      reasoningLevels: ["low", "medium", "high", "xhigh", "max", "ultra"],
    },
    reasoningLevels: [
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
    ],
    composerActions: ["plan", "goal"],
    deriveProviderOptions(context) {
      return {
        memoryEnabled: context.settings.memoryEnabled !== false,
        providerSubagentsEnabled: context.settings.subagentsDisabled !== true,
      };
    },
    // Codex goals (thread state) and the macOS permission profile (an item
    // beside an approval) are codex's own vocabulary, validated at ingest
    // against these schemas.
    extensionKinds: codexExtensionKinds,
  });
}
