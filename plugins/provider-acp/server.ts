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
  // ACP session/fork clones a whole session (tip only, no checkpoint rewind),
  // and it is an unstable ACP extension that not every agent implements. The
  // bridge refuses `session/fork` for an agent whose `initialize` reply does
  // not advertise `sessionCapabilities.fork`, but only after the server has
  // already created and started the fork thread. So this declaration, which
  // is the server's fork gate and the app's fork affordance, must match what
  // the agent actually advertises: override it with "none" for agents that
  // do not (#1833).
  fork: "tip" as const,
  supportsManualCompaction: false,
  supportsThreadArchive: false,
  supportsThreadRename: false,
  permissionModes: ["accept-edits", "full"] as const,
  reasoningLevels: ["low", "medium", "high", "xhigh", "max"] as const,
};

/** Cursor exposes a `-fast` model tail the bridge resolves from the tier. */
const ACP_SERVICE_TIERS = [
  { id: "default", label: "Default" },
  { id: "fast", label: "Fast" },
] as const;

/** Provider copy for core surfaces, per agent: how to sign in and install. */
function acpStrings(args: {
  name: string;
  signInCommand: string;
  installUrl: string;
  iconTint?: { light: string; dark: string };
}) {
  return {
    signInHint: `Run \`${args.signInCommand}\` on the machine to sign in.`,
    expiredHint: `Your ${args.name} session expired. Run \`${args.signInCommand}\`, then reload.`,
    installUrl: args.installUrl,
    ...(args.iconTint === undefined ? {} : { iconTint: args.iconTint }),
  };
}

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
    experimental_strings: acpStrings({
      name: "Cursor",
      signInCommand: "cursor-agent login",
      installUrl: "https://cursor.com/docs/cli/installation",
      iconTint: { light: "#111827", dark: "#F5F5F5" },
    }),
    experimental_serviceTiers: [...ACP_SERVICE_TIERS],
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
      // cursor-agent (2026.08.11) advertises `sessionCapabilities: { list }`
      // only; no session/fork.
      fork: "none",
    },
    composerActions: [],
  },
  {
    id: "acp-opencode",
    displayName: "opencode",
    experimental_visibility: "installed",
    experimental_strings: acpStrings({
      name: "opencode",
      signInCommand: "opencode auth login",
      installUrl: "https://opencode.ai/docs",
      iconTint: { light: "#2563EB", dark: "#2563EB" },
    }),
    experimental_serviceTiers: [...ACP_SERVICE_TIERS],
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
    experimental_strings: acpStrings({
      name: "omp",
      signInCommand: "omp login",
      installUrl: "https://github.com/can1357/omp",
      iconTint: { light: "#9333EA", dark: "#9333EA" },
    }),
    experimental_serviceTiers: [...ACP_SERVICE_TIERS],
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
    experimental_strings: acpStrings({
      name: "Grok Build",
      signInCommand: "grok login",
      installUrl: "https://docs.x.ai/docs/grok-build",
    }),
    experimental_serviceTiers: [...ACP_SERVICE_TIERS],
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
      // `grok agent stdio` advertises `sessionCapabilities: { list, resume,
      // close }`; no session/fork.
      fork: "none",
      reasoningLevels: ["low", "medium", "high"],
    },
    composerActions: [],
  },
  {
    id: "acp-hermes-agent",
    displayName: "Hermes Agent",
    experimental_visibility: "installed",
    experimental_strings: acpStrings({
      name: "Hermes Agent",
      signInCommand: "hermes login",
      installUrl: "https://hermes-agent.nousresearch.com",
    }),
    experimental_serviceTiers: [...ACP_SERVICE_TIERS],
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
    bb.providers.register(provider);
  }
}
