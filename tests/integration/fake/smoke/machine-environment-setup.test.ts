import { readFile } from "node:fs/promises";
import path from "node:path";
import { machineEnrollments } from "@bb/db";
import { expect, it } from "vitest";
import { updateMachineEnvironment } from "../../../../apps/server/src/services/machines/environment-settings.js";
import {
  createProjectFixture,
  createReadyHostThread,
} from "../../helpers/fixtures.js";
import { withHarness } from "../../helpers/harness.js";
import { createTestGitRepo } from "../../helpers/seed.js";

it("passes GH_TOKEN to a machine host setup command through the host plugin runner", () =>
  withHarness(
    { builtinPlugins: ["environment-git-worktree"] },
    async (harness) => {
      harness.db
        .insert(machineEnrollments)
        .values({
          id: "setup-machine",
          owner: "manual",
          key: "setup-machine",
          hostId: harness.hostId,
          state: "enrolled",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
        .run();
      await updateMachineEnvironment(
        harness.db,
        harness.server.config.dataDir,
        "GH_TOKEN",
        {
          name: "GH_TOKEN",
          value: "setup-fixture-token",
          secret: true,
          note: null,
        },
      );
      const sourcePath = await createTestGitRepo({
        repoDir: path.join(
          path.dirname(harness.repoDir),
          "machine-setup-project",
        ),
        files: [
          {
            relativePath: ".bb-env-setup.sh",
            content:
              'set -eu\ntest "$GH_TOKEN" = setup-fixture-token\nprintf setup-token-present > setup-result\n',
          },
        ],
      });
      const project = await createProjectFixture(harness, {
        name: "Machine setup environment",
        path: sourcePath,
      });
      const { environment } = await createReadyHostThread(harness, {
        projectId: project.id,
        workspace: { type: "managed-worktree" },
        timeoutMs: 30_000,
      });
      expect(environment.path).toBeTruthy();
      if (!environment.path) throw new Error("Missing setup workspace");
      expect(
        await readFile(path.join(environment.path, "setup-result"), "utf8"),
      ).toBe("setup-token-present");
    },
  ));
