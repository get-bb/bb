import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Json } from "../../../lib/remote/types.js";
import { rootfsPath } from "../cache/layout.js";
import {
  normalizeVirtualPath,
  safeSymlinkTarget,
} from "../cache/path-safety.js";
import type {
  FirmwareManifest,
  FirmwareManifestMeta,
  FirmwareMount,
  FirmwareNode,
} from "../cache/manifest.js";
import type { ApiFallbackRequest, ApiFirmwareDeps } from "./fallback.js";
import { apiFallbackError } from "./fallback.js";

export const API_BROWSE_MAX_DEPTH = 8;
const API_BROWSE_DEPTH = 1;
const ROOT_PATH = "rootfs";

interface BrowsePage {
  entries: BrowseEntry[];
  total: number;
  scanId: string;
  artifactHash: string | null;
}

interface BrowseEntry {
  remotePath: string;
  node: FirmwareNode;
}

export interface EnumeratedFirmware {
  manifest: FirmwareManifest;
  mount: FirmwareMount;
}

function object(value: Json | undefined, field: string): Record<string, Json> {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== "object") {
    throw apiFallbackError("API_FIRMWARE_TREE_MALFORMED", `Firmware tree field ${field} is malformed.`);
  }
  return value;
}

function string(value: Json | undefined, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw apiFallbackError("API_FIRMWARE_TREE_MALFORMED", `Firmware tree field ${field} is malformed.`);
  }
  return value;
}

function nullableString(value: Json | undefined, field: string): string | null {
  if (value === null) return null;
  return string(value, field);
}

function nullableSize(value: Json | undefined): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw apiFallbackError("API_FIRMWARE_TREE_MALFORMED", "Firmware tree file size is malformed.");
  }
  return value;
}

function errors(value: Json | undefined): string[] {
  if (!Array.isArray(value)) {
    throw apiFallbackError("API_FIRMWARE_TREE_MALFORMED", "Firmware tree node errors are malformed.");
  }
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw apiFallbackError("API_FIRMWARE_TREE_MALFORMED", "Firmware tree node errors are malformed.");
    }
    result.push(item);
  }
  return result;
}

function virtualPath(remotePath: string): string | null {
  const normalizedRemote = remotePath.replace(/^\/+|\/+$/gu, "");
  if (normalizedRemote === ROOT_PATH) return null;
  if (!normalizedRemote.startsWith(`${ROOT_PATH}/`)) {
    throw apiFallbackError("API_FIRMWARE_TREE_MALFORMED", "Firmware tree returned a path outside rootfs.");
  }
  return normalizeVirtualPath(normalizedRemote.slice(ROOT_PATH.length));
}

function parseEntry(value: Json): BrowseEntry | null {
  const entry = object(value, "entry");
  const remotePath = string(entry.path, "entry.path").replace(/^\/+|\/+$/gu, "");
  const path = virtualPath(remotePath);
  if (path === null) return null;
  const kind = entry.kind;
  if (kind !== "file" && kind !== "directory" && kind !== "symlink") {
    throw apiFallbackError("API_FIRMWARE_TREE_MALFORMED", "Firmware tree node kind is malformed.");
  }
  const fileHash = nullableString(entry.hash, "entry.hash");
  if (kind === "file" && (fileHash === null || !/^[a-f0-9]{64}$/u.test(fileHash))) {
    throw apiFallbackError("API_FIRMWARE_TREE_MALFORMED", "Firmware file metadata is missing a valid hash.");
  }
  if (kind !== "file" && fileHash !== null) {
    throw apiFallbackError("API_FIRMWARE_TREE_MALFORMED", "Non-file firmware metadata unexpectedly contained a hash.");
  }
  const nodeErrors = errors(entry.errors);
  const rawTarget = nullableString(entry.linkTarget, "entry.linkTarget");
  let symlinkTarget = rawTarget;
  if (kind === "symlink") {
    if (rawTarget === null) {
      throw apiFallbackError("API_FIRMWARE_TREE_MALFORMED", "Firmware symlink metadata is missing its target.");
    } else {
      try {
        symlinkTarget = safeSymlinkTarget(path, rawTarget);
      } catch {
        // Preserve the reviewed metadata for UI inspection, but never pass this
        // non-materialized node to the native symlink writer.
        symlinkTarget = rawTarget;
        nodeErrors.push("Symlink target escapes the virtual firmware root and was not materialized.");
      }
    }
  } else if (rawTarget !== null) {
    throw apiFallbackError("API_FIRMWARE_TREE_MALFORMED", "Non-symlink firmware metadata contained a link target.");
  }
  return {
    remotePath,
    node: {
      path,
      kind,
      fileHash,
      size: nullableSize(entry.size),
      mimeType: null,
      fullType: null,
      unixMode: null,
      symlinkTarget,
      materialized: false,
      errors: nodeErrors,
    },
  };
}

