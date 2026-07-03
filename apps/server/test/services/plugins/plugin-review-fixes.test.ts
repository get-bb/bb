import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setExperiments } from "@bb/db";
import { defaultExperiments } from "@bb/domain";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

// serverPort 3334 puts this host on the local-app origin allowlist.
const BASE = "http://127.0.0.1:3334";
const EVIL_ORIGIN = "https://evil.example";
const PLUGIN_ID = "review-fixes";

const FIXTURE_SOURCE = `
  export default function plugin(bb: any) {
    const g = globalThis as any;
    g.__rfLoads = (g.__rfLoads ?? 0) + 1;
    bb.onDispose(() => { g.__rfDisposals = (g.__rfDisposals ?? 0) + 1; });
    bb.cli.register({
      name: "rf",
      summary: "review fixes fixture",
      commands: [],
      run: async () => ({ exitCode: 0, stdout: "rf ok" }),
    });
    bb.rpc.register({
      slowKv: async (input: any) => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        await bb.storage.kv.set("drained", input);
        return "done";
      },
    });
  }
`;

describe("review fixes: idempotent enable, cli auth, dispose drain", () => {
  let harness: TestAppHarness;
  let workDir: string;
  const globals = globalThis as Record<string, unknown>;

  beforeEach(async () => {
    harness = await createTestAppHarness();
    setExperiments(harness.db, { ...defaultExperiments, plugins: true });
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-review-fixes-"));
    delete globals.__rfLoads;
    delete globals.__rfDisposals;
    const rootDir = join(workDir, "bb-plugin-review-fixes");
    await mkdir(rootDir, { recursive: true });
    await writeFile(
      join(rootDir, "package.json"),
      JSON.stringify({
        name: "bb-plugin-review-fixes",
        version: "0.1.0",
        bb: { server: "./server.ts" },
      }),
    );
    await writeFile(join(rootDir, "server.ts"), FIXTURE_SOURCE);
    await harness.pluginService.installPath(rootDir);
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await rm(workDir, { recursive: true, force: true });
    await harness.cleanup();
  });

  it("enabling an already-running plugin disposes the previous instance instead of orphaning it", async () => {
    expect(globals.__rfLoads).toBe(1);
    const entry = await harness.pluginService.setEnabled(PLUGIN_ID, true);
    expect(entry?.status).toBe("running");
    // The second load must have disposed the first instance (hooks fired
    // once), not stacked a second live instance on top of it.
    expect(globals.__rfLoads).toBe(2);
    expect(globals.__rfDisposals).toBe(1);
  });

  it("POST /plugins/:id/cli rejects cross-origin requests like the rpc dispatcher", async () => {
    const foreign = await harness.app.request(
      `${BASE}/api/v1/plugins/${PLUGIN_ID}/cli`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: EVIL_ORIGIN },
        body: JSON.stringify({ argv: [] }),
      },
    );
    expect(foreign.status).toBe(403);

    const local = await harness.app.request(
      `${BASE}/api/v1/plugins/${PLUGIN_ID}/cli`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ argv: [] }),
      },
    );
    expect(local.status).toBe(200);
    expect(await local.json()).toMatchObject({ exitCode: 0, stdout: "rf ok" });
  });

  it("dispose drains in-flight rpc invocations before invalidating", async () => {
    const inFlight = harness.app.request(
      `${BASE}/api/v1/plugins/${PLUGIN_ID}/rpc/slowKv`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: 42 }),
      },
    );
    // Let the handler start its 150ms sleep, then reload mid-flight.
    await new Promise((resolve) => setTimeout(resolve, 30));
    await harness.pluginService.reload(PLUGIN_ID);
    const response = await inFlight;
    // Without the drain, the handler's kv write lands on a poisoned handle
    // and this comes back as an rpc error instead of "done".
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, result: "done" });
  });
});
