import type {
  JsonValue,
  PluginProviderCapabilities,
  PluginProviderDeclaration,
  PluginProviderStrings,
} from "@get-bb/plugin-sdk";
import { ACP_FAMILY, type AcpAgentDefinition } from "./agents.js";

const ACP_BASE_CAPABILITIES: PluginProviderCapabilities = {
  supportsServiceTier: true,
  supportsNativeUserQuestion: false,
  supportsManualCompaction: false,
  supportsThreadArchive: false,
  supportsThreadRename: false,
  fork: "none",
  permissionModes: ["accept-edits", "full"],
  reasoningLevels: ["low", "medium", "high", "xhigh", "max"],
};

const ACP_SERVICE_TIERS = [
  { id: "default", label: "Default" },
  { id: "fast", label: "Fast" },
] as const;

const DEFAULT_FORK = "none" as const;

function acpStrings(agent: AcpAgentDefinition): PluginProviderStrings {
  const signIn = agent.signInCommand;
  const strings: PluginProviderStrings = {
    signInHint:
      signIn === undefined
        ? `Sign in to ${agent.displayName} on the machine, then reload.`
        : `Run \`${signIn}\` on the machine to sign in.`,
    expiredHint:
      signIn === undefined
        ? `Your ${agent.displayName} session expired. Sign in on the machine, then reload.`
        : `Your ${agent.displayName} session expired. Run \`${signIn}\`, then reload.`,
    installUrl: agent.installUrl ?? "https://agentclientprotocol.com",
  };
  if (agent.iconTint !== undefined) strings.iconTint = agent.iconTint;
  return strings;
}

export function acpProviderDeclaration(
  agent: AcpAgentDefinition,
): PluginProviderDeclaration {
  const bridgeOptionEntries: Array<[string, JsonValue]> = [
    ["acpLaunchSpec", { ...agent.launch }],
  ];
  if (agent.dialect !== undefined) {
    bridgeOptionEntries.push(["acpDialect", agent.dialect]);
  }
  if (agent.parameterizedModelPicker === true) {
    bridgeOptionEntries.push(["parameterizedModelPicker", true]);
  }
  if (agent.primaryModels !== undefined) {
    bridgeOptionEntries.push(["primaryModels", [...agent.primaryModels]]);
  }
  if (agent.reasoningProbePriorityModelIds !== undefined) {
    bridgeOptionEntries.push([
      "reasoningProbePriorityModelIds",
      [...agent.reasoningProbePriorityModelIds],
    ]);
  }
  const bridgeOptions = Object.fromEntries(bridgeOptionEntries);

  const declaration: PluginProviderDeclaration = {
    id: agent.id,
    displayName: agent.displayName,
    family: ACP_FAMILY,
    strings: acpStrings(agent),
    serviceTiers: [...ACP_SERVICE_TIERS],
    experimental_bridgeOptions: bridgeOptions,
    models: { scope: "host" },
    maintenance: {
      health: true,
      usage: agent.providerUsage === true,
      installation: agent.providerInstallation === true,
    },
    capabilities: {
      ...ACP_BASE_CAPABILITIES,
      fork: agent.fork ?? DEFAULT_FORK,
      permissionModes: [...ACP_BASE_CAPABILITIES.permissionModes],
      reasoningLevels:
        agent.reasoningLevels === undefined
          ? [...ACP_BASE_CAPABILITIES.reasoningLevels]
          : [...agent.reasoningLevels],
    },
    composerActions: [],
  };
  if (agent.icon !== undefined) declaration.icon = agent.icon;
  if (agent.visibility !== undefined) {
    declaration.experimental_visibility = agent.visibility;
  }
  if (agent.launch.nativeSkillRoots !== undefined) {
    declaration.experimental_nativeSkillRoots = {
      user: [...agent.launch.nativeSkillRoots.user],
      project: [...agent.launch.nativeSkillRoots.project],
    };
  }
  if (agent.nativeRootsResolver !== undefined) {
    declaration.experimental_resolvesNativeRoots = true;
  }
  if (agent.supportsManualCompaction === true) {
    declaration.capabilities.supportsManualCompaction = true;
  }
  return declaration;
}
