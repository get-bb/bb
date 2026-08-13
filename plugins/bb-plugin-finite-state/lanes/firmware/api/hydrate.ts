import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { materializeRemoteArtifact } from "../../../lib/remote/artifact.js";
import type { RemoteArtifact } from "../../../lib/remote/types.js";
import { rootfsPath, stagingPath } from "../cache/layout.js";
import { normalizeVirtualPath } from "../cache/path-safety.js";
import type { FirmwareManifest, FirmwareMount, FirmwareNode } from "../cache/manifest.js";
import { isFirmwareAdminBytesForbidden, recordAdminBytesRequired } from "./admin-gate.js";
import type { ApiFallbackRequest, ApiFirmwareDeps } from "./fallback.js";
import { apiFallbackError } from "./fallback.js";

export const API_RANGE_MAX_BYTES = 131_072;

export interface FirmwarePreviewRequest {
  pvId: string;
  path: string;
  offset?: number;
  maxBytes?: number;
}

export interface FirmwarePreview {
  path: string;
  fileHash: string;
  offset: number;
  bytesReturned: number;
  hex: string;
  truncated: boolean;
}

function mountFrom(deps: ApiFirmwareDeps, manifest: FirmwareManifest): FirmwareMount {
  const meta = manifest.readMeta();
  const counts = manifest.counts();
  return {
    pvId: deps.scope.projectVersionId,
    source: "api",
    rootfsPath: rootfsPath(deps.scope.worktreeRoot, deps.scope.projectVersionId),
    manifestPath: manifest.path,
    inputSha256: null,
    artifactHash: meta?.artifactHash ?? null,
    readiness: deps.cache.readiness(manifest),
    nodeCount: counts.nodes,
    hydratedCount: counts.hydrated,
    errors: meta?.unpackErrors ?? [],
  };
}

function requestedFile(manifest: FirmwareManifest, path: string): FirmwareNode {
  const normalized = normalizeVirtualPath(path);
  const node = manifest.getNode(normalized);
  if (node === null) {
    throw apiFallbackError("FIRMWARE_PATH_NOT_FOUND", `Firmware metadata does not contain ${normalized}.`);
  }
  if (node.kind !== "file" || node.fileHash === null) {
    throw apiFallbackError(
      node.kind === "directory" ? "API_DIRECTORY_EXPANSION_REQUIRED" : "FIRMWARE_BYTES_UNAVAILABLE",
      node.kind === "directory"
        ? "Directory hydration requires an explicit reviewed file count and file list."
        : "The requested firmware node does not expose materializable file bytes.",
    );
  }
  return node;
}

