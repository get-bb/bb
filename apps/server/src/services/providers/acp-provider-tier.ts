/**
 * The dynamic ACP tier.
 *
 * Every other provider is a plugin declaration in the registry. ACP ids are
 * different: known agents (`acp-opencode`, `acp-omp`, …) and user-configured
 * custom agents (`acp-<slug>`) are resolved from launch specs at request time
 * and are never declared, so they need a shared capability answer. This module
 * is that answer — the registry's accessors fall back to it, and the listing
 * composers build their `ProviderInfo`s from it.
 *
 * Capabilities that vary per ACP agent rather than across the whole tier (for
 * example manual compaction, which OpenCode supports and Cursor does not) are
 * declared on the agent record itself and resolved by
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

// ACP agents manage reasoning effort internally. Cursor encodes it in its
// model ids (`gpt-5.3-codex-high`) and the bridge resolves (model, level) to
// the exact variant at session launch, so this coarse ladder is only the
// fallback when per-model efforts from `model/list` are unavailable.
const ACP_REASONING_LEVELS: readonly ReasoningLevel[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const ACP_SERVER_CAPABILITIES: ProviderServerCapabilities = {
  supportsWorkflows: false,
  reasoningLevels: ACP_REASONING_LEVELS,
  fork: ACP_FORK,
  // Compaction varies per ACP agent (OpenCode supports it, Cursor does not),
  // so the tier declares none and the registry answers dynamic ids from the
  // resolved agent record instead.
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

export interface BuildAcpProviderInfoArgs {
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
    // only by a registered ACP provider (currently Cursor), not the dynamic
    // tier as a whole.
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
