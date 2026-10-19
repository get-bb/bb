import {
  getThread,
  getThreadExecutionOverride,
  listEvents,
  listQueuedThreadMessages,
  upsertProjectExecutionDefaults,
} from "@bb/db";
import { threadSchema } from "@bb/domain";
import { sendMessageResponseSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { listQueuedThreadCommands } from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("scheduled pending thread follow-ups", () => {
  it.each(["defaults", "explicit"] as const)(
    "inherits the queued spawn execution settings selected by %s",
    async (selection) => {
      await withTestHarness(async (harness) => {
        const { host } = seedHostSession(harness.deps);
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
        });
        const sendAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
        const response = await harness.app.request("/api/v1/threads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            origin: "cli",
            projectId: project.id,
            providerId: "codex",
            environment: { type: "reuse", environmentId: environment.id },
            input: textInput("scheduled spawn"),
            sendAt,
            ...(selection === "explicit"
              ? {
                  model: "gpt-5",
                  reasoningLevel: "high",
                  permissionMode: "full",
                  serviceTier: "fast",
                }
              : {}),
          }),
        });
        expect(response.status).toBe(201);
        const thread = threadSchema.parse(await readJson(response));
        expect(thread.status).toBe("pending");
        expect(
          getThreadExecutionOverride(harness.db, thread.id)?.modelOverride,
        ).toBeNull();
        expect(listEvents(harness.db, { threadId: thread.id })).toEqual([]);
        const [spawn] = listQueuedThreadMessages(harness.db, thread.id);
        expect(spawn).toBeDefined();

        if (selection === "explicit") {
          upsertProjectExecutionDefaults(harness.db, {
            projectId: project.id,
            providerId: "codex",
            model: "different-project-model",
            reasoningLevel: "low",
            permissionMode: "auto",
            serviceTier: "default",
          });
        }

        const followup = await harness.app.request(
          `/api/v1/threads/${thread.id}/send`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              input: textInput("scheduled follow-up"),
              mode: "queue-if-active",
              sendAt,
            }),
          },
        );
        const result = await readJson(followup);
        expect(result).toMatchObject({ delivery: "queued" });
        expect(followup.status).toBe(200);
        const rows = listQueuedThreadMessages(harness.db, thread.id);
        expect(rows).toHaveLength(2);
        const queued = sendMessageResponseSchema.parse(result);
        expect(queued.delivery).toBe("queued");
        expect(rows[1]).toMatchObject({
          model: spawn.model,
          permissionMode: spawn.permissionMode,
          reasoningLevel: spawn.reasoningLevel,
          serviceTier: spawn.serviceTier,
          sendAt,
          content: JSON.stringify(textInput("scheduled follow-up")),
        });
        expect(getThread(harness.db, thread.id)?.status).toBe("pending");
        expect(
          listQueuedThreadCommands(harness, "thread.start", thread.id),
        ).toEqual([]);
      });
    },
  );
});
