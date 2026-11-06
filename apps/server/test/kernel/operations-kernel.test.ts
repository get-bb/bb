import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { publicOperations } from "@bb/server-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertEveryOperationImplemented,
  createOperationRoutes,
} from "../../src/kernel/http-door.js";
import { createServerKernel } from "../../src/kernel/server-kernel.js";
import {
  startTestServer,
  type RunningTestServer,
} from "../helpers/test-app.js";
import { seedHostSession, seedProjectWithSource } from "../helpers/seed.js";

describe("operation coverage", () => {
  it("names every operation a route leaves unimplemented", () => {
    const routes = createOperationRoutes(new Hono(), createServerKernel());
    expect(() => assertEveryOperationImplemented(routes)).toThrow(
      /Operations without an implementation: .*threads\.send/,
    );
    expect(publicOperations().size).toBeGreaterThan(250);
  });
});

describe("operations behind a listening server", () => {
  let server: RunningTestServer;
  let projectId: string;
  let attachmentPath: string;

  beforeAll(async () => {
    server = await startTestServer();
    const { host } = seedHostSession(server.deps, { id: "host-bodies" });
    projectId = seedProjectWithSource(server.deps, { hostId: host.id }).project
      .id;
    const form = new FormData();
    form.set("file", new File(["hello body"], "plain.txt", { type: "text/plain" }));
    const uploaded = await fetch(
      `${server.baseUrl}/api/v1/projects/${projectId}/attachments`,
      { method: "POST", body: form },
    );
    expect(uploaded.status).toBe(201);
    attachmentPath = (await uploaded.json()).path;
  });

  afterAll(async () => {
    await server.pluginService.stop();
    await server.close();
    await server.cleanup();
  });

  it("serializes a stream body through the route, with conditional requests", async () => {
    const url = `${server.baseUrl}/api/v1/projects/${projectId}/attachments/content?path=${encodeURIComponent(attachmentPath)}`;
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain");
    expect(response.headers.get("content-length")).toBe("10");
    expect(await response.text()).toBe("hello body");
    const etag = response.headers.get("etag");
    expect(etag).toEqual(expect.any(String));
    const revalidated = await fetch(url, {
      headers: { "if-none-match": etag ?? "" },
    });
    expect(revalidated.status).toBe(304);
    expect(await revalidated.text()).toBe("");
  });

  it("serializes an undeclared status as a JSON body", async () => {
    const root = join(server.config.dataDir, "fixtures", "async-install");
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "bb-plugin-async-install",
        version: "0.1.0",
        bb: {
          name: "async-install",
          description: "async-install fixture",
          branding: { icon: "Zap" },
          server: "./server.ts",
        },
      }),
    );
    await writeFile(
      join(root, "server.ts"),
      "export default function plugin() {}",
    );
    const response = await fetch(`${server.baseUrl}/api/v1/plugins/install`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        prefer: "respond-async",
      },
      body: JSON.stringify({ source: `path:${root}` }),
    });
    expect(response.status).toBe(202);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toMatchObject({
      ok: true,
      job: { id: expect.any(String) },
    });
  });

  it("rejects input the operation cannot parse before running it", async () => {
    const response = await fetch(
      `${server.baseUrl}/api/v1/projects/${projectId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: 42 }),
      },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_request" });
  });
});
