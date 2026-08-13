import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { readFile, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createPluginContext } from "../../lib/context.js";
import { buildLogPath, buildLogRoot } from "./build/logs.js";
import { createBuildRun, getBuildRun } from "./build/runs-store.js";
import { registerAuthoring } from "./register.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose()));
});

async function eventually(assertion: () => void): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (true) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

describe("authoring registration", () => {
  it("narrows probe history to zero, wires local-auth logs, and recovers queued rows", async () => {
    const host = createFakePluginHost({ pluginId: `fs-authoring-register-${crypto.randomUUID()}` });
    hosts.push(host);
    const ctx = createPluginContext(host.bb);
    const db = ctx.db();
    const logPath = await buildLogPath(db, "build-queued");
    await writeFile(logPath, "prior evidence\n", "utf8");
    await createBuildRun({ db, publish: () => undefined }, {
      projectId: "project-a",
      projectVersionId: "version-a",
      runId: "build-queued",
      kind: "build",
      target: null,
      toolchain: "fixture",
      artifact: null,
      digest: null,
      logPath,
      startedAt: "2026-08-13T12:00:00.000Z",
    });

    registerAuthoring(host.bb, ctx);

    expect(host.harness.inspection.registrations.httpRoutes).toContainEqual(
      expect.objectContaining({
        method: "GET",
        path: "/authoring/build/log",
        auth: "local",
      }),
    );
    expect(logPath.startsWith(`${await buildLogRoot(db)}/`)).toBe(true);

    const probes = await host.harness.behavior.callRpc("benchDevRunsList", {
      projectId: "project-a",
      projectVersionId: "version-a",
      pageSize: 50,
      cursor: null,
      kinds: ["probe"],
    });
    expect(probes).toEqual({ items: [], total: 0, cursor: null });

    await eventually(() => {
      expect(
        getBuildRun(
          db,
          { projectId: "project-a", projectVersionId: "version-a" },
          "build-queued",
        )?.status,
      ).toBe("failed");
    });
    expect(await readFile(logPath, "utf8")).toContain(
      "orphaned: plugin restarted while the job was queued",
    );

    const response = await host.harness.behavior.fetchHttp(
      "GET",
      "/authoring/build/log?projectId=project-a&projectVersionId=version-a&runId=build-queued",
      { headers: { Range: "bytes=0-4" } },
    );
    expect(response.status).toBe(206);
    expect(await response.text()).toBe("prior");

    await eventually(() => {
      expect(host.harness.inspection.needsConfigurationMessages).toHaveLength(1);
    });
  });
});
