import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

const BASE = "http://127.0.0.1:3334";

const HEALTHY_SOURCE = `export default function plugin(bb: any) {
  bb.cli.register({ name: "keeper", summary: "keeper", run() { return { exitCode: 0, stdout: "ok" }; } });
}
`;
const BROKEN_SOURCE = `export default function plugin() { throw new Error("boom on load"); }
`;

describe("POST /plugins/reload outcome", () => {
  let harness: TestAppHarness;
  let rootDir: string;

  beforeEach(async () => {
    harness = await createTestAppHarness();
    rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-keeper");
    await mkdir(rootDir, { recursive: true });
    await writeFile(
      join(rootDir, "package.json"),
      JSON.stringify({
        name: "bb-plugin-keeper",
        version: "0.1.0",
        bb: {
          name: "Keeper",
          description: "Reload outcome fixture.",
          branding: { icon: "Zap" },
          server: "./server.ts",
        },
      }),
    );
    await writeFile(join(rootDir, "server.ts"), HEALTHY_SOURCE);
    const entry = await harness.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  it("answers ok with the plugin list when the reload applied", async () => {
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/reload?id=keeper`,
      { method: "POST" },
    );
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ ok: true });
    expect(body).toMatchObject({
      plugins: expect.arrayContaining([
        expect.objectContaining({ id: "keeper", status: "running" }),
      ]),
    });
  });

  it("answers ok:false with the load problem when the new sources did not load (#2029)", async () => {
    await writeFile(join(rootDir, "server.ts"), BROKEN_SOURCE);
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/reload?id=keeper`,
      { method: "POST" },
    );
    expect(response.status).toBe(422);
    const body: unknown = await response.json();
    expect(body).toMatchObject({
      ok: false,
      error:
        'plugin "keeper" reload failed: boom on load (the previous instance is still running)',
      plugins: expect.arrayContaining([
        expect.objectContaining({
          id: "keeper",
          status: "running",
          statusDetail: "reload failed: boom on load",
        }),
      ]),
    });
  });
});

const NEEDS_KEY_THEN_BROKEN_SOURCE = `export default async function plugin(bb: any) {
  const settings = bb.settings.define({
    apiKey: { type: "string", label: "API key", secret: true },
  });
  const values = await settings.get();
  if (!values.apiKey) {
    bb.status.needsConfiguration("set apiKey first");
    return;
  }
  throw new Error("boom on load");
}
`;

describe("plugin lifecycle routes report a plugin that did not load", () => {
  let harness: TestAppHarness;
  let rootDir: string;

  beforeEach(async () => {
    harness = await createTestAppHarness();
    rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-keeper");
    await mkdir(rootDir, { recursive: true });
    await writeFile(
      join(rootDir, "package.json"),
      JSON.stringify({
        name: "bb-plugin-keeper",
        version: "0.1.0",
        bb: {
          name: "Keeper",
          description: "Lifecycle outcome fixture.",
          branding: { icon: "Zap" },
          server: "./server.ts",
        },
      }),
    );
    await writeFile(join(rootDir, "server.ts"), HEALTHY_SOURCE);
    await harness.pluginService.installPath(rootDir);
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  async function brokenWhileDisabled(): Promise<void> {
    await harness.pluginService.setEnabled("keeper", false);
    await writeFile(join(rootDir, "server.ts"), BROKEN_SOURCE);
  }

  it.each([
    {
      name: "reload",
      async prepare(): Promise<Request> {
        await brokenWhileDisabled();
        await harness.pluginService.setEnabled("keeper", true);
        return new Request(`${BASE}/api/v1/plugins/reload?id=keeper`, {
          method: "POST",
        });
      },
    },
    {
      name: "enable",
      async prepare(): Promise<Request> {
        await brokenWhileDisabled();
        return new Request(`${BASE}/api/v1/plugins/keeper/enable`, {
          method: "POST",
        });
      },
    },
    {
      name: "settings save",
      async prepare(): Promise<Request> {
        await writeFile(
          join(rootDir, "server.ts"),
          NEEDS_KEY_THEN_BROKEN_SOURCE,
        );
        await harness.pluginService.reload("keeper");
        expect(
          harness.pluginService.list().find((p) => p.id === "keeper")?.status,
        ).toBe("needs-configuration");
        return new Request(`${BASE}/api/v1/plugins/keeper/settings`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ values: { apiKey: "shhh" } }),
        });
      },
    },
  ])(
    "$name answers 422 when the plugin ends in error (#5534)",
    async ({ prepare }) => {
      const response = await harness.app.request(await prepare());
      const body: unknown = await response.json();
      const listed = await harness.app.request(`${BASE}/api/v1/plugins`);
      expect(await listed.json()).toMatchObject({
        plugins: expect.arrayContaining([
          expect.objectContaining({ id: "keeper", status: "error" }),
        ]),
      });
      expect(response.status).toBe(422);
      expect(body).toMatchObject({
        ok: false,
        error: expect.stringContaining("boom on load"),
      });
    },
  );
});
