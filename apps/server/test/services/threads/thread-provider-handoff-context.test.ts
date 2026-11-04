import { describe, expect, it } from "vitest";
import { threadScope, turnScope } from "@bb/domain";
import {
  seedEnvironment,
  seedEvent,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../../helpers/seed.js";
import { withTestHarness } from "../../helpers/test-app.js";
import { providerHandoffContextInput } from "../../../src/services/threads/thread-provider-handoff-context.js";

describe("provider handoff context", () => {
  it("passes prior user and assistant text to the new provider only", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        providerId: "claude-code",
        status: "idle",
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        inputText: "Fix the checkout flow",
        model: "gpt-6-astra",
        providerThreadId: "codex-session",
        threadId: thread.id,
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "codex-session",
        sequence: 3,
        type: "item/completed",
        scope: turnScope("turn-1"),
        data: {
          item: {
            type: "agentMessage",
            id: "agent-1",
            text: "The bug is in the payment step.",
          },
        },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 4,
        type: "system/operation",
        scope: threadScope(),
        data: {
          operation: "context_clear",
          operationId: "switch-1",
          status: "completed",
          message: "Provider changed",
          metadata: {
            visibleHistoryStartSequence: 0,
            providerSwitch: {
              fromProviderId: "codex",
              fromModel: "gpt-6-astra",
              toProviderId: "claude-code",
              toModel: "sonnet",
            },
          },
        },
      });

      const [seed] = providerHandoffContextInput(harness.deps, {
        threadId: thread.id,
        providerId: "claude-code",
      });
      expect(seed?.type).toBe("text");
      if (seed?.type !== "text") return;
      expect(seed.visibility).toBe("agent-only");
      expect(seed.text).toContain("User: Fix the checkout flow");
      expect(seed.text).toContain("Assistant: The bug is in the payment step.");
      expect(
        providerHandoffContextInput(harness.deps, {
          threadId: thread.id,
          providerId: "codex",
        }),
      ).toEqual([]);
    });
  });
});
