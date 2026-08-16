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
  plugins: Pick<PluginService, "readHostArtifact">,
): void {
  const { get } = typedRoutes<HostDaemonInternalSchema>(app);
  get("/plugins/:pluginId/host/:digest", (context) => {
    const pluginId = context.req.param("pluginId");
    const digest = context.req.param("digest");
    if (!DIGEST_PATTERN.test(digest)) {
      throw new ApiError(
        404,
        "plugin_host_artifact_not_found",
        "Host artifact not found",
      );
    }
    const artifact = plugins.readHostArtifact(pluginId, digest);
    if (artifact === undefined) {
      throw new ApiError(
        404,
        "plugin_host_artifact_not_found",
        "Host artifact not found",
      );
    }
    return new Response(Uint8Array.from(artifact.bytes).buffer, {
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