function parsePage(value: Record<string, Json>): BrowsePage {
  if (!Array.isArray(value.entries)) {
    throw apiFallbackError("API_FIRMWARE_TREE_MALFORMED", "Firmware tree entries are malformed.");
  }
  if (typeof value.total !== "number" || !Number.isSafeInteger(value.total) || value.total < 0) {
    throw apiFallbackError("API_FIRMWARE_TREE_MALFORMED", "Firmware tree total is malformed.");
  }
  const scanId = string(value.scanId, "scanId");
  const artifactHash = value.artifactHash === null || value.artifactHash === undefined
    ? null
    : string(value.artifactHash, "artifactHash");
  if (artifactHash !== null && !/^[a-f0-9]{64}$/u.test(artifactHash)) {
    throw apiFallbackError("API_FIRMWARE_TREE_MALFORMED", "Firmware artifact hash is malformed.");
  }
  return {
    entries: value.entries.map(parseEntry).filter((entry): entry is BrowseEntry => entry !== null),
    total: value.total,
    scanId,
    artifactHash,
  };
}

function parentDirectories(path: string): string[] {
  const parents: string[] = [];
  let parent = dirname(path);
  while (parent !== "/" && parent !== ".") {
    parents.push(parent);
    parent = dirname(parent);
  }
  return parents.reverse();
}

function directoryNode(path: string): FirmwareNode {
  return {
    path,
    kind: "directory",
    fileHash: null,
    size: null,
    mimeType: null,
    fullType: null,
    unixMode: null,
    symlinkTarget: null,
    materialized: false,
    errors: [],
  };
}

function metadata(
  request: ApiFallbackRequest,
  nodes: ReadonlyMap<string, FirmwareNode>,
  scanId: string | null,
  artifactHash: string | null,
  unpackErrors: string[],
  stale: boolean,
  now: () => Date,
): FirmwareManifestMeta {
  return {
    pvId: request.pvId,
    scanId,
    inputSha256: null,
    source: "api",
    artifactHash,
    fullyMaterialized: false,
    materializedAt: now().toISOString(),
    nodeCount: nodes.size,
    hydratedCount: [...nodes.values()].filter((node) => node.kind === "file" && node.materialized).length,
    adminBytesOk: null,
    unpackErrors,
    stale,
  };
}

function mountFrom(
  deps: ApiFirmwareDeps,
  request: ApiFallbackRequest,
  manifest: FirmwareManifest,
  errors: string[],
): FirmwareMount {
  const counts = manifest.counts();
  return {
    pvId: request.pvId,
    source: "api",
    rootfsPath: rootfsPath(deps.scope.worktreeRoot, request.pvId),
    manifestPath: manifest.path,
    inputSha256: null,
    artifactHash: manifest.readMeta()?.artifactHash ?? null,
    readiness: deps.cache.readiness(manifest),
    nodeCount: counts.nodes,
    hydratedCount: counts.hydrated,
    errors,
  };
}