async function collectPreview(artifact: RemoteArtifact, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of artifact.stream()) {
    bytes += chunk.byteLength;
    if (bytes > limit) {
      throw apiFallbackError("API_FIRMWARE_RANGE_INVALID", "Platform returned more preview bytes than requested.");
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function previewFirmwareFile(
  deps: ApiFirmwareDeps,
  request: FirmwarePreviewRequest,
  signal: AbortSignal,
): Promise<FirmwarePreview> {
  if (request.pvId !== deps.scope.projectVersionId) {
    throw apiFallbackError("INVALID_MOUNT_SCOPE", "The firmware preview does not match the verified scope.");
  }
  const offset = request.offset ?? 0;
  const maxBytes = request.maxBytes ?? 256;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > API_RANGE_MAX_BYTES) {
    throw apiFallbackError(
      "API_FIRMWARE_RANGE_INVALID",
      `Firmware previews require a non-negative offset and maxBytes from 1 through ${API_RANGE_MAX_BYTES}.`,
    );
  }
  const manifest = deps.cache.open(deps.scope);
  try {
    const node = requestedFile(manifest, request.path);
    const meta = manifest.readMeta();
    try {
      const artifact = await deps.platform.getFirmwareFile({
        projectVersionId: request.pvId,
        fileHash: node.fileHash!,
        mode: "range",
        offset,
        maxBytes,
        ...(meta?.scanId === null || meta?.scanId === undefined ? {} : { scanId: meta.scanId }),
      }, { signal });
      const bytes = await collectPreview(artifact, maxBytes);
      return {
        path: node.path,
        fileHash: node.fileHash!,
        offset,
        bytesReturned: bytes.byteLength,
        hex: bytes.toString("hex"),
        truncated: node.size === null ? bytes.byteLength === maxBytes : offset + bytes.byteLength < node.size,
      };
    } catch (error) {
      if (isFirmwareAdminBytesForbidden(error)) recordAdminBytesRequired(deps, manifest, mountFrom(deps, manifest));
      throw error;
    }
  } finally {
    manifest.close();
  }
}

async function hydrateOne(
  deps: ApiFirmwareDeps,
  manifest: FirmwareManifest,
  node: FirmwareNode,
  signal: AbortSignal,
): Promise<void> {
  if (node.materialized) return;
  const meta = manifest.readMeta();
  let artifact: RemoteArtifact;
  try {
    artifact = await deps.platform.getFirmwareFile({
      projectVersionId: deps.scope.projectVersionId,
      fileHash: node.fileHash!,
      mode: "full",
      ...(meta?.scanId === null || meta?.scanId === undefined ? {} : { scanId: meta.scanId }),
    }, { signal });
  } catch (error) {
    if (isFirmwareAdminBytesForbidden(error)) recordAdminBytesRequired(deps, manifest, mountFrom(deps, manifest));
    throw error;
  }
  if (artifact.sha256 !== null && artifact.sha256 !== node.fileHash) {
    throw apiFallbackError("BLOB_HASH_MISMATCH", "Platform artifact digest does not match firmware metadata.");
  }

  const requestStageRoot = stagingPath(deps.scope.worktreeRoot, deps.scope.projectVersionId);
  await mkdir(requestStageRoot, { recursive: true, mode: 0o700 });
  const requestStage = await mkdtemp(join(requestStageRoot, "api-request-"));
  const stagedFile = join(requestStage, randomUUID());
  try {
    await materializeRemoteArtifact(artifact, stagedFile);
    const blob = await deps.cache.putBlob(deps.scope, createReadStream(stagedFile), node.fileHash!);
    await mkdir(rootfsPath(deps.scope.worktreeRoot, deps.scope.projectVersionId), { recursive: true, mode: 0o700 });
    const materialized = { ...node, materialized: true };
    await deps.cache.linkNode(deps.scope, mountFrom(deps, manifest), materialized, blob.path);
    manifest.upsertNodes([materialized]);
    const counts = manifest.counts();
    const latestMeta = manifest.readMeta();
    if (latestMeta === null) throw apiFallbackError("MOUNT_INVALID", "Firmware manifest metadata is unavailable.");
    manifest.writeMeta({
      ...latestMeta,
      nodeCount: counts.nodes,
      hydratedCount: counts.hydrated,
      fullyMaterialized: counts.hydrated === counts.files && latestMeta.unpackErrors.length === 0,
      materializedAt: (deps.now ?? (() => new Date()))().toISOString(),
      adminBytesOk: true,
    });
    deps.cache.verifyIntegrity(manifest);
  } finally {
    await rm(requestStage, { recursive: true, force: true });
  }
}

export async function hydrateRequestedFirmwareFiles(
  deps: ApiFirmwareDeps,
  request: ApiFallbackRequest,
  manifest: FirmwareManifest,
  signal: AbortSignal,
): Promise<FirmwareMount> {
  const paths = request.paths!;
  const uniquePaths = [...new Set(paths.map(normalizeVirtualPath))];
  if (uniquePaths.length !== paths.length) {
    throw apiFallbackError("API_DUPLICATE_FILE_PATH", "Explicit firmware hydration paths must be unique.");
  }
  const nodes = uniquePaths.map((path) => requestedFile(manifest, path));
  for (const [index, node] of nodes.entries()) {
    if (signal.aborted) throw apiFallbackError("API_FIRMWARE_CANCELLED", "API firmware hydration was cancelled.");
    await hydrateOne(deps, manifest, node, signal);
    deps.publishProgress?.({ pvId: request.pvId, phase: "hydrating", done: index + 1, total: nodes.length });
  }
  const mount = mountFrom(deps, manifest);
  const meta = manifest.readMeta();
  deps.cache.commit({
    scope: deps.scope,
    manifest,
    mount,
    scanId: meta?.scanId ?? null,
    adminBytesOk: meta?.adminBytesOk ?? null,
    pulledAt: (deps.now ?? (() => new Date()))().toISOString(),
  });
  return mount;
}
