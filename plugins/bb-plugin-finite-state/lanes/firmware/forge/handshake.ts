import { computeForgeArtifactHash, type ForgeArtifactHash } from "./artifact-hash.js";
import {
  loadFirmwareReadiness,
  type FirmwareReadinessDeps,
  type FirmwareReadinessSnapshot,
} from "./readiness.js";
import { FirmwareCacheError, validatePvId } from "../cache/layout.js";

export interface PreparedFirmware {
  pvId: string;
  rootfsPath: string;
  artifactHash: string;
  manifestGeneration: string;
  fileCount: number;
  environment: Readonly<Record<string, string>>;
  preparedAt: string;
}

export interface FirmwareHandshakeDeps extends FirmwareReadinessDeps {
  now?(): Date;
}

export interface BenchProcessLaunch {
  hostId: string;
  environment: Readonly<Record<string, string>>;
  command: readonly string[];
}

export type ForgeProcessAdapter =
  | {
      kind: "plugin_owned_stdio";
      hostId: string;
      command: readonly string[];
      start(launch: BenchProcessLaunch, signal: AbortSignal): Promise<void>;
    }
  | {
      kind: "persistent";
      hostId: string;
      command: readonly string[];
      restart?: (launch: BenchProcessLaunch, signal: AbortSignal) => Promise<void>;
    }
  | {
      kind: "remote";
      reason?: string;
    };

export function firmwareEnvKey(pvId: string): string {
  return `FORGE_QEMU_FIRMWARE_${validatePvId(pvId)}`;
}

function throwChanged(message: string, cause?: unknown): never {
  throw new FirmwareCacheError("FIRMWARE_CHANGED_DURING_PREPARE", message, {
    ...(cause === undefined ? {} : { cause }),
  });
}

function verifyManifestFiles(
  snapshot: FirmwareReadinessSnapshot,
  artifact: ForgeArtifactHash,
  changedCode: boolean,
): void {
  const expected = new Map(
    snapshot.nodes
      .filter((node) => node.kind === "file")
      .map((node) => [node.path, node.fileHash]),
  );
  const actual = Object.entries(artifact.regularFileHashes);
  const mismatches: string[] = [];
  for (const [path, fileHash] of expected) {
    if (fileHash === null || artifact.regularFileHashes[path] !== fileHash) mismatches.push(path);
  }
  for (const [path] of actual) {
    if (!expected.has(path)) mismatches.push(path);
  }
  const expectedSymlinks = new Map(
    snapshot.nodes
      .filter((node) => node.kind === "symlink")
      .map((node) => [node.path, node.symlinkTarget]),
  );
  for (const [path, target] of expectedSymlinks) {
    if (target === null || artifact.symlinkTargets[path] !== target) mismatches.push(path);
  }
  for (const path of Object.keys(artifact.symlinkTargets)) {
    if (!expectedSymlinks.has(path)) mismatches.push(path);
  }
  if (mismatches.length === 0) return;
  const examples = [...new Set(mismatches)].slice(0, 5).join(", ");
  if (changedCode) {
    throwChanged(`Firmware bytes no longer match the prepared manifest. Examples: ${examples}`);
  }
  throw new FirmwareCacheError(
    "MOUNT_INCOMPLETE",
    `Every regular file must have verified manifest bytes. Examples: ${examples}`,
  );
}

function sealPreparedFirmware(value: PreparedFirmware): PreparedFirmware {
  Object.freeze(value.environment);
  Object.defineProperty(value, "rootfsPath", { enumerable: false });
  Object.defineProperty(value, "environment", { enumerable: false });
  return Object.freeze(value);
}

export async function prepareFirmwareForBench(
  deps: FirmwareHandshakeDeps,
  pvId: string,
  signal: AbortSignal,
): Promise<PreparedFirmware> {
  signal.throwIfAborted();
  const snapshot = await loadFirmwareReadiness(deps, pvId);
  const artifact = await computeForgeArtifactHash(snapshot.rootfsPath, signal);
  verifyManifestFiles(snapshot, artifact, false);

  const after = await loadFirmwareReadiness(deps, pvId);
  if (
    after.manifestGeneration !== snapshot.manifestGeneration ||
    after.rootfsPath !== snapshot.rootfsPath
  ) {
    throwChanged("The firmware manifest generation changed during preparation.");
  }

  const environment = { [firmwareEnvKey(pvId)]: snapshot.rootfsPath };
  return sealPreparedFirmware({
    pvId: snapshot.pvId,
    rootfsPath: snapshot.rootfsPath,
    artifactHash: artifact.artifactHash,
    manifestGeneration: snapshot.manifestGeneration,
    fileCount: artifact.fileCount,
    environment,
    preparedAt: (deps.now?.() ?? new Date()).toISOString(),
  });
}

export async function assertPreparationCurrent(
  deps: FirmwareHandshakeDeps,
  prepared: PreparedFirmware,
): Promise<void> {
  let snapshot: FirmwareReadinessSnapshot;
  try {
    snapshot = await loadFirmwareReadiness(deps, prepared.pvId);
  } catch (error) {
    throwChanged("The firmware mount is no longer dispatch-ready.", error);
  }
  if (
    snapshot.manifestGeneration !== prepared.manifestGeneration ||
    snapshot.rootfsPath !== prepared.rootfsPath
  ) {
    throwChanged("The firmware manifest generation changed after preparation.");
  }

  let artifact: ForgeArtifactHash;
  try {
    artifact = await computeForgeArtifactHash(snapshot.rootfsPath);
    verifyManifestFiles(snapshot, artifact, true);
  } catch (error) {
    if (error instanceof FirmwareCacheError && error.code === "FIRMWARE_CHANGED_DURING_PREPARE") throw error;
    throwChanged("The firmware root changed after preparation.", error);
  }
  if (artifact.artifactHash !== prepared.artifactHash || artifact.fileCount !== prepared.fileCount) {
    throwChanged("The Forge firmware artifact hash changed after preparation.");
  }
}

function benchLaunch(
  hostId: string,
  command: readonly string[],
  prepared: PreparedFirmware,
): BenchProcessLaunch {
  return Object.freeze({
    hostId,
    environment: prepared.environment,
    command: Object.freeze([...command]),
  });
}

export async function startForgeWithPreparedFirmware(
  adapter: ForgeProcessAdapter,
  prepared: PreparedFirmware,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  if (adapter.kind === "remote") {
    throw new FirmwareCacheError(
      "FIRMWARE_REGISTRATION_UNAVAILABLE",
      adapter.reason ?? "Remote Forge has no secure firmware transfer or root-registration method.",
    );
  }
  const launch = benchLaunch(adapter.hostId, adapter.command, prepared);
  if (adapter.kind === "plugin_owned_stdio") {
    await adapter.start(launch, signal);
    return;
  }
  if (!adapter.restart) {
    throw new FirmwareCacheError(
      "FIRMWARE_REGISTRATION_UNAVAILABLE",
      "Persistent Forge must expose a verified restart/reconnect seam before firmware can be registered.",
    );
  }
  await adapter.restart(launch, signal);
}
