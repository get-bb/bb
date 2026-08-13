import type { PlatformClient } from "../../../lib/remote/types.js";
import { FirmwareCacheError } from "../cache/layout.js";
import type { FirmwareExecutionScope } from "../cache/blob-store.js";
import type { FirmwareMount } from "../cache/manifest.js";
import type { FirmwareCacheService } from "../register.js";
import { enumerateFirmwareFilesystem } from "./enumerate.js";
import { hydrateRequestedFirmwareFiles } from "./hydrate.js";

export const API_EXPLICIT_PATH_LIMIT = 100;

export interface ApiFallbackRequest {
  pvId: string;
  scanId?: string;
  mode: "metadata" | "files";
  paths?: string[];
}

export interface ApiFirmwareProgress {
  pvId: string;
  phase: "enumerating" | "hydrating";
  done: number;
  total: number;
}

export interface ApiFirmwareDeps {
  platform: Pick<PlatformClient, "browseFirmwareFilesystem" | "getFirmwareFile">;
  scope: FirmwareExecutionScope;
  cache: FirmwareCacheService;
  now?: () => Date;
  publishProgress?: (progress: ApiFirmwareProgress) => void;
}

export function apiFallbackError(code: string, message: string, cause?: unknown): FirmwareCacheError {
  return new FirmwareCacheError(code, message, cause === undefined ? undefined : { cause });
}

function isApiFirmwareDeps(value: unknown): value is ApiFirmwareDeps {
  return value !== null && typeof value === "object" &&
    "platform" in value && value.platform !== null && typeof value.platform === "object" &&
    "browseFirmwareFilesystem" in value.platform && typeof value.platform.browseFirmwareFilesystem === "function" &&
    "getFirmwareFile" in value.platform && typeof value.platform.getFirmwareFile === "function" &&
    "scope" in value && value.scope !== null && typeof value.scope === "object" &&
    "worktreeRoot" in value.scope && typeof value.scope.worktreeRoot === "string" &&
    "projectId" in value.scope && typeof value.scope.projectId === "string" &&
    "projectVersionId" in value.scope && typeof value.scope.projectVersionId === "string" &&
    "generationId" in value.scope && typeof value.scope.generationId === "string" &&
    "cache" in value && value.cache !== null && typeof value.cache === "object" &&
    "open" in value.cache && typeof value.cache.open === "function" &&
    "putBlob" in value.cache && typeof value.cache.putBlob === "function" &&
    "linkNode" in value.cache && typeof value.cache.linkNode === "function" &&
    "commit" in value.cache && typeof value.cache.commit === "function" &&
    "readiness" in value.cache && typeof value.cache.readiness === "function" &&
    "verifyIntegrity" in value.cache && typeof value.cache.verifyIntegrity === "function" &&
    (!("now" in value) || value.now === undefined || typeof value.now === "function") &&
    (!("publishProgress" in value) || value.publishProgress === undefined || typeof value.publishProgress === "function");
}

function assertRequest(deps: ApiFirmwareDeps, request: ApiFallbackRequest): void {
  if (request.pvId !== deps.scope.projectVersionId) {
    throw apiFallbackError(
      "INVALID_MOUNT_SCOPE",
      "The API fallback request does not match the verified project-version scope.",
    );
  }
  if (request.mode === "metadata" && request.paths !== undefined) {
    throw apiFallbackError(
      "API_METADATA_PATHS_UNSUPPORTED",
      "Metadata fallback crawls the verified filesystem tree and does not accept ignored file paths.",
    );
  }
  if (request.mode === "files" && (!request.paths || request.paths.length === 0)) {
    throw apiFallbackError(
      "API_FULL_MATERIALIZATION_UNSUPPORTED",
      "API fallback cannot hydrate a complete rootfs through per-file calls. Use local standalone unpack with the firmware image.",
    );
  }
  if ((request.paths?.length ?? 0) > API_EXPLICIT_PATH_LIMIT) {
    throw apiFallbackError(
      "API_EXPLICIT_PATH_LIMIT_EXCEEDED",
      `API fallback accepts at most ${API_EXPLICIT_PATH_LIMIT} explicit files per action.`,
    );
  }
}

export async function materializeFromApi(
  deps: ApiFirmwareDeps,
  request: ApiFallbackRequest,
  signal: AbortSignal,
): Promise<FirmwareMount>;
/** WP-51 owns wiring the frozen RPC action to verified scope, client, and cache dependencies. */
export function materializeFromApi(input: unknown): never;
export function materializeFromApi(
  depsOrInput: ApiFirmwareDeps | unknown,
  request?: ApiFallbackRequest,
  signal?: AbortSignal,
): Promise<FirmwareMount> | never {
  if (request === undefined || signal === undefined) {
    throw apiFallbackError(
      "API_FALLBACK_CONFIGURATION_REQUIRED",
      "API firmware fallback requires an explicit verified client and firmware execution scope.",
    );
  }
  if (!isApiFirmwareDeps(depsOrInput)) {
    throw apiFallbackError(
      "API_FALLBACK_CONFIGURATION_REQUIRED",
      "API firmware fallback dependencies are malformed.",
    );
  }
  const deps = depsOrInput;
  assertRequest(deps, request);
  return materializeFromApiImpl(deps, request, signal);
}

async function materializeFromApiImpl(
  deps: ApiFirmwareDeps,
  request: ApiFallbackRequest,
  signal: AbortSignal,
): Promise<FirmwareMount> {
  const enumerated = await enumerateFirmwareFilesystem(deps, request, signal);
  try {
    if (request.mode === "metadata") return enumerated.mount;
    return await hydrateRequestedFirmwareFiles(deps, request, enumerated.manifest, signal);
  } finally {
    enumerated.manifest.close();
  }
}

/** Compatibility seam for the frozen RPC handler; WP-51 supplies its dependencies. */
export function hydrateFirmwareFile(_input: unknown): never {
  throw apiFallbackError(
    "API_FALLBACK_CONFIGURATION_REQUIRED",
    "API firmware hydration requires an explicit verified client and firmware execution scope.",
  );
}
