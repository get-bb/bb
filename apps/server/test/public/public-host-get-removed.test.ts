import { describe, expect, it } from "vitest";
import { updateHost } from "@bb/db";
import { withTestHarness } from "../helpers/test-app.js";
import { seedHost } from "../helpers/seed.js";

describe("GET /hosts/:id with includeRemoved", () => {
  it("returns a removed machine disconnected only when asked, and 404s an unknown one", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, { name: "Old cloud box" });
      updateHost(harness.db, harness.deps.hub, host.id, {
        phase: "destroyed",
        destroyedAt: 1_000,
      });

      const plain = await harness.app.request(`/api/v1/hosts/${host.id}`);
      expect(plain.status).toBe(404);

      const removed = await harness.app.request(
        `/api/v1/hosts/${host.id}?includeRemoved=true`,
      );
      expect(removed.status).toBe(200);
      expect(await removed.json()).toMatchObject({
        id: host.id,
        name: "Old cloud box",
        status: "disconnected",
        connectMachineId: null,
        threadStorageRootPath: null,
      });

      const unknown = await harness.app.request(
        "/api/v1/hosts/host_missing?includeRemoved=true",
      );
      expect(unknown.status).toBe(404);
    });
  });

  it("answers a live machine the same with or without includeRemoved", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, { name: "Studio" });
      const plain = await (
        await harness.app.request(`/api/v1/hosts/${host.id}`)
      ).json();
      const withRemoved = await (
        await harness.app.request(
          `/api/v1/hosts/${host.id}?includeRemoved=true`,
        )
      ).json();
      expect(withRemoved).toEqual(plain);
    });
  });
});
