import {
  typedRoutes,
  type HostDaemonInternalSchema,
} from "@bb/host-daemon-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";
import { hostArtifactFileResponse } from "./host-artifact-response.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

/**
 * Content-addressed provider-bridge bytes for enrolled daemons. Served by the
 * same helper as plugin host bundles: blanket daemon auth, the hash is the
 * capability, and anything odd is an indistinguishable 404.
 */
export function registerInternalProviderBridgeRoutes(
  app: Hono,
  deps: Pick<AppDeps, "providerBridgeArtifacts">,
): void {
  const { get } = typedRoutes<HostDaemonInternalSchema>(app);

  get("/provider-bridges/:sha256", async (context) => {
    const notFound = new ApiError(
      404,
      "provider_bridge_not_found",
      "Provider bridge not found",
    );
    const requestedSha256 = context.req.param("sha256");
    if (!SHA256_PATTERN.test(requestedSha256)) {
      throw notFound;
    }
    const artifact = deps.providerBridgeArtifacts.getBySha256(requestedSha256);
    if (artifact === undefined) {
      throw notFound;
    }
    const response = await hostArtifactFileResponse({
      path: artifact.path,
      byteLength: artifact.byteLength,
      digest: requestedSha256,
    });
    if (response === null) {
      throw notFound;
    }
    return response;
  });
}
