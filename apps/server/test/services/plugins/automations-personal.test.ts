import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { startTestServer } from "../../helpers/test-app.js";

describe("Personal automations", () => {
  it("creates and updates an hourly script through the real project SDK", async () => {
    const server = await startTestServer();
    try {
      server.pluginService.bindSdk({ baseUrl: server.baseUrl });
      const entry = await server.pluginService.install("builtin:automations", {
        kind: "root",
      });
      expect(entry.status, entry.statusDetail ?? undefined).toBe("running");

      const created = await server.app.request(
        "/api/v1/plugins/automations/rpc/automations_create",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId: PERSONAL_PROJECT_ID,
            name: "Say hi every hour",
            enabled: false,
            trigger: {
              triggerType: "schedule",
              cron: "0 * * * *",
              timezone: "America/Los_Angeles",
            },
            execution: {
              mode: "script",
              script: 'printf "hi\\n"',
              interpreter: "sh",
            },
            origin: "human",
          }),
        },
      );
      const createdBody: unknown = await created.json();
      expect(created.status, JSON.stringify(createdBody)).toBe(200);
      const { result } = z
        .object({ result: z.object({ id: z.string() }) })
        .parse(createdBody);
      expect(createdBody).toMatchObject({
        result: {
          projectId: PERSONAL_PROJECT_ID,
          name: "Say hi every hour",
          trigger: { cron: "0 * * * *" },
          execution: { mode: "script", interpreter: "sh" },
        },
      });

      const updated = await server.app.request(
        "/api/v1/plugins/automations/rpc/automations_update",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId: PERSONAL_PROJECT_ID,
            automationId: result.id,
            name: "Hourly greeting",
          }),
        },
      );
      expect(updated.status).toBe(200);
      expect(await updated.json()).toMatchObject({
        result: { id: result.id, name: "Hourly greeting" },
      });
    } finally {
      await server.pluginService.stop();
      await server.close();
    }
  });
});
