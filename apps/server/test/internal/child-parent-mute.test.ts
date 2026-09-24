// bb-fork(parent-mute): fork-owned coverage for the child->parent notification mute
import { getThread } from "@bb/db";
import { turnScope, threadSchema } from "@bb/domain";
import { groupHostDaemonEvents } from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import {
  internalAuthHeaders,
  waitForQueuedCommand,
  waitForQueuedCommandAfter,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { createTestAppHarness, withTestHarness } from "../helpers/test-app.js";

type TestHarness = Awaited<ReturnType<typeof createTestAppHarness>>;

interface MuteFixture {
  childThreadId: string;
  parentThreadId: string;
  sessionId: string;
}

function seedParentWithChild(
  harness: TestHarness,
  suffix: string,
): MuteFixture {
  const { host, session } = seedHostSession(harness.deps, {
    id: `host-${suffix}`,
  });
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const parentEnvironment = seedEnvironment(harness.deps, {
    hostId: host.id,
    path: `/tmp/${suffix}-parent`,
    projectId: project.id,
  });
  const childEnvironment = seedEnvironment(harness.deps, {
    hostId: host.id,
    path: `/tmp/${suffix}-child`,
    projectId: project.id,
  });
  const parentThread = seedThread(harness.deps, {
    environmentId: parentEnvironment.id,
    projectId: project.id,
    title: "Manager",
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: parentEnvironment.id,
    inputText: "Manage things",
    providerThreadId: `provider-parent-${suffix}`,
    threadId: parentThread.id,
  });
  const childThread = seedThread(harness.deps, {
    environmentId: childEnvironment.id,
    parentThreadId: parentThread.id,
    projectId: project.id,
    title: "Worker child",
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: childEnvironment.id,
    inputText: "Do the work",
    providerThreadId: `provider-child-${suffix}`,
    threadId: childThread.id,
  });
  return {
    childThreadId: childThread.id,
    parentThreadId: parentThread.id,
    sessionId: session.id,
  };
}

async function patchChild(
  harness: TestHarness,
  childThreadId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return await harness.app.request(`/api/v1/threads/${childThreadId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function completeChildTurn(
  harness: TestHarness,
  fixture: MuteFixture,
  suffix: string,
): Promise<void> {
  seedTurnStarted(harness.deps, {
    threadId: fixture.childThreadId,
    turnId: `turn-${suffix}`,
    providerThreadId: `provider-child-turn-${suffix}`,
  });
  const response = await harness.app.request("/internal/session/events", {
    method: "POST",
    headers: internalAuthHeaders(harness),
    body: JSON.stringify({
      sessionId: fixture.sessionId,
      eventGroups: groupHostDaemonEvents([
        {
          threadId: fixture.childThreadId,
          event: {
            type: "turn/completed",
            threadId: fixture.childThreadId,
            providerThreadId: `provider-child-turn-${suffix}`,
            scope: turnScope(`turn-${suffix}`),
            status: "completed",
          },
        },
      ]),
    }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
}

describe("child parent notification mute", () => {
  it("keeps the parent silent while muted and notifies again after unmute", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedParentWithChild(harness, "parent-mute");

      const muteResponse = await patchChild(harness, fixture.childThreadId, {
        parentNotificationsMuted: true,
      });
      expect(muteResponse.status).toBe(200);
      const muted = threadSchema.parse(await readJson(muteResponse));
      expect(muted.parentThreadId).toBe(fixture.parentThreadId);
      expect(muted.parentNotificationsMutedAt).not.toBeNull();
      expect(getThread(harness.db, fixture.childThreadId)).toMatchObject({
        parentThreadId: fixture.parentThreadId,
        parentNotificationsMutedAt: muted.parentNotificationsMutedAt,
      });

      await completeChildTurn(harness, fixture, "muted");
      await expect(
        waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "turn.submit" &&
            command.threadId === fixture.parentThreadId,
          2_600,
        ),
      ).rejects.toThrow("Timed out waiting for queued command");

      const unmuteResponse = await patchChild(harness, fixture.childThreadId, {
        parentNotificationsMuted: false,
      });
      expect(unmuteResponse.status).toBe(200);
      expect(
        threadSchema.parse(await readJson(unmuteResponse))
          .parentNotificationsMutedAt,
      ).toBeNull();

      await completeChildTurn(harness, fixture, "unmuted");
      const parentNotification = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "turn.submit" &&
          command.threadId === fixture.parentThreadId,
        6_000,
      );
      if (parentNotification.command.type !== "turn.submit") {
        throw new Error(
          `Expected parent turn command, got ${parentNotification.command.type}`,
        );
      }
      expect(JSON.stringify(parentNotification.command.input)).toContain(
        fixture.childThreadId,
      );
      await expect(
        waitForQueuedCommandAfter(
          harness,
          parentNotification.row.cursor,
          ({ command }) =>
            command.type === "turn.submit" &&
            command.threadId === fixture.parentThreadId,
          300,
        ),
      ).rejects.toThrow("Timed out waiting for queued command");
    });
  });

  it("accepts a mute on a root thread and keeps the parent link semantics", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-parent-mute-root",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const rootThread = seedThread(harness.deps, { projectId: project.id });

      const response = await patchChild(harness, rootThread.id, {
        parentNotificationsMuted: true,
      });

      expect(response.status).toBe(200);
      const muted = threadSchema.parse(await readJson(response));
      expect(muted.parentThreadId).toBeNull();
      expect(muted.parentNotificationsMutedAt).not.toBeNull();
    });
  });
});
