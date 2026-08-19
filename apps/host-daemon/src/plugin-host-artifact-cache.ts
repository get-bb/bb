import { join } from "node:path";
import { ensureCachedNodeArtifact } from "./node-artifact-cache.js";
import { safePluginSegment } from "@bb/process-utils";
import type { HostDaemonLogger } from "./logger.js";

/**
 * The one on-disk cache for plugin `bb.host` artifacts.
 *
 * Both daemon-side consumers land here — the host RPC worker and the provider
 * bridge — and they cache the same bytes under the same path, because they run
 * the same artifact. Verification, in-flight dedupe, retry-once-on-mismatch and
 * the 0o600 staged write live in {@link ensureCachedNodeArtifact}; this module
 * states only the layout and the pruning policy.
 *
 * Pruning is keep-only-current: a plugin runs one host artifact at a time, so
 * every other digest under its directory is superseded. (Bridges used to prune
 * by disuse instead, because an artifact launch named only a hash and the
 * daemon could not tell whose bridge it was about to delete. A launch now names
 * its plugin, so that workaround is gone.)
 */
export const PLUGIN_HOST_ARTIFACT_CACHE_SEGMENT = "plugin-host-artifacts";
// The downloaded bundle is ESM. Keep the cache filename unambiguous so Node
// does not inherit module classification from an unrelated ancestor
// package.json (which can also emit MODULE_TYPELESS_PACKAGE_JSON warnings).
const ARTIFACT_FILE_NAME = "host.mjs";
const LEGACY_ARTIFACT_FILE_NAMES = ["host.js"] as const;

export type FetchPluginHostArtifact = (args: {
  pluginId: string;
  digest: string;
  expectedByteLength: number;
}) => Promise<Uint8Array>;

export async function ensureCachedPluginHostArtifact(args: {
  dataDir: string;
  pluginId: string;
  digest: string;
  byteLength: number;
  fetchArtifact: FetchPluginHostArtifact;
  logger: Pick<HostDaemonLogger, "debug" | "warn">;
}): Promise<string> {
  return ensureCachedNodeArtifact({
    cacheDir: join(
      args.dataDir,
      PLUGIN_HOST_ARTIFACT_CACHE_SEGMENT,
      safePluginSegment(args.pluginId),
    ),
    digest: args.digest,
    byteLength: args.byteLength,
    fileName: ARTIFACT_FILE_NAME,
    legacyFileNames: LEGACY_ARTIFACT_FILE_NAMES,
    // The cache is content-addressed and generic; the plugin id it belongs to
    // is the caller's business, so the fetch closes over it.
    fetchArtifact: ({ digest, byteLength }) =>
      args.fetchArtifact({
        pluginId: args.pluginId,
        digest,
        expectedByteLength: byteLength,
      }),
    prune: { kind: "keep-only-current" },
    logger: args.logger,
  });
}
