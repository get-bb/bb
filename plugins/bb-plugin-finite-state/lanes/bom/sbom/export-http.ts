import { Readable } from "node:stream";

import type { PluginHttpHandler } from "@bb/plugin-sdk";

import { RemoteError } from "../../../lib/remote/types.js";
import {
  createSbomExport,
  SbomExportError,
  type ExportDeps,
  type SbomExportArtifact,
  type SbomExportFormat,
} from "./export.js";

interface SafeHttpError {
  status: number;
  code: string;
  message: string;
  retryAfterMs: number | null;
}

function queryError(code: string, message: string): Response {
  return Response.json({ error: { code, message } }, {
    status: 400,
    headers: { "x-content-type-options": "nosniff" },
  });
}

function parseBoolean(value: string | null): boolean | null {
  if (value === null || value === "true") return true;
  if (value === "false") return false;
  return null;
}

function parseFormat(value: string | null): SbomExportFormat | null {
  return value === "cyclonedx-json" || value === "spdx" ? value : null;
}

function safeRemoteError(error: RemoteError): SafeHttpError {
  if (error.code === "REMOTE_RATE_LIMITED") {
    return {
      status: 429,
      code: error.code,
      message: "The Platform export limit was reached. Retry after the indicated delay.",
      retryAfterMs: error.retryAfterMs,
    };
  }
  if (error.code === "REMOTE_ABORTED") {
    return {
      status: 499,
      code: error.code,
      message: "The export request was cancelled.",
      retryAfterMs: null,
    };
  }
  if (error.status === 404) {
    return {
      status: 404,
      code: "SBOM_EXPORT_NOT_FOUND",
      message: "No SBOM export was found for that project version.",
      retryAfterMs: null,
    };
  }
  if (error.status === 400) {
    return {
      status: 400,
      code: "SBOM_EXPORT_REJECTED",
      message: "The Platform rejected the SBOM export request.",
      retryAfterMs: null,
    };
  }
  return {
    status: 502,
    code: "SBOM_EXPORT_UPSTREAM_FAILED",
    message: "The Platform could not provide the SBOM export.",
    retryAfterMs: error.retryAfterMs,
  };
}

function errorResponse(error: unknown): Response {
  if (error instanceof SbomExportError) {
    return queryError(error.code, error.message);
  }
  const safe = error instanceof RemoteError
    ? safeRemoteError(error)
    : {
        status: 500,
        code: "SBOM_EXPORT_FAILED",
        message: "The SBOM export could not be started.",
        retryAfterMs: null,
      };
  const headers = new Headers({ "x-content-type-options": "nosniff" });
  if (safe.retryAfterMs !== null) {
    headers.set("retry-after", String(Math.max(1, Math.ceil(safe.retryAfterMs / 1_000))));
  }
  return Response.json({
    error: {
      code: safe.code,
      message: safe.message,
      retryable: safe.status === 429 || safe.status === 502,
      retryAfterMs: safe.retryAfterMs,
    },
  }, { status: safe.status, headers });
}

function responseBody(
  artifact: SbomExportArtifact,
  abort: AbortController,
  onSettled: () => void,
): ReadableStream<Uint8Array> {
  if (!(artifact.stream instanceof Readable)) {
    throw new Error("SBOM export produced an unsupported stream");
  }
  const reader = Readable.toWeb(artifact.stream).getReader();
  let settled = false;

  const dispose = async () => {
    if (settled) return;
    settled = true;
    try {
      await artifact.dispose();
    } finally {
      onSettled();
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          controller.close();
          await dispose();
          return;
        }
        controller.enqueue(next.value);
      } catch {
        abort.abort();
        controller.error(new Error("SBOM export stream failed"));
        await dispose();
      }
    },
    async cancel(reason) {
      abort.abort();
      await reader.cancel(reason).catch(() => undefined);
      await dispose();
    },
  });
}

export function createSbomHttpHandler(deps: ExportDeps): PluginHttpHandler {
  return async (context) => {
    const url = new URL(context.req.url);
    const projectVersionId = url.searchParams.get("projectVersionId");
    const format = parseFormat(url.searchParams.get("format"));
    const includeVex = parseBoolean(url.searchParams.get("includeVex"));
    if (projectVersionId === null) {
      return queryError("SBOM_PROJECT_VERSION_INVALID", "projectVersionId is required.");
    }
    if (format === null) {
      return queryError(
        "SBOM_EXPORT_FORMAT_INVALID",
        "format must be cyclonedx-json or spdx.",
      );
    }
    if (includeVex === null) {
      return queryError("SBOM_INCLUDE_VEX_INVALID", "includeVex must be true or false.");
    }

    const abort = new AbortController();
    const disconnect = () => abort.abort();
    context.req.raw.signal.addEventListener("abort", disconnect, { once: true });
    let artifact: SbomExportArtifact;
    try {
      artifact = await createSbomExport(
        deps,
        { projectVersionId, format, includeVex },
        abort.signal,
      );
    } catch (error: unknown) {
      context.req.raw.signal.removeEventListener("abort", disconnect);
      return errorResponse(error);
    }

    let body: ReadableStream<Uint8Array>;
    try {
      body = responseBody(
        artifact,
        abort,
        () => context.req.raw.signal.removeEventListener("abort", disconnect),
      );
    } catch (error: unknown) {
      await artifact.dispose();
      context.req.raw.signal.removeEventListener("abort", disconnect);
      return errorResponse(error);
    }
    const headers = new Headers({
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="${artifact.filename}"`,
      "content-type": artifact.contentType,
      "x-content-type-options": "nosniff",
    });
    if (artifact.bytes !== null) headers.set("content-length", String(artifact.bytes));
    return new Response(body, { status: 200, headers });
  };
}
