import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { errorToResponse } from "../../src/errors.js";
import { registerInternalProviderBridgeRoutes } from "../../src/internal/provider-bridges.js";
import { ProviderBridgeArtifactRegistry } from "../../src/services/plugins/provider-bridge-artifacts.js";
import { withTestHarness, testLogger } from "../helpers/test-app.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createRouteHarness(bytes: Uint8Array) {
  const directory = await mkdtemp(join(tmpdir(), "bb-bridge-route-"));
  tempDirs.push(directory);
  const path = join(directory, "provider-bridge.mjs");
  await writeFile(path, bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const providerBridgeArtifacts = new ProviderBridgeArtifactRegistry();
  providerBridgeArtifacts.set("provider-echo", {
    sha256,
    byteLength: bytes.byteLength,
    path,
  });
  const app = new Hono();
  app.onError((error) => errorToResponse(error, testLogger));
  registerInternalProviderBridgeRoutes(app, { providerBridgeArtifacts });
  return { app, sha256, path, providerBridgeArtifacts };
}

describe("internal provider bridge routes", () => {
  it("streams the recorded bundle as an immutable content-addressed artifact", async () => {
    const bytes = Buffer.from(
      'export function handleLine() { return "ok"; }\n',
    );
    const { app, sha256 } = await createRouteHarness(bytes);

    const response = await app.request(`/provider-bridges/${sha256}`);

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get("cache-control")).toBe(
      "private, immutable, max-age=31536000",
    );
    expect(response.headers.get("content-length")).toBe(
      String(bytes.byteLength),
    );
    expect(response.headers.get("etag")).toBe(`"${sha256}"`);
  });

  it("returns 404 for a malformed sha256 and for one nothing has registered", async () => {
    const { app } = await createRouteHarness(Buffer.from("bridge"));

    expect((await app.request("/provider-bridges/nope")).status).toBe(404);
    expect(
      (await app.request(`/provider-bridges/${"0".repeat(64)}`)).status,
    ).toBe(404);
  });

  // The bytes are streamed rather than re-hashed per request, so the length
  // check is what stops a registry entry that no longer matches its file from
  // handing a daemon something under a sha it will never verify.
  it("refuses to stream a file that no longer matches the recorded length", async () => {
    const { app, sha256, path } = await createRouteHarness(
      Buffer.from("bridge"),
    );
    await writeFile(path, "a different bundle entirely");

    expect((await app.request(`/provider-bridges/${sha256}`)).status).toBe(404);

    await rm(path);
    expect((await app.request(`/provider-bridges/${sha256}`)).status).toBe(404);
  });

  it("is protected by the server's daemon authentication middleware", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request(
        `/internal/provider-bridges/${"0".repeat(64)}`,
      );
      expect(response.status).toBe(401);
    });
  });
});
