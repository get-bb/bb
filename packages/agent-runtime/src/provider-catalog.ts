/**
 * Capability baselines for the bundled first-party bridges.
 *
 * Providers are declared server-side by plugins; the daemon does not see those
 * declarations for bundled bridges, whose adapters are constructed locally.
 * This table is what those adapters advertise until the initialize handshake
 * narrows it — the same role `acp/launch-specs.ts` plays for ACP launch data.
 *
 * A plugin-delivered bridge never reads this: its validated capabilities ride
 * the verified `bridgeLaunch`.
 *
 * DEBT: this duplicates the declarations in plugins/provider-*. It disappears
 * when the first-party bridges move into their plugin directories and ship
 * through the artifact pipeline (wave 5 of the graduation plan), at which
 * point their capabilities arrive on the launch like every other plugin's.
 */
import type { ProviderCapabilities, ProviderInfo } from "@bb/domain";

/** Whether an id belongs to the dynamic ACP tier. */
export function isAcpProviderId(value: string): boolean {
  return value.startsWith("acp-");
}

const CODEX_CAPABILITIES: ProviderCapabilities = {
  supportsArchive: true,
  supportsRename: true,
  supportsServiceTier: true,
  supportsUserQuestion: false,
  supportsFork: true,
  supportsSessionRewind: true,
  supportedPermissionModes: ["accept-edits", "auto", "full"],
};

const CLAUDE_CODE_CAPABILITIES: ProviderCapabilities = {
  supportsArchive: false,
  supportsRename: false,
  supportsServiceTier: false,
  supportsUserQuestion: true,
  supportsFork: true,
  supportsSessionRewind: true,
  supportedPermissionModes: ["accept-edits", "auto", "full"],
};

const PI_CAPABILITIES: ProviderCapabilities = {
  supportsArchive: false,
  supportsRename: false,
  supportsServiceTier: false,
  supportsUserQuestion: false,
  supportsFork: true,
  supportsSessionRewind: true,
  supportedPermissionModes: ["full"],
};

/**
 * Shared by every ACP provider: the external agent owns model selection, tool
 * execution, and session naming, so BB-side capabilities stay minimal. Fork
 * support is the declared offer; each agent's real answer is negotiated at the
 * handshake. Cursor's `-fast` model tail is resolved by the bridge from the
 * service tier, so service tier is supported here.
 */
const ACP_CAPABILITIES: ProviderCapabilities = {
  supportsArchive: false,
  supportsRename: false,
  supportsServiceTier: true,
  supportsUserQuestion: false,
  supportsFork: true,
  supportsSessionRewind: false,
  supportedPermissionModes: ["accept-edits", "full"],
};

/**
 * Whether a stopped session of this provider can resume from its persisted id.
 * The runtime stamps it into the thread's shell environment; ACP's real answer
 * comes from the agent's initialize result, so the static claim is false.
 */
const SESSION_RESTORABLE_BY_PROVIDER_ID: Readonly<Record<string, boolean>> = {
  codex: true,
  "claude-code": true,
  pi: true,
};

interface BundledProvider {
  displayName: string;
  capabilities: ProviderCapabilities;
}

const BUNDLED_PROVIDERS: Readonly<Record<string, BundledProvider>> = {
  codex: { displayName: "Codex", capabilities: CODEX_CAPABILITIES },
  "claude-code": {
    displayName: "Claude Code",
    capabilities: CLAUDE_CODE_CAPABILITIES,
  },
  pi: { displayName: "Pi", capabilities: PI_CAPABILITIES },
  "acp-cursor": { displayName: "Cursor", capabilities: ACP_CAPABILITIES },
};

function cloneCapabilities(
  capabilities: ProviderCapabilities,
): ProviderCapabilities {
  return {
    ...capabilities,
    supportedPermissionModes: [...capabilities.supportedPermissionModes],
  };
}

function toInfo(id: string, provider: BundledProvider): ProviderInfo {
  return {
    available: true,
    capabilities: cloneCapabilities(provider.capabilities),
    // Composer affordances are server-side product policy read off the
    // registry; the daemon's adapters never use them.
    composerActions: [],
    displayName: provider.displayName,
    id,
    logoUrl: null,
  };
}

/** Whether this id has a bundled first-party bridge. */
export function isBundledProviderId(value: string): boolean {
  return Object.hasOwn(BUNDLED_PROVIDERS, value);
}

/** Baseline info for a bundled provider, or null for any other id. */
export function getBundledProviderInfo(providerId: string): ProviderInfo | null {
  const provider = BUNDLED_PROVIDERS[providerId];
  return provider === undefined ? null : toInfo(providerId, provider);
}

/** Baseline info for an ACP id with no bundled entry (custom/known agents). */
export function buildAcpProviderInfo(args: {
  id: string;
  displayName: string;
}): ProviderInfo {
  if (!isAcpProviderId(args.id)) {
    throw new Error(`ACP provider id "${args.id}" must start with "acp-".`);
  }
  return toInfo(args.id, {
    displayName: args.displayName,
    capabilities: ACP_CAPABILITIES,
  });
}

/** Whether a stopped session of this provider resumes from its persisted id. */
export function isSessionRestorableProvider(providerId: string): boolean {
  return SESSION_RESTORABLE_BY_PROVIDER_ID[providerId] ?? false;
}

/** Ids with a bundled bridge, for the unsupported-provider error message. */
export function listBundledProviderIds(): string[] {
  return Object.keys(BUNDLED_PROVIDERS);
}

/** Baseline infos for every bundled provider. */
export function listBundledProviderInfos(): ProviderInfo[] {
  return Object.entries(BUNDLED_PROVIDERS).map(([id, provider]) =>
    toInfo(id, provider),
  );
}
