import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import {
  getMountReadiness,
  openManifest,
  type FirmwareManifestMeta,
  type FirmwareNode,
  type MountReadiness,
} from "../cache/manifest.js";
import { FirmwareCacheError, rootfsPath, validatePvId } from "../cache/layout.js";

export interface FirmwareReadinessDeps {
  worktreeRoot: string;
}

export interface FirmwareReadinessSnapshot {
  pvId: string;
  readiness: MountReadiness;
  rootfsPath: string;
  manifestGeneration: string;
  meta: FirmwareManifestMeta;
  nodes: readonly FirmwareNode[];
}

const MAX_ERROR_EXAMPLES = 5;

function generation(meta: FirmwareManifestMeta, nodes: readonly FirmwareNode[]): string {
  const canonical = {
    meta: {
      pvId: meta.pvId,
      scanId: meta.scanId,
      inputSha256: meta.inputSha256,
      source: meta.source,
      artifactHash: meta.artifactHash,
      fullyMaterialized: meta.fullyMaterialized,
      materializedAt: meta.materializedAt,
      nodeCount: meta.nodeCount,
      hydratedCount: meta.hydratedCount,
      adminBytesOk: meta.adminBytesOk,
      unpackErrors: meta.unpackErrors,
      stale: meta.stale,
    },
    nodes: nodes.map((node) => ({
      path: node.path,
      kind: node.kind,
      fileHash: node.fileHash,
      size: node.size,
      mimeType: node.mimeType,
      fullType: node.fullType,
      unixMode: node.unixMode,
      unixUid: node.unixUid ?? null,
      unixGid: node.unixGid ?? null,
      isSetuid: node.isSetuid ?? false,
      isSetgid: node.isSetgid ?? false,
      symlinkTarget: node.symlinkTarget,
      materialized: node.materialized,
      errors: node.errors,
    })),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function incompleteMessage(meta: FirmwareManifestMeta | null, nodes: readonly FirmwareNode[]): string {
  const examples = [
    ...(meta?.unpackErrors ?? []),
    ...nodes.flatMap((node) => node.errors.map((error) => `${node.path}: ${error}`)),
  ].slice(0, MAX_ERROR_EXAMPLES);
  const suffix = examples.length > 0 ? ` Examples: ${examples.join(" | ")}` : "";
  return `Firmware bytes are not fully materialized.${suffix}`;
}

export async function loadFirmwareReadiness(
  deps: FirmwareReadinessDeps,
  pvId: string,
): Promise<FirmwareReadinessSnapshot> {
  const safePvId = validatePvId(pvId);
  const manifest = openManifest(deps.worktreeRoot, safePvId);
  try {
    const readiness = getMountReadiness(manifest);
    let meta: FirmwareManifestMeta | null = null;
    let nodes: FirmwareNode[] = [];
    try {
      meta = manifest.readMeta();
      nodes = manifest.invalidReason ? [] : manifest.listNodes();
    } catch (error) {
      throw new FirmwareCacheError("MOUNT_INVALID", "The firmware sidecar is invalid.", {
        cause: error,
      });
    }

    if (readiness === "invalid") {
      throw new FirmwareCacheError("MOUNT_INVALID", "The firmware sidecar or rootfs integrity evidence is invalid.");
    }
    if (readiness === "stale") {
      throw new FirmwareCacheError("MOUNT_STALE", "The firmware sidecar is stale and must be refreshed.");
    }
    if (readiness === "missing" || meta === null) {
      throw new FirmwareCacheError("MOUNT_MISSING", "No firmware sidecar is available for this project version.");
    }
    if (readiness !== "fully_materialized") {
      throw new FirmwareCacheError("MOUNT_INCOMPLETE", incompleteMessage(meta, nodes));
    }
    if (nodes.length === 0) {
      throw new FirmwareCacheError(
        "MOUNT_INCOMPLETE",
        "An empty firmware manifest cannot be dispatched as a prepared rootfs.",
      );
    }
    if (meta.pvId !== safePvId) {
      throw new FirmwareCacheError("MOUNT_INVALID", "The firmware sidecar belongs to a different project version.");
    }

    let canonicalRootfs: string;
    try {
      canonicalRootfs = await realpath(rootfsPath(deps.worktreeRoot, safePvId));
    } catch (error) {
      throw new FirmwareCacheError("MOUNT_INCOMPLETE", "The fully-materialized rootfs directory is missing.", {
        cause: error,
      });
    }
    return Object.freeze({
      pvId: safePvId,
      readiness,
      rootfsPath: canonicalRootfs,
      manifestGeneration: generation(meta, nodes),
      meta: Object.freeze(meta),
      nodes: Object.freeze(nodes.map((node) => Object.freeze(node))),
    });
  } finally {
    manifest.close();
  }
}
