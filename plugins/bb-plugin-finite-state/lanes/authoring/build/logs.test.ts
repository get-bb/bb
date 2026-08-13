import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openStore } from "../../../lib/store/index.js";
import { createBuildLogTailHandler } from "./logs.js";
import { createBuildRun } from "./runs-store.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function fixture() {
  const host = createFakePluginHost({ pluginId: `fs-logs-${crypto.randomUUID()}` });
  const db = openStore(host.bb).db;
  const dataDir = await mkdtemp(join(process.cwd(), ".fs-logs-test-"));
  const logDir = join(dataDir, "build-logs");
  await mkdir(logDir);
  const logPath = join(logDir, "run-a.log");
  await writeFile(logPath, "0123456789", "utf8");
  await createBuildRun({ db, publish: () => undefined }, {
    projectId: "project-a",
    projectVersionId: "version-a",
    runId: "run-a",
    kind: "build",
    target: null,
    toolchain: "fixture",
    artifact: null,
    digest: null,
    logPath,
    startedAt: "2026-08-13T01:00:00.000Z",
  });
  host.bb.http.route("GET", "/authoring/build/log", createBuildLogTailHandler({ db, dataDir }));
  cleanups.push(async () => {
    await host.harness.lifecycle.dispose();
    await rm(dataDir, { recursive: true, force: true });
  });
  return { host, db, dataDir, logPath };
}

describe("build log tail", () => {
  it("serves bounded byte ranges selected only by run scope", async () => {
    const fx = await fixture();
    const response = await fx.host.harness.fetchHttp(
      "GET",
      "/authoring/build/log?projectId=project-a&projectVersionId=version-a&runId=run-a",
      { headers: { Range: "bytes=2-5" } },
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await response.text()).toBe("2345");
  });

  it("rejects cross-scope access and diagnoses a missing log", async () => {
    const fx = await fixture();
    const wrong = await fx.host.harness.fetchHttp(
      "GET",
      "/authoring/build/log?projectId=project-b&projectVersionId=version-a&runId=run-a",
    );
    expect(wrong.status).toBe(404);
    await rm(fx.logPath);
    const missing = await fx.host.harness.fetchHttp(
      "GET",
      "/authoring/build/log?projectId=project-a&projectVersionId=version-a&runId=run-a",
    );
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({
      error: { code: "LOG_NOT_AVAILABLE" },
    });
    expect(dirname(fx.logPath)).toContain("build-logs");
  });
});
