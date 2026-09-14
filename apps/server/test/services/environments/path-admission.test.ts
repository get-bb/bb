import { expect, it } from "vitest";
import { z } from "zod";
import { withTestHarness } from "../../helpers/test-app.js";
import {
  seedEnvironment,
  seedHost,
  seedProjectWithSource,
} from "../../helpers/seed.js";

it("filters stored environment paths while every host is offline", async () => {
  await withTestHarness(async (harness) => {
    const host = seedHost(harness.deps);
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const environment = seedEnvironment(harness.deps, {
      hostId: host.id,
      projectId: project.id,
      path: "/tmp/stored-workspace",
    });
    for (const hostId of [host.id, null]) {
      const query = new URLSearchParams({ path: "/tmp/stored-workspace" });
      if (hostId !== null) query.set("hostId", hostId);
      const response = await harness.app.request(
        `/api/v1/environments?${query}`,
      );
      expect(response.status).toBe(200);
      expect(
        z
          .array(z.object({ id: z.string() }))
          .parse(await response.json())
          .map((row) => row.id),
      ).toEqual([environment.id]);
    }
  });
});
