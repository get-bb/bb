import { join } from "node:path";
import {
  ensureCachedNodeArtifact,
  type NodeArtifactPruneStrategy,
} from "./node-artifact-cache.js";
import type { HostDaemonLogger } from "./logger.js";

/**
 * Provider bridge bundles, cached by the daemon's shared content-addressed
 * artifact cache. The verification invariant, the in-flight dedupe, the
 * retry-once-on-mismatch and the 0o600 staged write all live in
 * {@link ensureCachedNodeArtifact}; this module only states the bridge
 * family's layout and pruning policy.
 */

const CACHE_DIR_SEGMENT = "provider-bridges";
const BRIDGE_FILE_NAME = "bridge.mjs";

/**
 * Several providers run at once, and an `artifact` bridge launch names only a
 * sha256 — the daemon cannot yet tell which cached bridge belongs to which
 * plugin, so it cannot prune to "the current one". It prunes by disuse
 * instead: every launch touches its digest directory, so a month without a
 * single launch means nothing on this host runs that bridge any more.
 */
const BRIDGE_PRUNE: NodeArtifactPruneStrategy = {
  kind: "keep-recently-used",
  maxAgeMs: 30 * 24 * 60 * 60 * 1000,
};

export type FetchProviderBridge = (args: {
  sha256: string;
  expectedByteLength: number;
}) => Promise<Uint8Array>;

export interface EnsureCachedProviderBridgeArgs {
  dataDir: string;
  fetchProviderBridge: FetchProviderBridge;
  sha256: string;
  byteLength: number;
  logger: Pick<HostDaemonLogger, "debug" | "warn">;
}

/**
 * Ensure the bridge artifact is cached under
 * `<dataDir>/provider-bridges/<sha256>/bridge.mjs` and return that absolute
 * path, downloading and hash-verifying it when it is missing or corrupt.
 */
export async function ensureCachedProviderBridge(
  args: EnsureCachedProviderBridgeArgs,
): Promise<string> {
  return ensureCachedNodeArtifact({
    cacheDir: join(args.dataDir, CACHE_DIR_SEGMENT),
    digest: args.sha256,
    byteLength: args.byteLength,
    fileName: BRIDGE_FILE_NAME,
    fetchArtifact: ({ digest, byteLength }) =>
      args.fetchProviderBridge({
        sha256: digest,
        expectedByteLength: byteLength,
      }),
    prune: BRIDGE_PRUNE,
    logger: args.logger,
  });
}
