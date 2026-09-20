import { setPluginAgentContributions } from "../../src/services/plugins/plugin-agent-contributions.js";
import type { PluginAgentToolRecord } from "../../src/services/plugins/plugin-api.js";
import { eq } from "drizzle-orm";
import { events } from "@bb/db";
import { describe, expect, it, vi } from "vitest";
import { internalAuthHeaders } from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  PLUGIN_TOOL_CALL_AWAITING_USER_RESULT_TEXT,
  detachActivePluginToolCallForUserInput,
} from "../../src/services/plugins/plugin-tool-calls.js";
import { listQueuedThreadCommands } from "../helpers/commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

describe("internal tool-call regressions", () => {
  it("rejects tool calls for threads owned by a different host", async () => {
    await withTestHarness(async (harness) => {
      const hostA = seedHostSession(harness.deps, { id: "host-tool-a" });
      const hostB = seedHostSession(harness.deps, { id: "host-tool-b" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: hostB.host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: hostB.host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });

      const response = await harness.app.request(
        "/internal/session/tool-call",
        {
          method: "POST",
          headers: internalAuthHeaders(harness),
          body: JSON.stringify({
            sessionId: hostA.session.id,
            threadId: thread.id,
            providerThreadId: "provider-cross-host",
            turnId: "turn-cross-host",
            callId: "call-cross-host",
            tool: "message_user",
            arguments: {
              text: "Should be rejected",
            },
          }),
        },
      );

      expect(response.status).toBe(403);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
      });
      expect(
        harness.db
          .select()
          .from(events)
          .where(eq(events.threadId, thread.id))
          .all(),
      ).toHaveLength(0);
    });
  });
});

function seedIdleProviderThread(harness: TestAppHarness, value: number) {
  const { host, session } = seedHostSession(harness.deps, {
    id: `host-detached-tool-${value}`,
  });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: `/tmp/detached-tool-${value}`,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: `/tmp/detached-tool-${value}`,
    status: "ready",
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status: "idle",
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    providerThreadId: `provider-detached-tool-${value}`,
    threadId: thread.id,
  });
  return { session, thread };
}

function installWaitingTool(
  harness: TestAppHarness,
  record: PluginAgentToolRecord,
  observe: (ctxSignal: AbortSignal) => void,
) {
  setPluginAgentContributions({
    listSkillRootContributions: () => [],
    listAgentTools: () => [],
    listInstructionContributions: () => [],
    findAgentTool: (name) =>
      name === record.name ? { pluginId: "fixture", record } : undefined,
    resolveMention: async () => ({ ok: false, error: "unused" }),
    invokeAgentTool: async ({ ctx }) => {
      observe(ctx.signal);
      const pending = harness.deps.pendingInteractions.requestPluginInteraction(
        {
          pluginId: "fixture",
          rendererId: "question",
          threadId: ctx.threadId,
          title: "Question",
          payload: {},
          presentation: {
            label: { pending: "Asking", completed: "Asked" },
            icon: { glyph: "MessageQuestion" },
          },
          describeSubmission: null,
          timeoutMs: 10_000,
          signal: ctx.signal,
        },
      );
      detachActivePluginToolCallForUserInput();
      const result = await pending;
      return result.outcome === "submitted"
        ? {
            success: true,
            contentItems: [
              { type: "inputText", text: `answered: ${String(result.value)}` },
            ],
          }
        : {
            success: false,
            contentItems: [
              { type: "inputText", text: `cancelled: ${result.reason}` },
            ],
          };
    },
  });
}

function turnRequestedEvents(harness: TestAppHarness, threadId: string) {
  return harness.db
    .select()
    .from(events)
    .where(eq(events.threadId, threadId))
    .all()
    .filter((row) => row.type === "client/turn/requested")
    .map((row) => JSON.parse(row.data) as Record<string, unknown>);
}

