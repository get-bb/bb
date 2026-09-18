import { describe, expect, it } from "vitest";
import { withTestHarness } from "../helpers/test-app.js";
import {
  seedThreadFixture,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { createUserQuestionPayload } from "../helpers/pending-interactions.js";
import { readJson } from "../helpers/json.js";
import { waitForQueuedCommand } from "../helpers/commands.js";

describe("native async questions", () => {
  it.each(["idle", "active"] as const)(
    "sends an answer as a new user message while %s, once",
    async (status) => {
      await withTestHarness(async (harness) => {
        const { thread, environment } = seedThreadFixture(harness, {
          thread: { status },
        });
        seedThreadRuntimeState(harness.deps, {
          threadId: thread.id,
          environmentId: environment.id,
          providerThreadId: "native-thread",
        });
        if (status === "active")
          seedTurnStarted(harness.deps, {
            threadId: thread.id,
            turnId: "native-turn",
            providerThreadId: "native-thread",
          });
        const request = {
          threadId: thread.id,
          turnId: null,
          providerId: thread.providerId,
          providerThreadId: "native-thread",
          providerRequestId: "message:native-question",
          payload: createUserQuestionPayload(),
        };
        const registered =
          harness.deps.pendingInteractions.registerPendingInteraction({
            interaction: request,
          });
        if (registered.outcome === "rejected")
          throw new Error(registered.reason);
        expect(
          harness.deps.pendingInteractions.registerPendingInteraction({
            interaction: request,
          }).outcome,
        ).toBe("existing");
        expect(
          harness.deps.pendingInteractions.hasTurnBoundPendingThreadInteraction(
            thread.id,
          ),
        ).toBe(false);
        const question = request.payload.questions[0]!;
        const answer = {
          kind: "user_answer",
          answers: {
            [question.id]: {
              selected: [],
              freeText: "Use the staging environment",
            },
          },
        };
        const url = `/api/v1/threads/${thread.id}/interactions/${registered.interaction.id}/resolve`;
        const post = () =>
          harness.app.request(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(answer),
          });
        const response = await post();
        expect(
          response.status,
          JSON.stringify(await response.clone().json()),
        ).toBe(200);
        await expect(readJson(response)).resolves.toMatchObject({
          status: "resolved",
          resolution: answer,
        });
        const command = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "turn.submit" && command.threadId === thread.id,
        );
        expect(JSON.stringify(command.command)).toContain(
          "Use the staging environment",
        );
        expect(command.command.type).toBe("turn.submit");
        const duplicate = await post();
        expect(duplicate.status).toBe(200);
        const changed = await harness.app.request(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...answer,
            answers: { [question.id]: { selected: [], freeText: "Different" } },
          }),
        });
        expect(changed.status).toBe(409);
      });
    },
  );

  it("preserves async questions across a disconnect but rejects answers after explicit stop", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);
      const registered =
        harness.deps.pendingInteractions.registerPendingInteraction({
          interaction: {
            threadId: thread.id,
            turnId: null,
            providerId: thread.providerId,
            providerThreadId: "native-thread",
            providerRequestId: "message:persisted-question",
            payload: createUserQuestionPayload(),
          },
        });
      if (registered.outcome === "rejected") throw new Error(registered.reason);
      harness.deps.pendingInteractions.interruptPendingInteractionsForThreadIds(
        {
          threadIds: [thread.id],
          reason: "Host disconnected",
          preserveAsyncQuestions: true,
        },
      );
      expect(
        harness.deps.pendingInteractions.listPendingThreadInteractions(
          thread.id,
        ),
      ).toHaveLength(1);
      harness.deps.pendingInteractions.start();
      expect(
        harness.deps.pendingInteractions.listPendingThreadInteractions(
          thread.id,
        ),
      ).toHaveLength(1);
      harness.deps.pendingInteractions.interruptPendingInteractionsForThreadIds(
        { threadIds: [thread.id], reason: "thread-stopped" },
      );
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/interactions/${registered.interaction.id}/resolve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "user_answer",
            answers: {
              "question-1": { selected: [], freeText: "Late answer" },
            },
          }),
        },
      );
      expect(response.status).toBe(409);
    });
  });
});
