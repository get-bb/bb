import { setTimeout as sleep } from "node:timers/promises";
import type { ToolCallResponse } from "@bb/domain";
import { expect, it, vi } from "vitest";
import { setPluginAgentContributions } from "../../src/services/plugins/plugin-agent-contributions.js";
import { internalAuthHeaders } from "../helpers/commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

it.each(["complete", "cancel"])(
  "keeps an idle tool response readable and releases its heartbeat on %s",
  async (outcome) => {
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
      });
      const result: ToolCallResponse = {
        success: true,
        contentItems: [{ type: "inputText", text: "finished" }],
      };
      let completeTool!: (response: ToolCallResponse) => void;
      const pending = new Promise<ToolCallResponse>((resolve) => {
        completeTool = resolve;
      });
      let toolSignal: AbortSignal | undefined;
      setPluginAgentContributions({
        listSkillRootContributions: () => [],
        listAgentTools: () => [],
        listInstructionContributions: () => [],
        findAgentTool: (name) =>
          name === "idle_tool"
            ? {
                pluginId: "fixture",
                record: {
                  name,
                  description: "Idle tool",
                  presentation: null,
                  instructions: null,
                  inputSchema: {},
                  parse: (input) => ({ ok: true, value: input }),
                  execute: () => "unused",
                },
              }
            : undefined,
        invokeAgentTool: ({ ctx }) => {
          toolSignal = ctx.signal;
          return pending;
        },
        resolveMention: async () => ({ ok: false, error: "unused" }),
      });
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      const initialTimerCount = vi.getTimerCount();
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const response = await harness.app.request(
          "/internal/session/tool-call",
          {
            method: "POST",
            headers: internalAuthHeaders(harness),
            body: JSON.stringify({
              sessionId: session.id,
              threadId: thread.id,
              providerThreadId: "provider-idle",
              turnId: "turn-idle",
              callId: "call-idle",
              tool: "idle_tool",
            }),
          },
        );
        reader = response.body!.getReader();
        let responseText = "";
        for (let interval = 0; interval < 2; interval += 1) {
          const nextChunk = reader.read();
          await vi.advanceTimersByTimeAsync(30_000);
          const chunk = await Promise.race([
            nextChunk,
            sleep(100).then(() => null),
          ]);
          expect(
            chunk,
            "pending tools must send periodic body data",
          ).not.toBeNull();
          if (chunk === null) throw new Error("No tool response heartbeat");
          expect(chunk.done).toBe(false);
          expect(chunk.value?.byteLength).toBeGreaterThan(0);
          const heartbeatText = new TextDecoder().decode(chunk.value);
          expect(heartbeatText.trim()).toBe("");
          responseText += heartbeatText;
        }
        if (outcome === "cancel") {
          await reader.cancel();
          expect(toolSignal?.aborted).toBe(true);
        } else {
          completeTool(result);
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            responseText += new TextDecoder().decode(chunk.value);
          }
          expect(JSON.parse(responseText)).toEqual(result);
          expect(toolSignal?.aborted).toBe(false);
        }
        expect(vi.getTimerCount()).toBe(initialTimerCount);
      } finally {
        await reader?.cancel().catch(() => undefined);
        completeTool(result);
        vi.useRealTimers();
        setPluginAgentContributions(undefined);
      }
    });
  },
);