describe("plugin tool calls that outlive their round trip", () => {
  it("aborts an ordinary tool when the response stream is cancelled", async () => {
    await withTestHarness(async (harness) => {
      const { session, thread } = seedIdleProviderThread(harness, 3);
      const record: PluginAgentToolRecord = {
        name: "ordinary_tool",
        description: "Work without a form",
        presentation: null,
        instructions: null,
        inputSchema: {},
        parse: (input) => ({ ok: true, value: input }),
        execute: () => "unused",
      };
      let toolSignal: AbortSignal | undefined;
      let finish!: () => void;
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const initialRequests = turnRequestedEvents(harness, thread.id);
      setPluginAgentContributions({
        listSkillRootContributions: () => [],
        listAgentTools: () => [],
        listInstructionContributions: () => [],
        findAgentTool: (name) =>
          name === record.name ? { pluginId: "fixture", record } : undefined,
        resolveMention: async () => ({ ok: false, error: "unused" }),
        invokeAgentTool: async ({ ctx }) => {
          toolSignal = ctx.signal;
          await finished;
          return {
            success: true,
            contentItems: [{ type: "inputText", text: "done" }],
          };
        },
      });
      try {
        const response = await harness.app.request(
          "/internal/session/tool-call",
          {
            method: "POST",
            headers: internalAuthHeaders(harness),
            body: JSON.stringify({
              sessionId: session.id,
              threadId: thread.id,
              providerThreadId: "provider-thread",
              turnId: "turn",
              callId: "ordinary-call",
              tool: record.name,
            }),
          },
        );
        expect(toolSignal?.aborted).toBe(false);
        await response.body!.cancel();
        expect(toolSignal?.aborted).toBe(true);
        finish();
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(
          listQueuedThreadCommands(harness, "turn.submit", thread.id),
        ).toHaveLength(0);
        expect(turnRequestedEvents(harness, thread.id)).toEqual(
          initialRequests,
        );
      } finally {
        finish();
        setPluginAgentContributions(undefined);
      }
    });
  });

  it("answers the round trip with a waiting notice, keeps the card open, and delivers the answer as a system message", async () => {
    await withTestHarness(async (harness) => {
      const { session, thread } = seedIdleProviderThread(harness, 1);
      const record: PluginAgentToolRecord = {
        name: "wait_for_user",
        description: "Wait",
        presentation: { label: { pending: "Asking", completed: "Asked" } },
        instructions: null,
        inputSchema: {},
        parse: (input) => ({ ok: true, value: input }),
        execute: () => "unused",
      };
      let toolSignal: AbortSignal | undefined;
      installWaitingTool(harness, record, (signal) => {
        toolSignal = signal;
      });
      try {
        const response = await harness.app.request(
          "/internal/session/tool-call",
          {
            method: "POST",
            headers: internalAuthHeaders(harness),
            body: JSON.stringify({
              sessionId: session.id,
              threadId: thread.id,
              providerThreadId: "provider-thread",
              turnId: "turn",
              callId: "call-1",
              tool: record.name,
            }),
          },
        );
        await expect(response.json()).resolves.toEqual({
          success: true,
          contentItems: [
            {
              type: "inputText",
              text: PLUGIN_TOOL_CALL_AWAITING_USER_RESULT_TEXT,
            },
          ],
        });
        const [interaction] =
          harness.deps.pendingInteractions.listPendingThreadInteractions(
            thread.id,
          );
        expect(interaction).toBeDefined();

        expect(toolSignal?.aborted).toBe(false);
        expect(
          harness.deps.pendingInteractions.getThreadInteraction({
            threadId: thread.id,
            interactionId: interaction!.id,
          }),
        ).toMatchObject({ status: "pending" });

        const late = await harness.app.request(
          `/api/v1/threads/${thread.id}/interactions/${interaction!.id}/respond`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ value: "late answer" }),
          },
        );
        expect(late.status).toBe(200);

        await vi.waitFor(() => {
          expect(
            listQueuedThreadCommands(harness, "turn.submit", thread.id),
          ).toHaveLength(1);
        });
        const [command] = listQueuedThreadCommands(
          harness,
          "turn.submit",
          thread.id,
        );
        expect(command).toMatchObject({
          input: [
            expect.objectContaining({
              type: "text",
              text: expect.stringContaining("answered: late answer"),
            }),
          ],
        });
        const delivered = turnRequestedEvents(harness, thread.id).at(-1);
        expect(delivered).toMatchObject({
          initiator: "system",
          systemMessageKind: "tool-result-delivered",
          systemMessageSubject: {
            kind: "tool-call",
            toolName: "wait_for_user",
            suppress: false,
          },
          target: { kind: "new-turn" },
        });
      } finally {
        harness.deps.pendingInteractions.interruptPluginInteractions("fixture");
        setPluginAgentContributions(undefined);
      }
    });
  });

  it("does not wake an idle thread for a failed detached result", async () => {
    await withTestHarness(async (harness) => {
      const { session, thread } = seedIdleProviderThread(harness, 2);
      const record: PluginAgentToolRecord = {
        name: "wait_for_user",
        description: "Wait",
        presentation: null,
        instructions: null,
        inputSchema: {},
        parse: (input) => ({ ok: true, value: input }),
        execute: () => "unused",
      };
      installWaitingTool(harness, record, () => undefined);
      try {
        const response = await harness.app.request(
          "/internal/session/tool-call",
          {
            method: "POST",
            headers: internalAuthHeaders(harness),
            body: JSON.stringify({
              sessionId: session.id,
              threadId: thread.id,
              providerThreadId: "provider-thread",
              turnId: "turn",
              callId: "call-2",
              tool: record.name,
            }),
          },
        );
        await response.json();
        const [interaction] =
          harness.deps.pendingInteractions.listPendingThreadInteractions(
            thread.id,
          );

        harness.deps.pendingInteractions.cancelPluginInteraction({
          interactionId: interaction!.id,
          threadId: thread.id,
          reason: "user",
        });
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(
          listQueuedThreadCommands(harness, "turn.submit", thread.id),
        ).toHaveLength(0);
        expect(turnRequestedEvents(harness, thread.id)).toHaveLength(1);
      } finally {
        setPluginAgentContributions(undefined);
      }
    });
  });
});
