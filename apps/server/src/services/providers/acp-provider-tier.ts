/**
 * The dynamic ACP tier.
 *
 * Built-in ACP providers are ordinary plugin declarations in the registry.
 * User-configured custom agents (`acp-<slug>`) remain dynamic: they are
 * resolved from config at request time and therefore need a shared capability
 * fallback. This module owns that fallback and the custom-provider info shape.
 *
 * Capabilities that vary for a user-configured ACP agent are declared on its
 * config record and resolved by
 * `system/acp-launch-spec.ts::resolveAcpAgentCapabilitiesForProviderId`.
 *
 * The external agent owns model selection, tool execution, and session naming,
 * so BB-side capabilities stay minimal. Permission modes are enforced
 * cooperatively by the ACP bridge (permission-request policy + client fs write
 * policy). Fork support is the declared offer; each agent's real answer is
 * negotiated at the bridge handshake before the unstable ACP session/fork
 * request is sent. Service tier is supported because Cursor exposes a `-fast`
 * model tail that the bridge resolves from the tier rather than fanning fast
 * variants out as separate model-list entries.
 */
import type {
  ProviderCapabilities,
  ProviderComposerAction,
  ProviderInfo,
  ProviderFork,
  ReasoningLevel,
} from "@bb/domain";
import type { ProviderServerCapabilities } from "./provider-registry.js";

/**
 * The whole tier's client-facing capabilities. Exported because the registry's
 * ACP fallbacks are capability questions, not `ProviderInfo` questions: they
 * read this directly rather than building a throwaway ProviderInfo with a
 * placeholder display name and a null logo just to reach one boolean.
 */
export const ACP_TIER_CAPABILITIES: ProviderCapabilities = {
  supportsThreadArchive: false,
  supportsThreadRename: false,
  supportsServiceTier: true,
  supportsNativeUserQuestion: false,
  // The ACP_FORK "tip" ladder, projected: fork yes, rewind no.
  supportsFork: true,
  supportsSessionRewind: false,
  permissionModes: ["accept-edits", "full"],
};

// ACP session/fork clones a whole session and cannot stop at a checkpoint,
// so fork is offered but edit-message rewind is not.
const ACP_FORK: ProviderFork = "tip";

// Skills are injected into every provider runtime, so the `/` skills
// typeahead is universal; ACP agents contribute no other composer affordance.
const ACP_COMPOSER_ACTIONS: readonly ProviderComposerAction[] = [
  { kind: "skills", trigger: "/" },
];

// Custom ACP agents manage reasoning effort internally, so this coarse ladder
// is only the fallback when per-model efforts are unavailable.
const ACP_REASONING_LEVELS: readonly ReasoningLevel[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const ACP_SERVER_CAPABILITIES: ProviderServerCapabilities = {
  reasoningLevels: ACP_REASONING_LEVELS,
  fork: ACP_FORK,
  // The registry answers dynamic ids from the resolved config record instead.
  supportsManualCompaction: false,
};

export function isAcpProviderId(value: string): boolean {
  return value.startsWith("acp-");
}

function requireAcpProviderId(providerId: string): void {
  if (!isAcpProviderId(providerId)) {
    throw new Error(`ACP provider id "${providerId}" must start with "acp-".`);
  }
}

interface BuildAcpProviderInfoArgs {
  id: string;
  displayName: string;
  logoUrl: string | null;
}

export function buildAcpProviderInfo(
  args: BuildAcpProviderInfoArgs,
): ProviderInfo {
  requireAcpProviderId(args.id);
  return {
    available: true,
    // The shared ACP bridge accepts health and usage requests for every ACP
    // id. An individual provider may still return `supported: false` for
    // usage or a successful result with no windows. Installation is enabled
    // only by a registered ACP provider, not the dynamic tier as a whole.
    experimental_providerHealth: true,
    experimental_providerUsage: true,
    experimental_providerInstallation: false,
    capabilities: {
      ...ACP_TIER_CAPABILITIES,
      permissionModes: [...ACP_TIER_CAPABILITIES.permissionModes],
    },
    composerActions: ACP_COMPOSER_ACTIONS.map((action) =>
      action.kind === "skills"
        ? { kind: "skills", trigger: action.trigger }
        : { ...action },
    ),
    displayName: args.displayName,
    id: args.id,
    logoUrl: args.logoUrl,
  };
}

export function getAcpProviderServerCapabilities(
  providerId: string,
): ProviderServerCapabilities {
  requireAcpProviderId(providerId);
  return ACP_SERVER_CAPABILITIES;
}
