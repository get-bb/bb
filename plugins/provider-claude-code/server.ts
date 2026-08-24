import type { BbPluginApi } from "@get-bb/plugin-sdk";
// The server bundles this file with only the SDK root specifier external, so
// nothing here may pull in the bridge modules: the catalog is import-free
// data and the native-roots module needs only node builtins and zod.
import {
  CLAUDE_CODE_ACTIVE_CATALOG_DATA,
  CLAUDE_XHIGH_CAPABLE_REASONING_EFFORT_DATA,
  DEFAULT_CLAUDE_CODE_MODEL,
} from "./src/model-catalog-data.js";
import { CLAUDE_NATIVE_ROOTS_DECLARATION } from "./src/native-roots.js";

/**
 * First-party Claude Code provider plugin. The declaration is the only source
 * of this provider: disabling this plugin removes the provider.
 *
 * The provider's own knobs (auto-memory, the native Task tool, the native
 * Workflow tool) are this plugin's settings and reach the bridge through the
 * opaque `providerOptions` bag derived below — core carries none of them.
 */
export default function plugin(bb: BbPluginApi) {
  bb.settings.define({
    memoryEnabled: {
      type: "boolean",
      label: "Claude Code memory",
      description:
        "Allow Claude Code to read and write its native auto-memory for bb threads.",
      default: true,
    },
    subagentsDisabled: {
      type: "boolean",
      label: "Disable provider subagents",
      description:
        "Hide Claude Code's native Task tool so agents use bb for delegation.",
      default: false,
    },
    workflowsDisabled: {
      type: "boolean",
      label: "Disable Workflow tool",
      description: "Hide Claude Code's native Workflow tool for bb threads.",
      default: false,
    },
  });

  bb.providers.register({
    id: "claude-code",
    displayName: "Claude Code",
    icon: "./icons/claude-code.svg",
    strings: {
      signInHint: "Run `claude` on the machine to sign in.",
      expiredHint: "Your Claude session expired. Run `claude`, then reload.",
      installUrl: "https://claude.com/claude-code",
      brandPrefix: "Claude ",
      planModeCopy:
        "Claude Code will plan without normal full-access execution.",
      iconTint: { light: "#D97757", dark: "#D97757" },
    },
    // Where Claude Code keeps its own skills and slash commands, so bb can
    // list them beside its own and offer them in the composer. Only the
    // workspace roots are declared here: the user roots follow
    // CLAUDE_CONFIG_DIR, and installed Claude plugins live on the host, so
    // the `bb.host` entry resolves those per host and workspace
    // (`src/native-roots.ts`).
    ...CLAUDE_NATIVE_ROOTS_DECLARATION,
    maintenance: { health: true, usage: true, installation: true },
    capabilities: {
      supportsServiceTier: false,
      supportsNativeUserQuestion: true,
      fork: "checkpoint",
      supportsManualCompaction: true,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      permissionModes: ["accept-edits", "auto", "full"],
      reasoningLevels: ["low", "medium", "high", "xhigh", "ultracode", "max"],
    },
    reasoningLevels: [
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium" },
      { id: "high", label: "High" },
      { id: "xhigh", label: "Extra High" },
      {
        id: "ultracode",
        label: "Ultracode",
        description: "Extra-high effort plus standing workflow orchestration.",
      },
      { id: "max", label: "Max" },
    ],
    composerActions: ["plan"],
    // The bridge honors an operator-set CLI path; provider processes are
    // spawned with inherited BB_* variables stripped, so it is declared.
    env: { passthrough: ["BB_CLAUDE_CODE_EXECUTABLE"] },
    models: {
      // The CLI answers `model/list` from account state, so one probe per
      // machine serves every workspace on it.
      scope: "host",
      fallback: CLAUDE_CODE_ACTIVE_CATALOG_DATA.map((entry) => ({
        id: entry.model,
        displayName: entry.displayName,
        description: entry.description,
        supportedReasoningEfforts: CLAUDE_XHIGH_CAPABLE_REASONING_EFFORT_DATA,
        defaultReasoningEffort: entry.defaultReasoningEffort,
        isDefault: entry.model === DEFAULT_CLAUDE_CODE_MODEL,
      })),
    },
    deriveProviderOptions(context) {
      return {
        memoryEnabled: context.settings.memoryEnabled !== false,
        providerSubagentsEnabled: context.settings.subagentsDisabled !== true,
        workflowsEnabled: context.settings.workflowsDisabled !== true,
        // Plan mode is a bb prompt mode; this bridge maps it onto the Claude
        // SDK's native `plan` permission mode.
        ...(context.promptMode === "plan"
          ? { claudeCodePermissionMode: "plan" }
          : {}),
      };
    },
  });
}
