import { describe, expect, it, vi } from "vitest";
import {
  getLastStoredProviderThreadId,
  getThread,
  getThreadExecutionOverride,
  listStoredEventRows,
} from "@bb/db";
import {
  THREAD_SESSION_OPTION_SELECTIONS_STATE_KIND,
  threadScope,
} from "@bb/domain";
import {
  EMPTY_WORKSPACE_AGENT_CONTEXT,
  registerHostRpcResponder,
} from "../helpers/host-rpc.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";
import { providerHandoffContextInput } from "../../src/services/threads/thread-provider-handoff-context.js";
import { appendThreadEvent } from "../../src/services/threads/thread-events.js";
import { resolvePendingThreadSessionOptions } from "../../src/services/threads/thread-session-options.js";
import { resolveVisibleThreadHistoryStart } from "../../src/services/threads/thread-visible-history.js";

describe("PATCH /threads/:id provider switch", () => {
  it("keeps the thread, marks the change, and seeds the new provider", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "codex",
        status: "idle",
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        inputText: "Keep the current chat",
        model: "gpt-6-astra",
        providerThreadId: "old-provider-session",
        threadId: thread.id,
      });
      appendThreadEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        type: "thread/extensionState/updated",
        scope: threadScope(),
        data: {
          providerThreadId: "old-provider-session",
          kind: THREAD_SESSION_OPTION_SELECTIONS_STATE_KIND,
          payload: { selections: { oldProviderOption: true } },
        },
      });
      expect(resolvePendingThreadSessionOptions(harness.db, thread.id)).toEqual(
        {
          oldProviderOption: true,
        },
      );
      const rpc = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: ({ command }) => {
          if (command.type === "provider.list_models") {
            return {
              ok: true,
              result: {
                models: [
                  {
                    id: "sonnet",
                    model: "sonnet",
                    displayName: "Sonnet",
                    description: "",
                    reasoningDiscovery: "known" as const,
                    supportedReasoningEfforts: [
                      { reasoningEffort: "medium" as const, description: "" },
                    ],
                    defaultReasoningEffort: "medium" as const,
                    isDefault: true,
                  },
                ],
                selectedOnlyModels: [],
              },
            };
          }
          if (command.type === "thread.stop") {
            return {
              ok: true,
              result: { providerCheckpointId: null },
            };
          }
          if (command.type === "host.read_workspace_agent_context") {
            return { ok: true, result: EMPTY_WORKSPACE_AGENT_CONTEXT };
          }
          if (command.type === "thread.start") {
            return {
              ok: true,
              result: { providerThreadId: "new-provider-session" },
            };
          }
          throw new Error(`Unexpected RPC ${command.type}`);
        },
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            providerId: "claude-code",
            model: "sonnet",
            reasoningLevel: "medium",
          }),
        },
      );

      expect(response.status).toBe(200);
      expect((await response.json()).id).toBe(thread.id);
      expect(getThread(harness.db, thread.id)?.providerId).toBe("claude-code");
      expect(getThreadExecutionOverride(harness.db, thread.id)).toEqual({
        modelOverride: "sonnet",
        reasoningLevelOverride: "medium",
      });
      expect(getLastStoredProviderThreadId(harness.db, thread.id)).toBeNull();
      expect(
        resolveVisibleThreadHistoryStart(harness.db, { threadId: thread.id }),
      ).toBe(0);
      const timeline = await harness.app.request(
        `/api/v1/threads/${thread.id}/timeline`,
      );
      expect(timeline.status).toBe(200);
      const timelineRows = JSON.stringify((await timeline.json()).rows);
      expect(timelineRows).toContain("Keep the current chat");
      expect(timelineRows).toContain("provider-switch");
      expect(resolvePendingThreadSessionOptions(harness.db, thread.id)).toEqual(
        {},
      );
      expect(
        listStoredEventRows(harness.db, {
          threadId: thread.id,
          types: ["system/operation"],
        }).some((row) => row.data.includes("providerSwitch")),
      ).toBe(true);
      expect(
        providerHandoffContextInput(harness.deps, {
          threadId: thread.id,
          providerId: "claude-code",
        })[0],
      ).toMatchObject({
        type: "text",
        visibility: "agent-only",
        text: expect.stringContaining("User: Keep the current chat"),
      });
      expect(
        rpc.requests.some(({ command }) => command.type === "thread.stop"),
      ).toBe(true);

      const send = await harness.app.request(
        `/api/v1/threads/${thread.id}/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            input: [{ type: "text", text: "Continue the work" }],
            mode: "auto",
            model: "sonnet",
            reasoningLevel: "medium",
            permissionMode: "full",
            serviceTier: "default",
          }),
        },
      );
      expect(send.status).toBe(200);
      await vi.waitFor(() => {
        const start = rpc.requests.find(
          ({ command }) => command.type === "thread.start",
        )?.command;
        expect(start?.type).toBe("thread.start");
        if (start?.type !== "thread.start") return;
        expect(start.threadId).toBe(thread.id);
        expect(start.providerId).toBe("claude-code");
        expect(start.input[0]).toMatchObject({
          type: "text",
          visibility: "agent-only",
          text: expect.stringContaining("User: Keep the current chat"),
        });
        expect(start.input[1]).toMatchObject({
          type: "text",
          text: "Continue the work",
        });
      });
    });
  });
});
