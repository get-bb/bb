import { getThreadEventScopeTurnId } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { getThreadEvents, sendTextMessage } from "../../helpers/api.js";
import {
  waitForEventType,
  waitForThreadStatus,
} from "../../helpers/assertions.js";
import { withHarness } from "../../helpers/harness.js";
import {
  createProjectFixture,
  createReadyThread,
  TURN_TIMEOUT_MS,
} from "./shared.js";

describe.sequential("fake provider tool-call integration", () => {
  it("resolves unresolved provider turn ids before tool results unblock the provider", () =>
    withHarness(async (harness) => {
      const project = await createProjectFixture(
        harness,
        "Tool Call Turn Repair",
      );
      const { thread } = await createReadyThread(harness, {
        projectId: project.id,
        workspace: {
          type: "unmanaged",
          path: harness.repoDir,
        },
      });

      await sendTextMessage(harness.api, thread.id, {
        text: "call_tool_unresolved:notify_user",
      });
      const completedEvent = await waitForEventType(
        harness.api,
        thread.id,
        "turn/completed",
        TURN_TIMEOUT_MS,
      );
      await waitForThreadStatus(
        harness.api,
        thread.id,
        "idle",
        TURN_TIMEOUT_MS,
      );

      const resolvedTurnId = getThreadEventScopeTurnId(completedEvent.scope);
      if (!resolvedTurnId) {
        throw new Error("Expected completed tool turn to be turn-scoped");
      }

      const events = await getThreadEvents(harness.api, thread.id);
      const turnStartedEvent = events.find(
        (event) =>
          event.type === "turn/started" &&
          getThreadEventScopeTurnId(event.scope) === resolvedTurnId,
      );
      if (!turnStartedEvent) {
        throw new Error(
          `Expected turn/started for resolved turn ${resolvedTurnId}`,
        );
      }

      expect(turnStartedEvent.seq).toBeLessThan(completedEvent.seq);
    }));
});
