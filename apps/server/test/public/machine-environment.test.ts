import { stat } from "node:fs/promises";
import { join } from "node:path";
import { appSettingsValues, upsertHost, updateHost } from "@bb/db";
import { createBbSdk } from "@bb/sdk/core";
import { createHttpTransport } from "@bb/sdk/node";
import { describe, expect, it, vi } from "vitest";
import { withTestHarness } from "../helpers/test-app.js";
import { resolveHostEnvironment } from "../../src/services/hosts/host-environment.js";
import * as gitCredentials from "../../src/services/machines/git-credentials.js";

describe("machine environment settings", () => {
  it("round trips through the SDK while keeping secrets out of APIs and the real database", async () => {
    const resolver = vi
      .spyOn(gitCredentials, "resolveGitCredentials")
      .mockResolvedValue([
        {
          name: "GH_TOKEN",
          value: "builtin-token",
          source: { core: "machine-git" },
          reason: "Git",
        },
      ]);
    try {
      await withTestHarness(async (harness) => {
        const sdk = createBbSdk({
          transport: createHttpTransport({
            baseUrl: "http://localhost",
            runtime: "node",
            fetch: async (input, init) =>
              harness.app.fetch(new Request(input, init)),
          }),
        });
        const result = await sdk.system.replaceMachineEnvironment({
          variables: [
            {
              name: "DEPLOY_REGION",
              value: "test-region",
              note: "Gate",
            },
            {
              name: "GH_TOKEN",
              value: "user-private-token",
              note: null,
            },
          ],
        });
        expect(result.builtInGit.status).toBe("overridden");
        expect(result.variables).toContainEqual({
          name: "GH_TOKEN",
          secret: true,
          value: null,
          note: null,
        });
        expect(
          JSON.stringify(await sdk.system.machineEnvironment()),
        ).not.toContain("user-private-token");
        expect(
          JSON.stringify(harness.db.select().from(appSettingsValues).all()),
        ).not.toContain("user-private-token");
        const path = join(
          harness.config.dataDir,
          "secrets",
          "machine-environment",
          "GH_TOKEN",
        );
        await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
        expect(
          (await stat(join(harness.config.dataDir, "machine-environment-key")))
            .mode & 0o777,
        ).toBe(0o600);
        expect(
          JSON.stringify(harness.db.select().from(appSettingsValues).all()),
        ).not.toContain("test-region");
        expect(JSON.stringify(result)).not.toContain("test-region");
        expect(
          await resolveHostEnvironment(harness.deps, {
            hostId: "local",
            projectId: null,
          }),
        ).toEqual([]);
        upsertHost(harness.db, harness.hub, {
          id: "machine",
          name: "Machine",
        });
        updateHost(harness.db, harness.hub, "machine", {
          machineProviderId: "manual",
        });
        const env = await resolveHostEnvironment(harness.deps, {
          hostId: "machine",
          projectId: null,
        });
        expect(env.filter((entry) => entry.name === "GH_TOKEN")).toEqual([
          expect.objectContaining({
            value: "user-private-token",
          }),
        ]);
        expect(env).toContainEqual(
          expect.objectContaining({
            name: "DEPLOY_REGION",
            value: "test-region",
          }),
        );
        resolver.mockResolvedValueOnce([]);
        expect(
          await resolveHostEnvironment(harness.deps, {
            hostId: "machine",
            projectId: null,
          }),
        ).toContainEqual(
          expect.objectContaining({ name: "GIT_CONFIG_COUNT", value: "4" }),
        );
        await sdk.system.replaceMachineEnvironment({
          variables: [{ name: "DEPLOY_REGION", value: null, note: "Gate" }],
        });
        await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
        expect(
          await resolveHostEnvironment(harness.deps, {
            hostId: "machine",
            projectId: null,
          }),
        ).toContainEqual(
          expect.objectContaining({ name: "GH_TOKEN", value: "builtin-token" }),
        );
      });
    } finally {
      resolver.mockRestore();
    }
  });
});
