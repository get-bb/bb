/**
 * One agent definition → one provider declaration.
 *
 * Every ACP agent — bb's known list, a user's configured agent, and (through
 * the published kit) a third party's — becomes a declaration the same way.
 */

import type {
  PluginProviderCapabilities,
  PluginProviderDeclaration,
  PluginProviderStrings,
} from "@get-bb/plugin-sdk";
import { ACP_FAMILY, type AcpAgentDefinition } from "./agents.js";

/**
 * ACP agents run their own tools and own their permission prompts, so bb's
 * pre-session facts are deliberately few. Permission modes are enforced
 * cooperatively by the bridge; service tier exists because an agent may
 * expose a fast model tail the bridge resolves from the tier.
 */
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

/**
 * Whether an agent implements the unstable ACP `session/fork`. The bridge
 * refuses a fork the agent never advertised, but only after bb has created
 * the fork thread, so a declaration above what the agent answers is a thread
 * that dies on start (#1833). An agent that does not state its support — a
 * user-configured agent bb has never seen — declares none rather than
 * offering an affordance that may break.
 */
const DEFAULT_FORK = "none" as const;

/**
 * The copy core surfaces render for this agent. A configured agent names no
 * sign-in command and no install page, so its copy says what bb actually
 * knows: sign in the way the agent itself documents.
 */
function acpStrings(agent: AcpAgentDefinition): PluginProviderStrings {
  const signIn = agent.signInCommand;
  return {
    signInHint:
      signIn === undefined
        ? `Sign in to ${agent.displayName} on the machine, then reload.`
        : `Run \`${signIn}\` on the machine to sign in.`,
    expiredHint:
      signIn === undefined
        ? `Your ${agent.displayName} session expired. Sign in on the machine, then reload.`
        : `Your ${agent.displayName} session expired. Run \`${signIn}\`, then reload.`,
    installUrl: agent.installUrl ?? "https://agentclientprotocol.com",
    ...(agent.iconTint === undefined ? {} : { iconTint: agent.iconTint }),
  };
}

export function acpProviderDeclaration(
  agent: AcpAgentDefinition,
): PluginProviderDeclaration {
  return {
    id: agent.id,
    displayName: agent.displayName,
    family: ACP_FAMILY,
    ...(agent.icon === undefined ? {} : { icon: agent.icon }),
    strings: acpStrings(agent),
    serviceTiers: [...ACP_SERVICE_TIERS],
    ...(agent.visibility === undefined
      ? {}
      : { experimental_visibility: agent.visibility }),
    // Where this agent keeps its own skills, so bb can list them beside its
    // own and offer them in the composer. Declared, not dug out of the launch
    // spec: the bridge reads the same roots from `acpLaunchSpec`, but core
    // never reaches into a plugin's opaque bridge options. Entries pass
    // through as written — a path, or a path with its options.
    ...(agent.launch.nativeSkillRoots === undefined
      ? {}
      : {
          experimental_nativeSkillRoots: {
            user: [...agent.launch.nativeSkillRoots.user],
            project: [...agent.launch.nativeSkillRoots.project],
          },
        }),
    // The host entry answers `resolveNativeRoots` for this agent: core asks
    // the workspace host for the roots only that host can name.
    ...(agent.nativeRootsResolver === undefined
      ? {}
      : { experimental_resolvesNativeRoots: true }),
    experimental_bridgeOptions: {
      // Which vendor side channels the bridge reads for this agent
      // (packages/provider-bridge-acp/src/dialect.ts). Declared per
      // registration so a third-party plugin that registers a known agent
      // gets the same reporting fidelity a first-party registration does.
      ...(agent.dialect === undefined ? {} : { acpDialect: agent.dialect }),
      acpLaunchSpec: { ...agent.launch },
    },
    // Every ACP agent answers `model/list` from its own account or agent
    // state — the protocol has no workspace-scoped model configuration — so
    // one probe per machine serves every workspace on it.
    models: { scope: "host" },
    // Every ACP agent answers the health probe through the shared bridge;
    // usage and installation are per agent.
    maintenance: {
      health: true,
      usage: agent.providerUsage === true,
      installation: agent.providerInstallation === true,
    },
    capabilities: {
      ...ACP_BASE_CAPABILITIES,
      fork: agent.fork ?? DEFAULT_FORK,
      permissionModes: [...ACP_BASE_CAPABILITIES.permissionModes],
      ...(agent.supportsManualCompaction === true
        ? { supportsManualCompaction: true }
        : {}),
      reasoningLevels:
        agent.reasoningLevels === undefined
          ? [...ACP_BASE_CAPABILITIES.reasoningLevels]
          : [...agent.reasoningLevels],
    },
    composerActions: [],
  };
}
