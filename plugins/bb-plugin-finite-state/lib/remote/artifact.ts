import { createWriteStream } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import { once } from "node:events";

import {
  createRemoteArtifact,
  RemoteError,
  type RemoteArtifact,
  type RemoteService,
} from "./types.js";

function contentLength(response: Response): number | null {
  const value = response.headers.get("content-length");
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function digest(response: Response): string | null {
  const value = response.headers.get("x-content-sha256")?.toLowerCase() ?? null;
  if (value !== null && /^[0-9a-f]{64}$/u.test(value)) return value;
  const standard = /(?:^|,)\s*sha-256\s*=\s*([A-Za-z0-9+/]{43}=)(?=\s*(?:,|$))/iu.exec(
    response.headers.get("digest") ?? "",
  );
  if (standard === null) return null;
  return Buffer.from(standard[1], "base64").toString("hex");
}

export function artifactFromResponse(input: {
  service: RemoteService;
  response: Response;
  allowedMediaTypes: readonly string[];
}): RemoteArtifact {
  const mediaType =
    input.response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ??
    "application/octet-stream";
  if (!input.allowedMediaTypes.includes(mediaType)) {
    throw new RemoteError("Remote artifact had an unexpected media type", {
      service: input.service,
      code: "REMOTE_ARTIFACT_MEDIA_TYPE",
      status: input.response.status,
      retryable: false,
      retryAfterMs: null,
      details: { mediaType },
    });
  }
  const body = input.response.body;
  if (body === null) {
    throw new RemoteError("Remote artifact response had no body", {
      service: input.service,
      code: "REMOTE_ARTIFACT_EMPTY",
      status: input.response.status,
      retryable: false,
      retryAfterMs: null,
      details: null,
    });
  }
  return createRemoteArtifact({
    service: input.service,
    mediaType,
    size: contentLength(input.response),
    sha256: digest(input.response),
    async *stream() {
      const reader = body.getReader();
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) return;
          yield next.value;
        }
      } catch {
        throw new RemoteError("Remote artifact stream ended unexpectedly", {
          service: input.service,
          code: "REMOTE_ARTIFACT_STREAM_ERROR",
          status: input.response.status,
          retryable: false,
          retryAfterMs: null,
          details: null,
        });
      } finally {
        reader.releaseLock();
      }
    },
  });
}

/** Writes through a sibling `.part` file and promotes only a fully validated stream. */
export async function materializeRemoteArtifact(
  artifact: RemoteArtifact,
  targetPath: string,
): Promise<void> {
  const partPath = `${targetPath}.part`;
  const output = createWriteStream(partPath, { flags: "wx" });
  try {
    for await (const chunk of artifact.stream()) {
      if (!output.write(chunk)) await once(output, "drain");
    }
    output.end();
    await once(output, "close");
    await rename(partPath, targetPath);
  } catch (error: unknown) {
    output.destroy();
    if (!output.closed) await once(output, "close").catch(() => undefined);
    await unlink(partPath).catch(() => undefined);
    throw error;
  }
}
