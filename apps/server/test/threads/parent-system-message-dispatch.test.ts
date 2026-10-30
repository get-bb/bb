import { getThread, listEvents, listQueuedThreadMessages } from "@bb/db";
import { turnRequestEventDataSchema, turnScope } from "@bb/domain";
import { groupHostDaemonEvents } from "@bb/host-daemon-contract";
import { createDeferredPromise } from "@bb/test-helpers";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as commands from "../../src/services/threads/thread-commands.js";
import { queueParentSystemMessage } from "../../src/services/threads/parent-system-messages.js";
import {
  internalAuthHeaders,
  listQueuedThreadCommands,
} from "../helpers/commands.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

afterEach(() => vi.restoreAllMocks());

describe("parent system message dispatch", () => {
  it.each(["active", "idle"] as const)(
    "delivers exactly one notice when an initially %s parent changes status during preparation",
    async (status) => {
      await withTestHarness(async (harness) => {
        const { host, session } = seedHostSession(harness.deps);
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
          path: "/tmp/parent-notice-dispatch",
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
          path: "/tmp/parent-notice-dispatch",
          status: "ready",
        });
        const thread = seedThread(harness.deps, {
          projectId: project.id,
          environmentId: environment.id,
          status,
        });
        seedThreadRuntimeState(harness.deps, {
          environmentId: environment.id,
          providerThreadId: "provider-parent-notice",
          threadId: thread.id,
        });
        if (status === "active") {
          seedTurnStarted(harness.deps, {
            threadId: thread.id,
            turnId: "turn-race",
          });
        }

        const entered = createDeferredPromise<void>();
        const release = createDeferredPromise<void>();
        const prepare = commands.prepareTurnSubmitCommandPayload;
        vi.spyOn(
          commands,
          "prepareTurnSubmitCommandPayload",
        ).mockImplementationOnce(async (...args) => {
          const prepared = await prepare(...args);
          entered.resolve();
          await release.promise;
          return prepared;
        });
        const input = textInput("A child finished its work.");
        const subject = {
          kind: "thread",
          threadId: "child-race",
          threadName: "Child",
        } as const;
        const sending = queueParentSystemMessage(harness.deps, {
          input,
          parentThreadId: thread.id,
          systemMessageKind: "child-completed",
          systemMessageSubject: subject,
        });
        const delivered = expect(sending).resolves.toBe(true);
        try {
          await entered.promise;
          const event =
            status === "active"
              ? {
                  type: "turn/completed" as const,
                  status: "completed" as const,
                }
              : { type: "turn/started" as const };
          const response = await harness.app.request(
            "/internal/session/events",
            {
              method: "POST",
              headers: internalAuthHeaders(harness),
              body: JSON.stringify({
                sessionId: session.id,
                eventGroups: groupHostDaemonEvents([
                  {
                    threadId: thread.id,
                    event: {
                      ...event,
                      threadId: thread.id,
                      providerThreadId: "provider-parent-notice",
                      scope: turnScope("turn-race"),
                    },
                  },
                ]),
              }),
            },
          );
          expect(response.status, await response.clone().text()).toBe(200);
          expect(getThread(harness.db, thread.id)?.status).toBe(
            status === "active" ? "idle" : "active",
          );
        } finally {
          release.resolve();
          await delivered;
        }

        const requests = listEvents(harness.db, { threadId: thread.id })
          .filter((event) => event.type === "client/turn/requested")
          .map((event) =>
            turnRequestEventDataSchema.parse(JSON.parse(event.data)),
          )
          .filter((event) => event.initiator === "system");
        expect(requests).toEqual([
          expect.objectContaining({
            input,
            initiator: "system",
            systemMessageKind: "child-completed",
            systemMessageSubject: subject,
          }),
        ]);
        expect(
          listQueuedThreadCommands(harness, "turn.submit", thread.id),
        ).toEqual([
          expect.objectContaining({
            input,
            target:
              status === "active"
                ? { mode: "start" }
                : { mode: "auto", expectedTurnId: "turn-race" },
          }),
        ]);
        expect(listQueuedThreadMessages(harness.db, thread.id)).toEqual([]);
      });
    },
  );
});
