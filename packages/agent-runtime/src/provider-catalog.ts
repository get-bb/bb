/**
 * Capability baseline for the one bridge bb still delivers in the daemon
 * bundle: Pi, whose agent tree cannot be inlined into a relocatable artifact.
 *
 * Providers are declared server-side by plugins; the daemon does not see that
 * declaration for a bundled bridge, whose adapter is constructed locally. This
 * is what that adapter advertises until the initialize handshake narrows it —
 * the same role `acp-launch-specs.ts` plays for ACP launch data.
 *
 * A plugin-delivered bridge never reads this: its validated capabilities ride
 * the verified `bridgeLaunch`.
 *
 * DEBT: this duplicates the declaration in plugins/provider-pi. It disappears
 * only if pi ever ships as an artifact (see the graduation plan's pi verdict).
 */
import type { ProviderCapabilities, ProviderInfo } from "@bb/domain";

/** Whether an id belongs to the dynamic ACP tier. */
export function isAcpProviderId(value: string): boolean {
  return value.startsWith("acp-");
}

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
 * Whether a stopped session of this provider can resume from its persisted id.
 * The runtime stamps it into the thread's shell environment. This is only a
 * pre-first-result seed: every bridge reports its real answer per session on
 * `thread/start`, which is the sole source for a graduated provider.
 */
const SESSION_RESTORABLE_BY_PROVIDER_ID: Readonly<Record<string, boolean>> = {
  pi: true,
};

interface BundledProvider {
  displayName: string;
  capabilities: ProviderCapabilities;
}

const BUNDLED_PROVIDERS: Readonly<Record<string, BundledProvider>> = {
  pi: { displayName: "Pi", capabilities: PI_CAPABILITIES },
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
export function getBundledProviderInfo(
  providerId: string,
): ProviderInfo | null {
  const provider = BUNDLED_PROVIDERS[providerId];
  return provider === undefined ? null : toInfo(providerId, provider);
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
