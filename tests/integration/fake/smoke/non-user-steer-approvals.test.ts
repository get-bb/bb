import { isApprovalPendingInteraction } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  getThreadEvents,
  getThreadOutput,
  listThreadInteractions,
  resolveThreadInteraction,
  sendTextMessage,
} from "../../helpers/api.js";
import {
  waitForThreadOutputContaining,
  waitForThreadStatus,
} from "../../helpers/assertions.js";
import { withHarness } from "../../helpers/harness.js";
import {
  createProjectFixture,
  createReadyThread,
  TURN_TIMEOUT_MS,
} from "./shared.js";

describe.sequential("fake provider non-user steer approvals", () => {
  it("keeps a user turn's approvals after another thread's tell joins it", () =>
    withHarness(async (harness) => {
      const project = await createProjectFixture(
        harness,
        "Non-user Steer Approvals",
      );
      const workspace = { type: "unmanaged", path: harness.repoDir } as const;
      const { thread } = await createReadyThread(harness, {
        execution: { permissionMode: "accept-edits" },
        projectId: project.id,
        workspace,
      });
      const { thread: sender } = await createReadyThread(harness, {
        projectId: project.id,
        workspace,
      });
      const baselineCompleted = (
        await getThreadEvents(harness.api, thread.id)
      ).filter((event) => event.type === "turn/completed").length;

      await sendTextMessage(harness.api, thread.id, {
        text: "approve_after_steer:command",
      });
      await waitForThreadStatus(
        harness.api,
        thread.id,
        "active",
        TURN_TIMEOUT_MS,
      );
      await sendTextMessage(harness.api, thread.id, {
        senderThreadId: sender.id,
        text: "FYI, my build finished",
      });

      await expect
        .poll(
          async () =>
            (await listThreadInteractions(harness.api, thread.id)).filter(
              isApprovalPendingInteraction,
            ).length,
          { timeout: TURN_TIMEOUT_MS },
        )
        .toBe(1);
      const [approval] = (
        await listThreadInteractions(harness.api, thread.id)
      ).filter(isApprovalPendingInteraction);
      if (approval === undefined) {
        throw new Error("Expected the user turn's approval to reach the user");
      }
      await resolveThreadInteraction({
        api: harness.api,
        threadId: thread.id,
        interactionId: approval.id,
        resolution: { decision: "allow_once", grantedPermissions: null },
      });

      await waitForThreadOutputContaining(
        harness.api,
        thread.id,
        "Response to: approve_after_steer:command",
        TURN_TIMEOUT_MS,
      );
      await waitForThreadStatus(
        harness.api,
        thread.id,
        "idle",
        TURN_TIMEOUT_MS,
      );
      await expect(
        getThreadOutput(harness.api, thread.id),
      ).resolves.not.toContain("Denied");

      const events = await getThreadEvents(harness.api, thread.id);
      const tellRequest = events.find(
        (event) =>
          event.type === "client/turn/requested" &&
          event.data.senderThreadId === sender.id,
      );
      expect(tellRequest).toMatchObject({
        data: { initiator: "agent" },
      });
      expect(
        events
          .filter((event) => event.type === "turn/completed")
          .slice(baselineCompleted)
          .map((event) => event.data.status),
      ).toEqual(["completed"]);
    }));
});
