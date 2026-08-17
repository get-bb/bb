import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorToResponse } from "../../src/errors.js";
import { registerInternalPluginHostArtifactRoutes } from "../../src/internal/plugin-host-artifacts.js";
import { PluginHostArtifactRegistry } from "../../src/services/plugins/plugin-host-artifact-registry.js";
import { withTestHarness, testLogger } from "../helpers/test-app.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createRouteHarness(bytes: Uint8Array) {
  const directory = await mkdtemp(join(tmpdir(), "bb-host-artifact-route-"));
  tempDirs.push(directory);
  const path = join(directory, "host.js");
  await writeFile(path, bytes);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const pluginHostArtifacts = new PluginHostArtifactRegistry();
  pluginHostArtifacts.set("git", {
    path,
    byteLength: bytes.byteLength,
    digest,
    generation: "generation-1",
  });
  const getHostArtifact = vi.spyOn(pluginHostArtifacts, "get");
  const app = new Hono();
  app.onError((error) => errorToResponse(error, testLogger));
  registerInternalPluginHostArtifactRoutes(app, { pluginHostArtifacts });
  return { app, digest, getHostArtifact, path };
}

describe("internal plugin host artifact routes", () => {
  it("serves only the active immutable digest with exact artifact bytes", async () => {
    const bytes = Buffer.from(
      "export default { experimental_apiVersion: 1 };\n",
    );
    const { app, digest, getHostArtifact } = await createRouteHarness(bytes);

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
    expect(getHostArtifact).toHaveBeenCalledWith("git");
  });

  it("returns 404 without consulting plugin state for a malformed digest", async () => {
    const { app, getHostArtifact } = await createRouteHarness(
      Buffer.from("artifact"),
    );

    const response = await app.request("/plugins/git/host/not-a-digest");

    expect(response.status).toBe(404);
    expect(getHostArtifact).not.toHaveBeenCalled();
  });

  it("returns 404 for a valid but inactive digest", async () => {
    const { app, getHostArtifact } = await createRouteHarness(
      Buffer.from("artifact"),
    );
    const staleDigest = "0".repeat(64);

    const response = await app.request(`/plugins/git/host/${staleDigest}`);

    expect(response.status).toBe(404);
    expect(getHostArtifact).toHaveBeenCalledWith("git");
  });

  it("reads the active artifact lazily from its recorded path", async () => {
    const { app, digest, path } = await createRouteHarness(
      Buffer.from("artifact"),
    );
    await rm(path);

    const response = await app.request(`/plugins/git/host/${digest}`);

    expect(response.status).toBe(404);
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
