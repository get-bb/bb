import { ensurePersonalProject, listEnvironments } from "@bb/db";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import { waitForQueuedCommand } from "../helpers/commands.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const SHARED_PATH = "/tmp/shared-workspace-path-repo";

describe("thread creation on a path another project already uses", () => {
  it("creates a project-owned environment instead of failing on the personal claim", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-shared-workspace-path",
      });
      // A personal thread that switched its directory claims the folder for the
      // personal project.
      ensurePersonalProject(harness.deps.db);
      const personalEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: PERSONAL_PROJECT_ID,
        path: SHARED_PATH,
      });

      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: SHARED_PATH,
      });

      const thread = await createThreadFromRequest(harness.deps, {
        childOrigin: null,
        environment: {
          type: "host",
          hostId: host.id,
          workspace: { type: "unmanaged", path: SHARED_PATH },
        },
        input: textInput("Work in the shared folder"),
        origin: "app",
        projectId: project.id,
        providerId: "codex",
        startedOnBehalfOf: null,
      });

      expect(thread.projectId).toBe(project.id);
      // The new project gets its own environment for the folder; the personal
      // claim stays where it was.
      const projectEnvironments = listEnvironments(harness.deps.db, project.id);
      expect(projectEnvironments).toHaveLength(1);
      expect(projectEnvironments[0]?.id).not.toBe(personalEnvironment.id);

      const provision = await waitForQueuedCommand(
        harness,
        (queued) => queued.command.type === "environment.provision",
      );
      expect(provision.command).toMatchObject({
        type: "environment.provision",
        environmentId: projectEnvironments[0]?.id,
        path: SHARED_PATH,
      });
    });
  });
});
