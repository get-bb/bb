import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

const BASE = "http://127.0.0.1:3334";

describe("/plugins/safe-mode", () => {
  let harness: TestAppHarness;

  beforeEach(async () => {
    harness = await createTestAppHarness();
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-extra");
    await mkdir(rootDir, { recursive: true });
    await writeFile(
      join(rootDir, "package.json"),
      JSON.stringify({
        name: "bb-plugin-extra",
        version: "0.1.0",
        bb: {
          name: "Extra",
          description: "Safe mode route fixture.",
          branding: { icon: "Zap" },
          server: "./server.ts",
        },
      }),
    );
    await writeFile(
      join(rootDir, "server.ts"),
      "export default function plugin() {}\n",
    );
    await harness.pluginService.installPath(rootDir);
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  async function request(init?: RequestInit): Promise<Response> {
    return harness.app.request(`${BASE}/api/v1/plugins/safe-mode`, init);
  }

  function put(body: unknown): Promise<Response> {
    return request({
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("toggles safe mode and reports the plugins it stopped", async () => {
    await expect((await request()).json()).resolves.toEqual({
      enabled: false,
    });

    const on = await put({ enabled: true });
    expect(on.status).toBe(200);
    await expect(on.json()).resolves.toEqual({ enabled: true, problems: [] });
    await expect((await request()).json()).resolves.toEqual({ enabled: true });
    expect(
      harness.pluginService.list().find((plugin) => plugin.id === "extra"),
    ).toMatchObject({ enabled: true, status: "disabled" });

    await expect((await put({ enabled: false })).json()).resolves.toEqual({
      enabled: false,
      problems: [],
    });
    expect(
      harness.pluginService.list().find((plugin) => plugin.id === "extra"),
    ).toMatchObject({ enabled: true, status: "running" });
  });

  it("rejects a body without a boolean", async () => {
    const response = await put({ enabled: "yes" });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "expected { enabled: boolean }",
    });
  });
});
