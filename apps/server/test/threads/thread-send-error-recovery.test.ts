import { getThread } from "@bb/db";
import { describe, expect, it } from "vitest";
import { sendThreadMessage } from "../../src/services/threads/thread-send.js";
import { waitForQueuedCommand } from "../helpers/commands.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("errored thread correction", () => {
  it("starts a recovery turn for steer-if-active", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-error-recovery",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/error-recovery-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/error-recovery-environment",
        status: "ready",
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "error",
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-error-recovery",
        threadId: thread.id,
      });

      await sendThreadMessage(harness.deps, {
        environment,
        payload: {
          input: textInput("corrective text"),
          mode: "steer-if-active",
          model: "gpt-5",
          permissionMode: "full",
          reasoningLevel: "medium",
          serviceTier: "default",
        },
        thread,
        trigger: "user",
      });

      expect(getThread(harness.db, thread.id)).toMatchObject({
        status: "active",
      });
      const queued = await waitForQueuedCommand(
        harness,
        (candidate) =>
          candidate.command.type === "turn.submit" &&
          candidate.command.threadId === thread.id,
      );
      expect(queued.command).toMatchObject({
        target: { mode: "start" },
        threadId: thread.id,
        type: "turn.submit",
      });
    });
  }, 15_000);
});