export async function enumerateFirmwareFilesystem(
  deps: ApiFirmwareDeps,
  request: ApiFallbackRequest,
  signal: AbortSignal,
): Promise<EnumeratedFirmware> {
  const now = deps.now ?? (() => new Date());
  const manifest = deps.cache.open(deps.scope);
  const oldMeta = manifest.readMeta();
  const resume = oldMeta?.source === "api" && (request.scanId === undefined || oldMeta.scanId === request.scanId);
  const nodes = new Map<string, FirmwareNode>(resume ? manifest.listNodes().map((node) => [node.path, node]) : []);
  const unpackErrors = resume ? [...(oldMeta?.unpackErrors ?? [])] : [];
  let scanId = resume ? oldMeta?.scanId ?? null : request.scanId ?? null;
  let artifactHash = resume ? oldMeta?.artifactHash ?? null : null;
  let stale = oldMeta !== null && request.scanId !== undefined && oldMeta.scanId !== request.scanId;
  if (!resume) manifest.replaceNodes([], metadata(request, nodes, scanId, artifactHash, unpackErrors, stale, now));

  const rootfs = rootfsPath(deps.scope.worktreeRoot, request.pvId);
  await mkdir(rootfs, { recursive: true, mode: 0o700 });
  const queue: Array<{ path: string; level: number }> = [{ path: ROOT_PATH, level: 0 }];
  const visited = new Set<string>();

  try {
    while (queue.length > 0) {
      if (signal.aborted) throw apiFallbackError("API_FIRMWARE_CANCELLED", "API firmware enumeration was cancelled.");
      const current = queue.shift()!;
      if (visited.has(current.path)) {
        const warning = `Repeated firmware directory was not crawled twice: ${current.path}`;
        if (!unpackErrors.includes(warning)) unpackErrors.push(warning);
        continue;
      }
      visited.add(current.path);
      const page = parsePage(await deps.platform.browseFirmwareFilesystem({
        projectVersionId: request.pvId,
        path: current.path,
        depth: API_BROWSE_DEPTH,
        ...(request.scanId === undefined ? {} : { scanId: request.scanId }),
      }, { signal }));
      if (scanId !== null && page.scanId !== scanId) {
        stale = true;
        throw apiFallbackError("API_FIRMWARE_SCAN_CHANGED", "The Platform firmware scan changed during enumeration.");
      }
      scanId = page.scanId;
      if (request.scanId !== undefined && page.scanId !== request.scanId) {
        stale = true;
        throw apiFallbackError("API_FIRMWARE_SCAN_CHANGED", "The requested Platform firmware scan is stale.");
      }
      if (artifactHash !== null && page.artifactHash !== null && page.artifactHash !== artifactHash) {
        stale = true;
        throw apiFallbackError("API_FIRMWARE_SCAN_CHANGED", "The Platform firmware artifact changed during enumeration.");
      }
      artifactHash = page.artifactHash ?? artifactHash;
      if (page.total > page.entries.length) {
        const warning = `Platform truncated the firmware tree response for ${current.path}; enumeration is resumable but incomplete.`;
        if (!unpackErrors.includes(warning)) unpackErrors.push(warning);
      }

      const pagePaths = new Set<string>();
      for (const entry of page.entries) {
        if (pagePaths.has(entry.node.path)) {
          throw apiFallbackError("API_FIRMWARE_DUPLICATE_PATH", "Platform returned a duplicate firmware path.");
        }
        pagePaths.add(entry.node.path);
        const previous = nodes.get(entry.node.path);
        if (previous && (previous.kind !== entry.node.kind || previous.fileHash !== entry.node.fileHash)) {
          throw apiFallbackError("API_FIRMWARE_DUPLICATE_PATH", "Platform returned conflicting metadata for a firmware path.");
        }
        for (const parent of parentDirectories(entry.node.path)) {
          if (!nodes.has(parent)) nodes.set(parent, directoryNode(parent));
        }
        nodes.set(entry.node.path, previous?.materialized ? previous : entry.node);
        if (entry.node.kind === "directory") {
          if (current.level + 1 >= API_BROWSE_MAX_DEPTH) {
            const warning = `Firmware crawl depth limit reached at ${entry.remotePath}.`;
            const stored = nodes.get(entry.node.path)!;
            nodes.set(entry.node.path, { ...stored, errors: [...stored.errors, warning] });
          } else if (visited.has(entry.remotePath) || queue.some((item) => item.path === entry.remotePath)) {
            const warning = `Repeated firmware directory was not crawled twice: ${entry.remotePath}`;
            if (!unpackErrors.includes(warning)) unpackErrors.push(warning);
          } else {
            queue.push({ path: entry.remotePath, level: current.level + 1 });
          }
        }
      }

      for (const node of [...nodes.values()].filter((item) => item.kind === "directory").sort((a, b) => a.path.length - b.path.length)) {
        await deps.cache.linkNode(deps.scope, mountFrom(deps, request, manifest, unpackErrors), node, "");
      }
      manifest.replaceNodes([...nodes.values()], metadata(request, nodes, scanId, artifactHash, unpackErrors, stale, now));
      deps.publishProgress?.({ pvId: request.pvId, phase: "enumerating", done: visited.size, total: visited.size + queue.length });
    }

    stale = false;
    manifest.writeMeta(metadata(request, nodes, scanId, artifactHash, unpackErrors, stale, now));
    const mount = mountFrom(deps, request, manifest, unpackErrors);
    deps.cache.commit({
      scope: deps.scope,
      manifest,
      mount,
      scanId,
      adminBytesOk: manifest.readMeta()?.adminBytesOk ?? null,
      pulledAt: now().toISOString(),
    });
    return { manifest, mount };
  } catch (error) {
    const checkpoint = metadata(request, nodes, scanId, artifactHash, unpackErrors, stale, now);
    if (manifest.readMeta() !== null) manifest.writeMeta(checkpoint);
    manifest.close();
    throw error;
  }
}
