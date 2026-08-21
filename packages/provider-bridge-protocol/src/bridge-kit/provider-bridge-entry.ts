/**
 * The bridge export shape.
 *
 * A provider bridge is a module inside its plugin's `bb.host` artifact that
 * *exports* its surface instead of starting itself: the daemon-side bootstrap
 * imports the artifact, finds this export, and owns the process boundary
 * (argv, plugin-scoped directories, stdin framing, signals). That inversion is
 * what lets one artifact carry both a bridge and a host RPC entry, and what
 * lets a bridge be imported by tests without taking over stdio.
 */

/** The name a bridge must export from its plugin's host artifact. */
export const PROVIDER_BRIDGE_EXPORT_NAME = "experimental_providerBridge";

/** Where this bridge process may keep files, scoped to the owning plugin. */
export interface ProviderBridgeContext {
  /** The plugin that ships this bridge. */
  pluginId: string;
  /** Persistent, per-plugin, survives daemon restarts and plugin updates. */
  dataDir: string;
  /** This process only; removed when it exits. */
  tempDir: string;
}

export interface ProviderBridgeDefinition {
  /** One decoded stdin line of the Provider Bridge Protocol. */
  handleLine: (line: string) => void;
  /**
   * Called once before the first line is read, with the process's
   * plugin-scoped directories. Omit it when the bridge keeps no files.
   */
  start?: (context: ProviderBridgeContext) => void;
  /** Stdin closed: the runtime is gone and the bridge must shut down. */
  onClose?: () => void;
  onSigterm?: () => void;
  onSigint?: () => void;
}

export interface ProviderBridgeEntry extends ProviderBridgeDefinition {
  /** Bumped when the bootstrap↔bridge contract changes incompatibly. */
  experimental_apiVersion: 1;
}

export function experimental_defineProviderBridge(
  definition: ProviderBridgeDefinition,
): ProviderBridgeEntry {
  return { experimental_apiVersion: 1, ...definition };
}

/**
 * Narrow an imported artifact's bridge export. Returns a problem string rather
 * than throwing so the bootstrap can name the plugin in one legible message.
 */
export function parseProviderBridgeEntry(
  value: unknown,
): { entry: ProviderBridgeEntry; problem: null } | { entry: null; problem: string } {
  if (typeof value !== "object" || value === null) {
    return {
      entry: null,
      problem: `exports no "${PROVIDER_BRIDGE_EXPORT_NAME}"`,
    };
  }
  const candidate = value as Partial<ProviderBridgeEntry>;
  if (candidate.experimental_apiVersion !== 1) {
    return {
      entry: null,
      problem: `exports "${PROVIDER_BRIDGE_EXPORT_NAME}" with unsupported apiVersion ${String(candidate.experimental_apiVersion)} (expected 1) — build it with experimental_defineProviderBridge()`,
    };
  }
  if (typeof candidate.handleLine !== "function") {
    return {
      entry: null,
      problem: `exports "${PROVIDER_BRIDGE_EXPORT_NAME}" without a handleLine function`,
    };
  }
  return { entry: candidate as ProviderBridgeEntry, problem: null };
}
