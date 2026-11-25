import { threadScope, turnScope } from "@bb/domain";
import type { ThreadEventBackgroundTaskItem } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedEvent,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

interface BackgroundTaskFixture {
  environmentId: string;
  hostId: string;
  sessionId: string;
  threadId: string;
}

function backgroundTaskItem(args: {
  id: string;
  description: string;
  stoppable: boolean;
}): ThreadEventBackgroundTaskItem {
  return {
    type: "backgroundTask",
    id: args.id,
    familyId: `family-${args.id}`,
    taskType: "local_bash",
    description: args.description,
    status: "pending",
    taskStatus: "running",
    skipTranscript: false,
    foreground: false,
    ...(args.stoppable ? { stoppable: true as const } : {}),
  };
}

function seedBackgroundTaskFixture(
  harness: TestAppHarness,
): BackgroundTaskFixture {
  const { host, session } = seedHostSession(harness.deps);
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
  const tasks = [
    backgroundTaskItem({
      id: "bg-dev-server",
      description: "Run the dev server",
      stoppable: true,
    }),
    backgroundTaskItem({
      id: "bg-watcher",
      description: "Watch CI",
      stoppable: false,
    }),
    backgroundTaskItem({
      id: "bg-finished",
      description: "Build once",
      stoppable: true,
    }),
  ];
  tasks.forEach((item, index) => {
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environment.id,
      providerThreadId: "provider-thread-1",
      sequence: index + 1,
      type: "item/started",
      scope: turnScope("turn-1"),
      data: { providerThreadId: "provider-thread-1", item },
    });
  });
  seedEvent(harness.deps, {
    threadId: thread.id,
    environmentId: environment.id,
    providerThreadId: "provider-thread-1",
    sequence: tasks.length + 1,
    type: "item/backgroundTask/completed",
    scope: threadScope(),
    data: {
      providerThreadId: "provider-thread-1",
      item: {
        ...backgroundTaskItem({
          id: "bg-finished",
          description: "Build once",
          stoppable: true,
        }),
        status: "completed",
        taskStatus: "completed",
      },
    },
  });
  return {
    environmentId: environment.id,
    hostId: host.id,
    sessionId: session.id,
    threadId: thread.id,
  };
}

function stopRequest(
  harness: TestAppHarness,
  fixture: BackgroundTaskFixture,
  itemId: string,
): Promise<Response> {
  return Promise.resolve(
    harness.app.request(
      `/api/v1/threads/${fixture.threadId}/background-tasks/${itemId}/stop`,
      { method: "POST" },
    ),
  );
}

describe("public thread background tasks", () => {
  it("lists only running tasks and says which can be stopped", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedBackgroundTaskFixture(harness);

      const response = await harness.app.request(
        `/api/v1/threads/${fixture.threadId}/background-tasks`,
      );

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        backgroundTasks: [
          {
            itemId: "bg-dev-server",
            taskType: "local_bash",
            description: "Run the dev server",
            taskStatus: "running",
            stoppable: true,
          },
          {
            itemId: "bg-watcher",
            taskType: "local_bash",
            description: "Watch CI",
            taskStatus: "running",
            stoppable: false,
          },
        ],
      });
    });
  });

  it("asks the host to stop one stoppable running task", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedBackgroundTaskFixture(harness);
      const responder = registerHostRpcResponder(harness, {
        hostId: fixture.hostId,
        sessionId: fixture.sessionId,
        handle: ({ command }) => {
          expect(command).toEqual({
            type: "thread.background_task.stop",
            environmentId: fixture.environmentId,
            threadId: fixture.threadId,
            itemId: "bg-dev-server",
          });
          return { ok: true, result: { stopped: true } };
        },
      });

      const response = await stopRequest(harness, fixture, "bg-dev-server");

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        ok: true,
        progress: "in-progress",
      });
      expect(responder.requests).toHaveLength(1);
    });
  });

  it.each([
    {
      itemId: "bg-watcher",
      status: 409,
      label: "a task the provider cannot stop",
    },
    {
      itemId: "bg-finished",
      status: 404,
      label: "a task that already settled",
    },
    { itemId: "bg-unknown", status: 404, label: "an unknown task" },
  ])(
    "refuses $label without contacting the host",
    async ({ itemId, status }) => {
      await withTestHarness(async (harness) => {
        const fixture = seedBackgroundTaskFixture(harness);
        const responder = registerHostRpcResponder(harness, {
          hostId: fixture.hostId,
          sessionId: fixture.sessionId,
          handle: () => ({ ok: true, result: { stopped: true } }),
        });

        const response = await stopRequest(harness, fixture, itemId);

        expect(response.status).toBe(status);
        expect(responder.requests).toHaveLength(0);
      });
    },
  );

  it("reports a task the host no longer runs as not running", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedBackgroundTaskFixture(harness);
      registerHostRpcResponder(harness, {
        hostId: fixture.hostId,
        sessionId: fixture.sessionId,
        handle: () => ({ ok: true, result: { stopped: false } }),
      });

      const response = await stopRequest(harness, fixture, "bg-dev-server");

      expect(response.status).toBe(404);
    });
  });
});
