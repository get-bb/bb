import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  typedRoutes,
  type HostDaemonInternalSchema,
} from "@bb/host-daemon-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

/**
 * Content-addressed provider-bridge bytes for enrolled daemons. Mirrors the
 * skills-tree route: blanket daemon auth, the hash is the capability, and
 * anything odd is an indistinguishable 404. The bytes are re-hashed before
 * serving so a stale registry entry can never hand a daemon bytes that do
 * not match the sha it asked for — the daemon verifies again on its side and
 * never executes an unverified artifact.
 */
export function registerInternalProviderBridgeRoutes(
  app: Hono,
  deps: AppDeps,
): void {
  const { get } = typedRoutes<HostDaemonInternalSchema>(app);

  get("/provider-bridges/:sha256", async (context) => {
    const requestedSha256 = context.req.param("sha256");
    if (!SHA256_PATTERN.test(requestedSha256)) {
      throw new ApiError(
        404,
        "provider_bridge_not_found",
        "Provider bridge not found",
      );
    }
    const artifact = deps.providerBridgeArtifacts.getBySha256(requestedSha256);
    if (artifact === undefined) {
      throw new ApiError(
        404,
        "provider_bridge_not_found",
        "Provider bridge not found",
      );
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(artifact.path);
    } catch {
      throw new ApiError(
        404,
        "provider_bridge_not_found",
        "Provider bridge not found",
      );
    }
    if (
      createHash("sha256").update(bytes).digest("hex") !== requestedSha256
    ) {
      throw new ApiError(
        404,
        "provider_bridge_not_found",
        "Provider bridge not found",
      );
    }
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(bytes.byteLength),
      },
    });
  });
}
