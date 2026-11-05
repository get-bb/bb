import { mkdir, writeFile } from "node:fs/promises";
import { Session } from "node:inspector";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { createTestAppHarness } from "../../helpers/test-app.js";

it("releases retired route state while keeping the current plugin active", async () => {
  const references: WeakRef<object>[] = [];
  const harness = await createTestAppHarness();
  const inspector = new Session();
  try {
    inspector.connect();
    vi.stubGlobal("__bbObserveReloadPayload", (payload: object) => {
      references.push(new WeakRef(payload));
    });
    const root = join(harness.config.dataDir, "collection-fixture");
    await mkdir(root);
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "bb-plugin-collection-fixture",
        version: "0.1.0",
        bb: {
          name: "Collection fixture",
          description: "Exercises retired plugin state collection.",
          branding: { icon: "Zap" },
          server: "./server.ts",
        },
      }),
    );
    await writeFile(
      join(root, "server.ts"),
      `export default function plugin(bb) {
        const payload = { value: 42 };
        globalThis.__bbObserveReloadPayload(payload);
        bb.http.route("GET", "/value", context => context.json(payload));
      }`,
    );
    expect((await harness.pluginService.installPath(root)).status).toBe(
      "running",
    );
    for (let reload = 0; reload < 3; reload++) {
      expect(
        await harness.pluginService.reload("collection-fixture"),
      ).toMatchObject({
        ok: true,
      });
    }
    for (let collection = 0; collection < 3; collection++) {
      await setTimeout(0);
      await new Promise<void>((resolve, reject) => {
        inspector.post("HeapProfiler.collectGarbage", (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
    expect(references).toHaveLength(4);
    expect(
      references.map((reference) => reference.deref() !== undefined),
    ).toEqual([false, false, false, true]);
    const response = await harness.app.request(
      "http://127.0.0.1/api/v1/plugins/collection-fixture/http/value",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ value: 42 });
  } finally {
    inspector.disconnect();
    try {
      await harness.cleanup();
    } finally {
      vi.unstubAllGlobals();
    }
  }
});
