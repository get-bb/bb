import { Readable } from "node:stream";

import {
  RemoteError,
  type PlatformClient,
} from "../../../lib/remote/types.js";

export type SbomExportFormat = "cyclonedx-json" | "spdx";

export interface SbomExportRequest {
  projectVersionId: string;
  format: SbomExportFormat;
  includeVex: boolean;
}

export interface SbomExportArtifact {
  filename: string;
  contentType: string;
  bytes: number | null;
  stream: NodeJS.ReadableStream;
  dispose(): Promise<void>;
}

export interface ExportDeps {
  platform: Pick<PlatformClient, "downloadSbom">;
}

export type SbomExportErrorCode =
  | "SBOM_PROJECT_VERSION_INVALID"
  | "SBOM_EXPORT_FORMAT_INVALID"
  | "SBOM_INCLUDE_VEX_INVALID";

export class SbomExportError extends Error {
  readonly code: SbomExportErrorCode;

  constructor(code: SbomExportErrorCode, message: string) {
    super(message);
    this.name = "SbomExportError";
    this.code = code;
  }
}

function validateRequest(request: SbomExportRequest): SbomExportRequest {
  if (
    typeof request.projectVersionId !== "string" ||
    request.projectVersionId.length === 0 ||
    request.projectVersionId.length > 512 ||
    request.projectVersionId !== request.projectVersionId.trim() ||
    /[\u0000-\u001f\u007f]/u.test(request.projectVersionId)
  ) {
    throw new SbomExportError(
      "SBOM_PROJECT_VERSION_INVALID",
      "A valid project version id is required.",
    );
  }
  if (request.format !== "cyclonedx-json" && request.format !== "spdx") {
    throw new SbomExportError(
      "SBOM_EXPORT_FORMAT_INVALID",
      "SBOM format must be cyclonedx-json or spdx.",
    );
  }
  if (typeof request.includeVex !== "boolean") {
    throw new SbomExportError(
      "SBOM_INCLUDE_VEX_INVALID",
      "includeVex must be true or false.",
    );
  }
  return request;
}

function filenameFor(format: SbomExportFormat): string {
  return format === "cyclonedx-json"
    ? "finite-state-sbom.cdx.json"
    : "finite-state-sbom.spdx.json";
}

/**
 * Adapts the frozen, path-free Platform artifact without inspecting or
 * reserializing its bytes. The caller owns disposal of the returned stream.
 */
export async function createSbomExport(
  deps: ExportDeps,
  request: SbomExportRequest,
  signal: AbortSignal,
): Promise<SbomExportArtifact> {
  const validated = validateRequest(request);
  if (signal.aborted) {
    throw new RemoteError("Remote operation was aborted", {
      service: "platform",
      code: "REMOTE_ABORTED",
      status: null,
      retryable: false,
      retryAfterMs: null,
      details: null,
    });
  }

  const upstream = await deps.platform.downloadSbom(
    {
      projectVersionId: validated.projectVersionId,
      format: validated.format === "cyclonedx-json" ? "cyclonedx" : "spdx",
      includeVex: validated.includeVex,
    },
    { signal },
  );
  const stream = Readable.from(upstream.stream(), { objectMode: false });
  let disposed = false;

  const abort = () => stream.destroy();
  signal.addEventListener("abort", abort, { once: true });

  return {
    filename: filenameFor(validated.format),
    contentType: upstream.mediaType,
    bytes: upstream.size,
    stream,
    async dispose() {
      if (disposed) return;
      disposed = true;
      signal.removeEventListener("abort", abort);
      stream.destroy();
      if (!stream.closed) {
        await new Promise<void>((resolve) => stream.once("close", resolve));
      }
    },
  };
}
