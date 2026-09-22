import { registerUsageSource } from "./src/usage-source.js";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  CLAUDE_CODE_ACTIVE_CATALOG_DATA,
  CLAUDE_XHIGH_CAPABLE_REASONING_EFFORT_DATA,
  DEFAULT_CLAUDE_CODE_MODEL,
} from "./src/model-catalog-data.js";
import { CLAUDE_NATIVE_ROOTS_DECLARATION } from "./src/native-roots.js";
import type { ClaudeToolProfile } from "./src/tool-profiles.js";

interface ClaudeProviderVariant {
  displayName: string;
  id: string;
  simpleSystemPrompt: boolean;
  toolProfile: ClaudeToolProfile;
}

const CLAUDE_PROVIDER_VARIANTS = [
  {
    id: "claude-code",
    displayName: "Claude Code",
    toolProfile: "full",
    simpleSystemPrompt: false,
  },
  {
    id: "claude-code-builder",
    displayName: "Claude Code Builder",
    toolProfile: "builder",
    simpleSystemPrompt: false,
  },
  {
    id: "claude-code-review",
    displayName: "Claude Code Review",
    toolProfile: "review",
    simpleSystemPrompt: false,
  },
  {
    id: "claude-code-simple",
    displayName: "Claude Code Simple (experimental)",
    toolProfile: "full",
    simpleSystemPrompt: true,
  },
] as const satisfies readonly ClaudeProviderVariant[];

export default function plugin(bb: BbPluginApi) {
  registerUsageSource(bb);
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
    chromeEnabled: {
      type: "boolean",
      label: "Claude in Chrome",
      description:
        "Start Claude Code with the Claude in Chrome browser tools. Needs the Chrome extension and a claude.ai login on the host.",
      default: false,
    },
  });

  for (const variant of CLAUDE_PROVIDER_VARIANTS) {
    bb.providers.register({
      id: variant.id,
      displayName: variant.displayName,
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
          description:
            "Extra-high effort plus standing workflow orchestration.",
        },
        { id: "max", label: "Max" },
      ],
      composerActions: ["plan"],
      completedTurnDisplay: "flat",
      env: { passthrough: ["BB_CLAUDE_CODE_EXECUTABLE"] },
      models: {
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
          ...(variant.toolProfile === "full"
            ? {}
            : { toolProfile: variant.toolProfile }),
          ...(variant.simpleSystemPrompt ? { simpleSystemPrompt: true } : {}),
          memoryEnabled: context.settings.memoryEnabled !== false,
          providerSubagentsEnabled: context.settings.subagentsDisabled !== true,
          workflowsEnabled: context.settings.workflowsDisabled !== true,
          chromeEnabled: context.settings.chromeEnabled === true,
          ...(context.promptMode === "plan"
            ? { claudeCodePermissionMode: "plan" }
            : {}),
        };
      },
    });
  }
}
