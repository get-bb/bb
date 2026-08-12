import { createHash, randomUUID } from "node:crypto";
import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { createReadStream } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FirmwareExecutionScope } from "../cache/blob-store.js";
import {
  assertFirmwareCacheIgnored,
  FirmwareCacheError,
  manifestPath,
  rootfsPath,
  stagingPath,
  validatePvId,
} from "../cache/layout.js";
import type { FirmwareMount } from "../cache/manifest.js";
import { ingestSnapshotGeneration, type UnpackCache } from "./ingest.js";
import {
  BoundedDiagnosticBuffer,
  parseWrapperProgress,
  publishFirmwareProgress,
  redactHostPaths,
  type FirmwareProgressPublisher,
} from "./progress.js";
import { parseSnapshot, validateMaxDepth } from "./snapshot-schema.js";

const MAX_DIAGNOSTIC_BYTES = 32 * 1024;
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;
const FAILED_STAGE_RETENTION = 3;

type SpawnFunction = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface LocalUnpackRequest {
  pvId: string;
  firmwarePath: string;
  scanId?: string;
  maxDepth?: number;
  force?: boolean;
}

export interface LocalUnpackResult {
  mount: FirmwareMount;
  reused: boolean;
  snapshotPath: string;
  warnings: string[];
}

export interface StandaloneUnpackWrapperConfig {
  executablePath: string;
  factImage: string;
  argvPrefix?: readonly string[];
  timeoutMs?: number;
}

export interface UnpackDeps {
  scope: FirmwareExecutionScope;
  cache: UnpackCache;
  wrapper: StandaloneUnpackWrapperConfig;
  publishProgress?: FirmwareProgressPublisher;
  isExplicitlySelected?: (canonicalPath: string) => boolean | Promise<boolean>;
  markCurrentMountStale?: (
    scope: FirmwareExecutionScope,
    inputSha256: string,
  ) => void | Promise<void>;
  now?: () => Date;
  createGenerationId?: () => string;
  spawnProcess?: SpawnFunction;
}

function isContained(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return (
    rel === "" ||
    (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
  );
}

async function preflightInput(
  deps: UnpackDeps,
  request: LocalUnpackRequest,
): Promise<{ path: string; size: number }> {
  const canonicalWorktree = assertFirmwareCacheIgnored(deps.scope.worktreeRoot);
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(request.firmwarePath);
    const file = await lstat(canonicalPath);
    if (!file.isFile() || file.isSymbolicLink())
      throw new Error("not a regular file");
    await access(canonicalPath, constants.R_OK);
    const allowed =
      isContained(canonicalWorktree, canonicalPath) ||
      (await deps.isExplicitlySelected?.(canonicalPath)) === true;
    if (!allowed) {
      throw new FirmwareCacheError(
        "FIRMWARE_INPUT_NOT_ALLOWED",
        "The firmware image is outside the active worktree and was not explicitly selected.",
      );
    }
    return { path: canonicalPath, size: file.size };
  } catch (error) {
    if (error instanceof FirmwareCacheError) throw error;
    throw new FirmwareCacheError(
      "FIRMWARE_INPUT_INVALID",
      "The firmware image must be a readable regular file.",
      { cause: error },
    );
  }
}

async function hashInput(
  path: string,
  size: number,
  pvId: string,
  publish: FirmwareProgressPublisher | undefined,
  signal: AbortSignal,
): Promise<string> {
  const hash = createHash("sha256");
  let done = 0;
  publishFirmwareProgress(publish, pvId, "hashing", 0, size);
  try {
    await pipeline(
      createReadStream(path, { signal }),
      new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          hash.update(chunk);
          done += chunk.length;
          publishFirmwareProgress(publish, pvId, "hashing", done, size);
          callback();
        },
      }),
    );
  } catch (error) {
    if (signal.aborted) {
      throw new FirmwareCacheError(
        "UNPACK_CANCELLED",
        "Standalone unpack was cancelled.",
        { cause: error },
      );
    }
    throw error;
  }
  return hash.digest("hex");
}

