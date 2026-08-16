import { createHash } from "node:crypto";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { errorToResponse } from "../../src/errors.js";
import { registerInternalPluginHostArtifactRoutes } from "../../src/internal/plugin-host-artifacts.js";
import { withTestHarness, testLogger } from "../helpers/test-app.js";

function createRouteHarness(bytes: Uint8Array) {
  const digest = createHash("sha256").update(bytes).digest("hex");
  const readHostArtifact = vi.fn((pluginId: string, candidate: string) =>
    pluginId === "git" && candidate === digest
      ? { bytes, byteLength: bytes.byteLength }
      : undefined,
  );
  const app = new Hono();
  app.onError((error) => errorToResponse(error, testLogger));
  registerInternalPluginHostArtifactRoutes(app, { readHostArtifact });
  return { app, digest, readHostArtifact };
}

describe("internal plugin host artifact routes", () => {
  it("serves only the active immutable digest with exact artifact bytes", async () => {
    const bytes = Buffer.from(
      "export default { experimental_apiVersion: 1 };\n",
    );
    const { app, digest, readHostArtifact } = createRouteHarness(bytes);

    const response = await app.request(`/plugins/git/host/${digest}`);

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get("cache-control")).toBe(
      "private, immutable, max-age=31536000",
    );
    expect(response.headers.get("content-length")).toBe(
      String(bytes.byteLength),
    );
    expect(response.headers.get("etag")).toBe(`"${digest}"`);
    expect(readHostArtifact).toHaveBeenCalledWith("git", digest);
  });

  it("returns 404 without consulting plugin state for a malformed digest", async () => {
    const { app, readHostArtifact } = createRouteHarness(
      Buffer.from("artifact"),
    );

    const response = await app.request("/plugins/git/host/not-a-digest");

    expect(response.status).toBe(404);
    expect(readHostArtifact).not.toHaveBeenCalled();
  });

  it("returns 404 for a valid but inactive digest", async () => {
    const { app, readHostArtifact } = createRouteHarness(
      Buffer.from("artifact"),
    );
    const staleDigest = "0".repeat(64);

    const response = await app.request(`/plugins/git/host/${staleDigest}`);

    expect(response.status).toBe(404);
    expect(readHostArtifact).toHaveBeenCalledWith("git", staleDigest);
  });

  it("is protected by the server's daemon authentication middleware", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request(
        `/internal/plugins/git/host/${"0".repeat(64)}`,
      );
      expect(response.status).toBe(401);
    });
  });
});
