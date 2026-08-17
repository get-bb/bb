import {
  typedRoutes,
  type HostDaemonInternalSchema,
} from "@bb/host-daemon-contract";
import type { Hono } from "hono";
import { ApiError } from "../errors.js";
import type { PluginService } from "../services/plugins/plugin-service.js";
import { hostArtifactFileResponse } from "./host-artifact-response.js";

const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;

export function registerInternalPluginHostArtifactRoutes(
  app: Hono,
  plugins: Pick<PluginService, "getHostArtifact">,
): void {
  const { get } = typedRoutes<HostDaemonInternalSchema>(app);
  get("/plugins/:pluginId/host/:digest", async (context) => {
    const notFound = new ApiError(
      404,
      "plugin_host_artifact_not_found",
      "Host artifact not found",
    );
    const pluginId = context.req.param("pluginId");
    const digest = context.req.param("digest");
    if (!DIGEST_PATTERN.test(digest)) {
      throw notFound;
    }
    const artifact = plugins.getHostArtifact(pluginId, digest);
    if (artifact === undefined) {
      throw notFound;
    }
    const response = await hostArtifactFileResponse({
      path: artifact.path,
      byteLength: artifact.byteLength,
      digest,
    });
    if (response === null) {
      throw notFound;
    }
    return response;
  });
}