async function assertWrapper(
  config: StandaloneUnpackWrapperConfig,
): Promise<string> {
  if (!isAbsolute(config.executablePath)) {
    throw new FirmwareCacheError(
      "UNPACK_WRAPPER_UNAVAILABLE",
      "The standalone unpack wrapper must be configured with an absolute executable path.",
    );
  }
  const factImage = config.factImage;
  if (factImage.trim().length === 0) {
    throw new FirmwareCacheError(
      "UNPACK_IMAGE_UNAVAILABLE",
      "The FACT extractor image must be configured for standalone unpack.",
    );
  }
  try {
    const wrapper = await lstat(config.executablePath);
    if (!wrapper.isFile() || wrapper.isSymbolicLink())
      throw new Error("not a regular file");
    await access(config.executablePath, constants.X_OK);
  } catch (error) {
    throw new FirmwareCacheError(
      "UNPACK_WRAPPER_UNAVAILABLE",
      "The configured standalone unpack wrapper is missing or not executable.",
      { cause: error },
    );
  }
  return factImage;
}

interface WrapperResult {
  stdout: string;
  stderr: string;
}

async function launchWrapper(
  deps: UnpackDeps,
  inputPath: string,
  extractedRootfs: string,
  snapshotPath: string,
  maxDepth: number,
  signal: AbortSignal,
): Promise<WrapperResult> {
  const factImage = await assertWrapper(deps.wrapper);
  const argv = standaloneUnpackArgv(
    deps.wrapper,
    inputPath,
    extractedRootfs,
    snapshotPath,
    maxDepth,
  );
  const paths = [
    deps.scope.worktreeRoot,
    inputPath,
    extractedRootfs,
    snapshotPath,
    deps.wrapper.executablePath,
  ];
  const stdout = new BoundedDiagnosticBuffer(MAX_DIAGNOSTIC_BYTES, paths);
  const stderr = new BoundedDiagnosticBuffer(MAX_DIAGNOSTIC_BYTES, paths);
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  const timeoutMs = deps.wrapper.timeoutMs ?? 30 * 60 * 1000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new FirmwareCacheError(
      "INVALID_UNPACK_TIMEOUT",
      "Standalone unpack timeout must be positive.",
    );
  }
  const timeout = setTimeout(
    () =>
      controller.abort(
        new FirmwareCacheError(
          "UNPACK_TIMEOUT",
          "Standalone unpack timed out.",
        ),
      ),
    timeoutMs,
  );

  try {
    const child = (deps.spawnProcess ?? spawn)(
      deps.wrapper.executablePath,
      argv,
      {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        signal: controller.signal,
        env: { ...process.env, FACT_UNPACK_IMAGE: factImage },
      },
    );
    child.stdout?.on("data", (chunk: Buffer) => {
      const parsed = parseWrapperProgress(stdout.append(chunk));
      if (parsed) {
        publishFirmwareProgress(
          deps.publishProgress,
          deps.scope.projectVersionId,
          "unpacking",
          parsed.done,
          parsed.total,
        );
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => stderr.append(chunk));
    const outcome = await new Promise<{
      code: number | null;
      spawnError: Error | null;
    }>((resolveResult) => {
      let spawnError: Error | null = null;
      child.once("error", (error) => {
        spawnError = error;
      });
      child.once("close", (code) => resolveResult({ code, spawnError }));
    });
    if (controller.signal.aborted) {
      const reason = controller.signal.reason;
      if (reason instanceof FirmwareCacheError) throw reason;
      throw new FirmwareCacheError(
        "UNPACK_CANCELLED",
        "Standalone unpack was cancelled.",
      );
    }
    if (outcome.spawnError) {
      throw new FirmwareCacheError(
        "UNPACK_WRAPPER_FAILED",
        "The standalone unpack wrapper could not be started.",
        { cause: outcome.spawnError },
      );
    }
    if (outcome.code !== 0) {
      const detail =
        stderr.value().trim() ||
        stdout.value().trim() ||
        "no diagnostic output";
      throw new FirmwareCacheError(
        "UNPACK_WRAPPER_FAILED",
        `Standalone unpack exited with code ${outcome.code ?? "unknown"}: ${detail}`,
      );
    }
    return { stdout: stdout.value(), stderr: stderr.value() };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

async function readSnapshot(path: string): Promise<unknown> {
  const snapshotStat = await lstat(path);
  if (
    !snapshotStat.isFile() ||
    snapshotStat.isSymbolicLink() ||
    snapshotStat.size > MAX_SNAPSHOT_BYTES
  ) {
    throw new FirmwareCacheError(
      "INVALID_UNPACK_SNAPSHOT",
      "snapshot.json is missing, not a regular file, or exceeds the safety limit.",
    );
  }
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new FirmwareCacheError(
      "INVALID_UNPACK_SNAPSHOT",
      "snapshot.json is not valid JSON.",
      {
        cause: error,
      },
    );
  }
}

function redactJson(value: unknown, paths: readonly string[]): unknown {
  if (typeof value === "string") return redactHostPaths(value, paths);
  if (Array.isArray(value)) return value.map((item) => redactJson(item, paths));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        redactJson(item, paths),
      ]),
    );
  }
  return value;
}

