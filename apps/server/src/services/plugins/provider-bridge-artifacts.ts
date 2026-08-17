import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { HOST_ARTIFACT_MAX_BYTES } from "@bb/host-daemon-contract";

/**
 * A plugin's built provider bridge, recorded per load like the app-bundle
 * snapshot. `sha256`/`byteLength` are what ride the host wire in
 * `bridgeLaunch`; the internal `/provider-bridges/:sha256` route serves the
 * bytes at `path`, re-verifying the hash before responding.
 */
export interface PluginProviderBridgeArtifact {
  sha256: string;
  byteLength: number;
  /** Absolute path of `dist/provider-bridge.mjs`. */
  path: string;
}

/**
 * Live provider-bridge artifacts, keyed by owning plugin id. The same shape
 * as `SkillTreeRegistry`: the plugin runtime publishes an entry when a plugin
 * with `bb.providerBridge` commits a load and removes it on dispose, so
 * presence means "this plugin's runtime is live and its bridge is servable".
 * Consumers: the internal `/provider-bridges/:sha256` route (bytes) and
 * thread commands (the `bridgeLaunch` attach point, which is what routes a
 * plugin provider onto the bridge).
 */
export class ProviderBridgeArtifactRegistry {
  readonly #byPluginId = new Map<string, PluginProviderBridgeArtifact>();

  set(pluginId: string, artifact: PluginProviderBridgeArtifact): void {
    this.#byPluginId.set(pluginId, artifact);
  }

  delete(pluginId: string): void {
    this.#byPluginId.delete(pluginId);
  }

  getForPlugin(pluginId: string): PluginProviderBridgeArtifact | undefined {
    return this.#byPluginId.get(pluginId);
  }

  getBySha256(
    sha256: string,
  ): (PluginProviderBridgeArtifact & { pluginId: string }) | undefined {
    for (const [pluginId, artifact] of this.#byPluginId) {
      if (artifact.sha256 === sha256) {
        return { ...artifact, pluginId };
      }
    }
    return undefined;
  }
}

/**
 * Read and hash-verify a plugin's built provider bridge. Returns null when
 * the bundle or its meta sidecar is missing, unreadable, when the recorded
 * hash disagrees with the bytes on disk, or when the bundle exceeds
 * {@link HOST_ARTIFACT_MAX_BYTES} — the caller decides whether that
 * means "build it" (mutable sources) or "refuse" (prebuilt sources).
 */
export async function readPluginProviderBridgeArtifact(
  rootDir: string,
): Promise<PluginProviderBridgeArtifact | null> {
  const bundlePath = join(rootDir, "dist", "provider-bridge.mjs");
  const metaPath = join(rootDir, "dist", "provider-bridge.meta.json");
  let bytes: Buffer;
  let metaRaw: string;
  try {
    [bytes, metaRaw] = await Promise.all([
      readFile(bundlePath),
      readFile(metaPath, "utf8"),
    ]);
  } catch {
    return null;
  }
  let meta: unknown;
  try {
    meta = JSON.parse(metaRaw);
  } catch {
    return null;
  }
  if (
    typeof meta !== "object" ||
    meta === null ||
    typeof (meta as { sha256?: unknown }).sha256 !== "string" ||
    typeof (meta as { byteLength?: unknown }).byteLength !== "number"
  ) {
    return null;
  }
  const recorded = meta as { sha256: string; byteLength: number };
  // Refused before it can be recorded, so an oversized bundle is never
  // addressable by any daemon: the daemon buffers an artifact whole to verify
  // it, and the wire schema will not carry a byteLength past this anyway.
  if (bytes.byteLength > HOST_ARTIFACT_MAX_BYTES) {
    return null;
  }
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (
    recorded.sha256 !== actualSha256 ||
    recorded.byteLength !== bytes.byteLength
  ) {
    return null;
  }
  return {
    sha256: actualSha256,
    byteLength: bytes.byteLength,
    path: bundlePath,
  };
}
