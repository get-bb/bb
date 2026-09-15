import { setPluginAgentContributions } from "../../src/services/plugins/plugin-agent-contributions.js";
import type { PluginAgentToolRecord } from "../../src/services/plugins/plugin-api.js";
import { eq } from "drizzle-orm";
import { events } from "@bb/db";
import { describe, expect, it, vi } from "vitest";
import { internalAuthHeaders } from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

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

it("interrupts a waiting interaction when the tool response body is cancelled and rejects late answers", async () => {
  await withTestHarness(async (harness) => {
    const { host, session } = seedHostSession(harness.deps, {
      id: "host-cancel-tool",
    });
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
    });
    const record: PluginAgentToolRecord = {
      name: "wait_for_user",
      description: "Wait",
      presentation: null,
      instructions: null,
      inputSchema: {},
      parse: (input) => ({ ok: true, value: input }),
      execute: () => "unused",
    };
    setPluginAgentContributions({
      listSkillRootContributions: () => [],
      listAgentTools: () => [],
      listInstructionContributions: () => [],
      findAgentTool: (name) =>
        name === record.name ? { pluginId: "fixture", record } : undefined,
      resolveMention: async () => ({ ok: false, error: "unused" }),
      invokeAgentTool: async ({ ctx }) => {
        const result =
          await harness.deps.pendingInteractions.requestPluginInteraction({
            pluginId: "fixture",
            rendererId: "question",
            threadId: ctx.threadId,
            title: "Question",
            payload: {},
            timeoutMs: 10_000,
            signal: ctx.signal,
          });
        return { success: result.outcome === "submitted", contentItems: [] };
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
            callId: "call",
            tool: record.name,
          }),
        },
      );
      const [interaction] =
        harness.deps.pendingInteractions.listPendingThreadInteractions(
          thread.id,
        );
      expect(interaction).toBeDefined();
      await response.body?.cancel();
      await vi.waitFor(() =>
        expect(
          harness.deps.pendingInteractions.getThreadInteraction({
            threadId: thread.id,
            interactionId: interaction!.id,
          }),
        ).toMatchObject({
          status: "interrupted",
          statusReason: "request-aborted",
        }),
      );
      const late = await harness.app.request(
        `/api/v1/threads/${thread.id}/interactions/${interaction!.id}/respond`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ value: "late answer" }),
        },
      );
      expect(late.status).toBe(409);
    } finally {
      harness.deps.pendingInteractions.interruptPluginInteractions("fixture");
      setPluginAgentContributions(undefined);
    }
  });
});