async function persistRedactedSnapshot(
  path: string,
  snapshot: ReturnType<typeof parseSnapshot>,
  paths: readonly string[],
): Promise<void> {
  const unpackMetadata = Object.fromEntries(
    Object.entries(snapshot.unpackMetadata).map(([hash, metadata]) => [
      hash,
      {
        tried: metadata.tried.map((value) => redactHostPaths(value, paths)),
        ...(metadata.triedVersion === undefined
          ? {}
          : { tried_version: redactHostPaths(metadata.triedVersion, paths) }),
        ...(metadata.used === undefined
          ? {}
          : { used: redactHostPaths(metadata.used, paths) }),
        ...(metadata.usedVersion === undefined
          ? {}
          : { used_version: redactHostPaths(metadata.usedVersion, paths) }),
        ...(metadata.errorType === undefined
          ? {}
          : { error_type: redactHostPaths(metadata.errorType, paths) }),
        ...(metadata.errorMsg === undefined
          ? {}
          : { error_msg: redactHostPaths(metadata.errorMsg, paths) }),
      },
    ]),
  );
  await writeFile(
    path,
    JSON.stringify({
      input_file: basename(snapshot.inputFile),
      input_sha256: snapshot.inputSha256,
      file_tree: snapshot.fileTree.map((entry) => ({
        file_path: entry.filePath,
        file_hash: entry.fileHash,
        file_name: entry.fileName,
        mime_type: entry.mimeType,
        full_type: entry.fullType,
        file_size: entry.fileSize,
      })),
      unpack_metadata: unpackMetadata,
      errors: redactJson(snapshot.errors, paths),
    }),
    { encoding: "utf8", mode: 0o600 },
  );
}

