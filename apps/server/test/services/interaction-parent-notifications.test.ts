import { describe, expect, it } from "vitest";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { waitForQueuedCommand } from "../helpers/commands.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("plugin interaction parent notifications", () => {
  it.each(["auto", "stuck"] as const)(
    "notifies a parent in %s mode while the child keeps running",
    async (parentNotifications) => {
      await withTestHarness(async (harness) => {
        const { host } = seedHostSession(harness.deps, {
          id: `host-plugin-question-${parentNotifications}`,
        });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
        });
        const parent = seedThread(harness.deps, {
          environmentId: environment.id,
          projectId: project.id,
        });
        seedThreadRuntimeState(harness.deps, {
          environmentId: environment.id,
          providerThreadId: "provider-parent",
          threadId: parent.id,
        });
        const child = seedThread(harness.deps, {
          environmentId: environment.id,
          parentThreadId: parent.id,
          parentNotifications,
          projectId: project.id,
          status: "active",
        });
        seedTurnStarted(harness.deps, {
          providerThreadId: "provider-child",
          threadId: child.id,
          turnId: "turn-child-question",
        });
        const controller = new AbortController();
        const pending =
          harness.deps.pendingInteractions.requestPluginInteraction({
            pluginId: "ask-user-question",
            threadId: child.id,
            rendererId: "ask-user-question",
            title: "Choose storage",
            payload: {
              questions: [
                {
                  id: "storage",
                  prompt: "Which storage should the worker use?",
                  shortLabel: "Choose storage",
                  multiSelect: false,
                  allowFreeText: true,
                  options: [
                    { value: "sqlite", label: "SQLite" },
                    { value: "files", label: "Files" },
                  ],
                },
              ],
            },
            presentation: {
              label: { pending: "Asking a question", completed: "Asked" },
              icon: { glyph: "MessageQuestion" },
            },
            describeSubmission: null,
            timeoutMs: 10_000,
            owner: { pluginId: "ask-user-question" },
            signal: controller.signal,
          });
        try {
          expect(
            harness.deps.pendingInteractions.listPendingThreadInteractions(
              child.id,
            ),
          ).toMatchObject([
            { origin: { kind: "plugin" }, status: "pending", turnId: null },
          ]);
          expect(
            harness.deps.pendingInteractions.hasTurnBoundPendingThreadInteraction(
              child.id,
            ),
          ).toBe(false);
          const notification = await waitForQueuedCommand(
            harness,
            ({ command }) =>
              command.type === "turn.submit" && command.threadId === parent.id,
          );
          expect(notification.command).toMatchObject({
            type: "turn.submit",
            input: expect.arrayContaining([
              expect.objectContaining({
                type: "text",
                text: expect.stringContaining(`@thread:${child.id}`),
              }),
            ]),
          });
          expect(JSON.stringify(notification.command)).toContain(
            "Choose storage",
          );
          expect(
            harness.deps.pendingInteractions.listPendingThreadInteractions(
              child.id,
            ),
          ).toMatchObject([{ status: "pending" }]);
        } finally {
          controller.abort();
          await pending;
        }
      });
    },
  );
});
