import { upsertProjectExecutionDefaults } from "@bb/db";
import { describe, expect, it } from "vitest";
import { registerFirstPartyProviders } from "../helpers/provider-registry.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("project reads during provider startup", () => {
  it("returns saved defaults before registration and with an unavailable provider", async () => {
    await withTestHarness(
      { seedFirstPartyProviders: false },
      async (harness) => {
        const defaults = {
          providerId: "codex",
          model: "gpt-5",
          reasoningLevel: "medium" as const,
          permissionMode: "auto" as const,
          serviceTier: "default" as const,
        };
        for (const phase of ["starting", "unavailable"] as const) {
          if (phase === "unavailable") {
            upsertProjectExecutionDefaults(harness.db, {
              projectId: "proj_personal",
              ...defaults,
            });
            await registerFirstPartyProviders(harness.deps.providerRegistry, {
              unavailablePluginIds: ["provider-codex"],
            });
          }
          const expectedDefaults = phase === "starting" ? null : defaults;
          const sidebar = await harness.app.request(
            "/api/v1/sidebar-bootstrap",
          );
          expect(sidebar.status).toBe(200);
          expect(
            (await sidebar.json()).personalProject.defaultExecutionOptions,
          ).toEqual(expectedDefaults);
          const projects = await harness.app.request(
            "/api/v1/projects?include=threads&includePersonal=true",
          );
          expect(projects.status).toBe(200);
          expect((await projects.json())[0].defaultExecutionOptions).toEqual(
            expectedDefaults,
          );
          const options = await harness.app.request(
            "/api/v1/projects/proj_personal/default-execution-options",
          );
          expect(options.status).toBe(200);
          expect(await options.json()).toEqual(expectedDefaults);
        }
      },
    );
  });
});
