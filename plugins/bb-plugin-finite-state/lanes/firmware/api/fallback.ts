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

export function materializeFromApi(
  deps: ApiFirmwareDeps,
  request: ApiFallbackRequest,
  signal: AbortSignal,
): Promise<FirmwareMount> {
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

export function hydrateFirmwareFile(
  deps: ApiFirmwareDeps,
  request: { pvId: string; path: string },
  signal: AbortSignal,
): Promise<FirmwareMount> {
  return materializeFromApi(deps, {
    pvId: request.pvId,
    mode: "files",
    paths: [request.path],
  }, signal);
}
