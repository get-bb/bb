import type {
  BbPluginApi,
  PluginProviderDeclaration,
} from "@get-bb/plugin-sdk";

const ACP_BASE_CAPABILITIES = {
  experimental_providerHealth: true,
  experimental_providerUsage: false,
  experimental_providerInstallation: false,
  supportsServiceTier: true,
  supportsNativeUserQuestion: false,
  fork: "tip" as const,
  supportsManualCompaction: false,
  supportsThreadArchive: false,
  supportsThreadRename: false,
  supportsWorkflows: false,
  permissionModes: ["accept-edits", "full"] as const,
  reasoningLevels: ["low", "medium", "high", "xhigh", "max"] as const,
};

export const CURSOR_PRIMARY_MODELS = [
  "auto",
  "cursor-grok-4.6-medium",
  "gpt-5.6-sol-medium",
  "claude-opus-5-thinking-medium",
  "claude-fable-5-thinking-medium",
  "composer-2.5",
];

const ACP_PROVIDERS: readonly PluginProviderDeclaration[] = [
  {
    id: "acp-cursor",
    displayName: "Cursor",
    icon: "./icons/cursor.svg",
    experimental_bridgeOptions: {
      acpLaunchSpec: {
        displayName: "Cursor",
        command: "cursor-agent",
        args: ["acp"],
        env: {},
        modelCli: {
          listArgs: ["--list-models"],
          selectFlag: "--model",
          primaryModels: CURSOR_PRIMARY_MODELS,
        },
      },
    },
    capabilities: {
      ...ACP_BASE_CAPABILITIES,
      experimental_providerUsage: true,
      experimental_providerInstallation: true,
    },
    composerActions: [],
  },
  {
    id: "acp-opencode",
    displayName: "opencode",
    experimental_visibility: "installed",
    experimental_bridgeOptions: {
      acpLaunchSpec: {
        displayName: "opencode",
        command: "opencode",
        args: ["acp"],
        env: {},
      },
    },
    capabilities: {
      ...ACP_BASE_CAPABILITIES,
      supportsManualCompaction: true,
    },
    composerActions: [],
  },
  {
    id: "acp-omp",
    displayName: "omp",
    experimental_visibility: "installed",
    experimental_bridgeOptions: {
      acpLaunchSpec: {
        displayName: "omp",
        command: "omp",
        args: ["acp"],
        env: {},
      },
    },
    capabilities: ACP_BASE_CAPABILITIES,
    composerActions: [],
  },
  {
    id: "acp-grok",
    displayName: "Grok Build",
    experimental_visibility: "installed",
    experimental_bridgeOptions: {
      acpLaunchSpec: {
        displayName: "Grok Build",
        command: "grok",
        args: ["agent", "stdio"],
        env: {},
        modelCli: {
          listArgs: ["models"],
          selectFlag: "--model",
          primaryModels: ["grok-4.5", "grok-composer-2.5-fast"],
        },
        permissionCli: {
          full: ["--always-approve"],
          insertAfterArgs: 1,
        },
        reasoningCli: {
          flag: "--reasoning-effort",
          supportedLevels: ["low", "medium", "high"],
          levelValues: {
            none: "low",
            xhigh: "high",
            ultracode: "high",
            max: "high",
          },
          defaultLevel: "high",
        },
      },
    },
    capabilities: {
      ...ACP_BASE_CAPABILITIES,
      reasoningLevels: ["low", "medium", "high"],
    },
    composerActions: [],
  },
  {
    id: "acp-hermes-agent",
    displayName: "Hermes Agent",
    experimental_visibility: "installed",
    experimental_bridgeOptions: {
      acpLaunchSpec: {
        displayName: "Hermes Agent",
        command: "hermes",
        args: ["acp"],
        env: {},
        nativeReasoning: {
          configId: "reasoning_effort",
          supportedLevels: ["none", "low", "medium", "high", "xhigh", "max"],
          defaultLevel: "medium",
        },
      },
    },
    capabilities: {
      ...ACP_BASE_CAPABILITIES,
      reasoningLevels: ["none", "low", "medium", "high", "xhigh", "max"],
    },
    composerActions: [],
  },
];

/** Registers every built-in ACP launch profile; the bridge owns discovery. */
export default function plugin(bb: BbPluginApi) {
  for (const provider of ACP_PROVIDERS) {
    bb.agents.experimental_registerProvider(provider);
  }
}
