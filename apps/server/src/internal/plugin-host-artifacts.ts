import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import {
  typedRoutes,
  type HostDaemonInternalSchema,
} from "@bb/host-daemon-contract";
import type { Hono } from "hono";
import { ApiError } from "../errors.js";
import type { PluginService } from "../services/plugins/plugin-service.js";

const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;

export function registerInternalPluginHostArtifactRoutes(
  app: Hono,
  plugins: Pick<PluginService, "getHostArtifact">,
): void {
  const { get } = typedRoutes<HostDaemonInternalSchema>(app);
  get("/plugins/:pluginId/host/:digest", async (context) => {
    const pluginId = context.req.param("pluginId");
    const digest = context.req.param("digest");
    if (!DIGEST_PATTERN.test(digest)) {
      throw new ApiError(
        404,
        "plugin_host_artifact_not_found",
        "Host artifact not found",
      );
    }
    const artifact = plugins.getHostArtifact(pluginId, digest);
    if (artifact === undefined) {
      throw new ApiError(
        404,
        "plugin_host_artifact_not_found",
        "Host artifact not found",
      );
    }
    const artifactStats = await stat(artifact.path).catch(() => null);
    if (
      artifactStats === null ||
      !artifactStats.isFile() ||
      artifactStats.size !== artifact.byteLength
    ) {
      throw new ApiError(
        404,
        "plugin_host_artifact_not_found",
        "Host artifact not found",
      );
    }
    const body = Readable.toWeb(
      createReadStream(artifact.path),
    ) as ReadableStream<Uint8Array>;
    return new Response(body, {
      status: 200,
      headers: {
        "cache-control": "private, immutable, max-age=31536000",
        "content-length": String(artifact.byteLength),
        "content-type": "text/javascript; charset=utf-8",
        etag: `"${digest}"`,
      },
    });
  });
}