async function retainFailureDiagnostic(
  stage: string,
  pvId: string,
  error: unknown,
  paths: readonly string[],
  now: Date,
): Promise<void> {
  const message = redactHostPaths(
    error instanceof Error ? error.message : String(error),
    paths,
  );
  const diagnostic = JSON.stringify(
    {
      pvId,
      failedAt: now.toISOString(),
      code: error instanceof FirmwareCacheError ? error.code : "UNPACK_FAILED",
      message: Buffer.from(message)
        .subarray(0, MAX_DIAGNOSTIC_BYTES)
        .toString(),
    },
    null,
    2,
  );
  await mkdir(stage, { recursive: true, mode: 0o700 });
  await writeFile(`${stage}/diagnostic.json`, diagnostic, {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function pruneFailedStages(parent: string, keep: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(parent, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const candidates = await Promise.all(
    entries
      .filter(
        (entry) => entry.isDirectory() && resolve(parent, entry.name) !== keep,
      )
      .map(async (entry) => ({
        path: resolve(parent, entry.name),
        mtimeMs: (await stat(resolve(parent, entry.name))).mtimeMs,
      })),
  );
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  await Promise.all(
    candidates
      .slice(Math.max(0, FAILED_STAGE_RETENTION - 1))
      .map((entry) => rm(entry.path, { recursive: true, force: true })),
  );
}

async function tryReuse(
  deps: UnpackDeps,
  request: LocalUnpackRequest,
  digest: string,
): Promise<LocalUnpackResult | null> {
  if (request.force) return null;
  try {
    await access(manifestPath(deps.scope.worktreeRoot, request.pvId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const manifest = deps.cache.open(deps.scope);
  try {
    const meta = manifest.readMeta();
    if (
      !meta ||
      meta.inputSha256 !== digest ||
      meta.source !== "standalone_unpack"
    )
      return null;
    deps.cache.verifyIntegrity(manifest);
    const readiness = deps.cache.readiness(manifest);
    if (
      readiness === "invalid" ||
      readiness === "missing" ||
      readiness === "stale"
    )
      return null;
    const mount: FirmwareMount = {
      pvId: request.pvId,
      source: "standalone_unpack",
      rootfsPath: rootfsPath(deps.scope.worktreeRoot, request.pvId),
      manifestPath: manifest.path,
      inputSha256: digest,
      artifactHash: meta.artifactHash,
      readiness,
      nodeCount: meta.nodeCount,
      hydratedCount: meta.hydratedCount,
      errors: meta.unpackErrors,
    };
    return {
      mount,
      reused: true,
      snapshotPath: join(dirname(manifest.path), "snapshot.json"),
      warnings: meta.unpackErrors,
    };
  } finally {
    manifest.close();
  }
}

async function markExistingManifestStale(
  deps: UnpackDeps,
  request: LocalUnpackRequest,
  digest: string,
): Promise<void> {
  try {
    await access(manifestPath(deps.scope.worktreeRoot, request.pvId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const manifest = deps.cache.open(deps.scope);
  try {
    const meta = manifest.readMeta();
    if (meta && meta.inputSha256 !== digest && !meta.stale) {
      manifest.writeMeta({ ...meta, stale: true });
    }
  } finally {
    manifest.close();
  }
}

export function standaloneUnpackArgv(
  config: StandaloneUnpackWrapperConfig,
  inputPath: string,
  outputDirectory: string,
  snapshotPath: string,
  maxDepth: number,
): readonly string[] {
  return [
    ...(config.argvPrefix ?? []),
    inputPath,
    "-d",
    outputDirectory,
    "-o",
    snapshotPath,
    "--max-depth",
    String(maxDepth),
    "--quiet",
  ];
}

export function runStandaloneUnpack(_registrationInput: unknown): never;
export function runStandaloneUnpack(
  deps: UnpackDeps,
  request: LocalUnpackRequest,
  signal: AbortSignal,
): Promise<LocalUnpackResult>;
export function runStandaloneUnpack(
  first: UnpackDeps | unknown,
  request?: LocalUnpackRequest,
  signal?: AbortSignal,
): Promise<LocalUnpackResult> | never {
  if (request === undefined || signal === undefined) {
    throw new FirmwareCacheError(
      "UNPACK_CONFIGURATION_REQUIRED",
      "Standalone unpack requires the configured wrapper, FACT image, and verified execution scope.",
    );
  }
  const deps = first as UnpackDeps;
  return runConfiguredStandaloneUnpack(deps, request, signal);
}

async function runConfiguredStandaloneUnpack(
  deps: UnpackDeps,
  request: LocalUnpackRequest,
  signal: AbortSignal,
): Promise<LocalUnpackResult> {
  if (request.pvId !== deps.scope.projectVersionId) {
    throw new FirmwareCacheError(
      "INVALID_MOUNT_SCOPE",
      "Unpack request and execution scope do not match.",
    );
  }
  const now = deps.now ?? (() => new Date());
  const generationId = validatePvId((deps.createGenerationId ?? randomUUID)());
  const maxDepth = validateMaxDepth(request.maxDepth);
  const input = await preflightInput(deps, request);
  const digest = await hashInput(
    input.path,
    input.size,
    request.pvId,
    deps.publishProgress,
    signal,
  );
  const reused = await tryReuse(deps, request, digest);
  if (reused) {
    publishFirmwareProgress(
      deps.publishProgress,
      request.pvId,
      "complete",
      1,
      1,
    );
    return reused;
  }
  await markExistingManifestStale(deps, request, digest);
  await deps.markCurrentMountStale?.(deps.scope, digest);

  const stageParent = stagingPath(deps.scope.worktreeRoot, request.pvId);
  const stage = resolve(stageParent, generationId);
  const extractedRootfs = resolve(stage, "rootfs");
  const snapshotPath = resolve(stage, "snapshot.json");
  await mkdir(stageParent, { recursive: true, mode: 0o700 });
  try {
    await mkdir(stage, { mode: 0o700 });
  } catch (error) {
    throw new FirmwareCacheError(
      "UNPACK_STAGING_COLLISION",
      "A unique standalone unpack staging generation could not be created.",
      { cause: error },
    );
  }
  await mkdir(extractedRootfs, { mode: 0o700 });
  publishFirmwareProgress(
    deps.publishProgress,
    request.pvId,
    "unpacking",
    0,
    0,
  );
  try {
    await launchWrapper(
      deps,
      input.path,
      extractedRootfs,
      snapshotPath,
      maxDepth,
      signal,
    );
    publishFirmwareProgress(
      deps.publishProgress,
      request.pvId,
      "validating",
      0,
      1,
    );
    const snapshot = parseSnapshot(await readSnapshot(snapshotPath), digest);
    if (basename(snapshot.inputFile) !== basename(input.path)) {
      throw new FirmwareCacheError(
        "INVALID_UNPACK_SNAPSHOT",
        "snapshot.json identifies a different input file.",
      );
    }
    const extractedStat = await lstat(extractedRootfs);
    if (
      !extractedStat.isDirectory() ||
      extractedStat.isSymbolicLink() ||
      (await realpath(extractedRootfs)) !== extractedRootfs
    ) {
      throw new FirmwareCacheError(
        "UNSAFE_UNPACK_OUTPUT",
        "The wrapper replaced the staged rootfs with an unsafe filesystem object.",
      );
    }
    await persistRedactedSnapshot(snapshotPath, snapshot, [
      deps.scope.worktreeRoot,
      input.path,
      stage,
      deps.wrapper.executablePath,
    ]);
    publishFirmwareProgress(
      deps.publishProgress,
      request.pvId,
      "validating",
      1,
      1,
    );
    publishFirmwareProgress(
      deps.publishProgress,
      request.pvId,
      "ingesting",
      0,
      snapshot.fileTree.length,
    );
    const result = await ingestSnapshotGeneration({
      scope: deps.scope,
      cache: deps.cache,
      snapshot,
      extractedRootfs,
      stagedSnapshotPath: snapshotPath,
      scanId: request.scanId ?? null,
      publishProgress: deps.publishProgress,
      now,
      promotionId: generationId,
    });
    await rm(stage, { recursive: true, force: true }).catch(() => undefined);
    publishFirmwareProgress(
      deps.publishProgress,
      request.pvId,
      "complete",
      1,
      1,
    );
    return {
      mount: result.mount,
      reused: false,
      snapshotPath: result.snapshotPath,
      warnings: result.warnings,
    };
  } catch (error) {
    await retainFailureDiagnostic(
      stage,
      request.pvId,
      error,
      [deps.scope.worktreeRoot, input.path, stage, deps.wrapper.executablePath],
      now(),
    );
    await pruneFailedStages(stageParent, stage);
    throw error;
  }
}
