import { getThread, listEvents } from "@bb/db";
import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
} from "@bb/domain";
import { describe, expect, it } from "vitest";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedEvent,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

interface BannerFixture {
  environmentId: string;
  hostId: string;
  projectId: string;
  sessionId: string;
  threadId: string;
}

function seedBannerFixture(
  harness: TestAppHarness,
  args: { status: "active" | "idle" },
): BannerFixture {
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
    providerId: "codex",
    status: args.status,
  });
  return {
    environmentId: environment.id,
    hostId: host.id,
    projectId: project.id,
    sessionId: session.id,
    threadId: thread.id,
  };
}

function seedActivePlan(harness: TestAppHarness, fixture: BannerFixture): void {
  const requestId = encodeClientTurnRequestIdNumber({ value: 1 });
  seedEvent(harness.deps, {
    threadId: fixture.threadId,
    environmentId: fixture.environmentId,
    sequence: 1,
    type: "client/turn/requested",
    scope: threadScope(),
    data: {
      direction: "outbound",
      requestId,
      input: [
        {
          type: "text",
          text: "/plan verify cancellation",
          mentions: [
            {
              start: 0,
              end: 5,
              resource: {
                kind: "command",
                trigger: "/",
                name: "plan",
                source: "command",
                origin: "user",
                label: "plan",
                argumentHint: null,
              },
            },
          ],
        },
      ],
      target: { kind: "new-turn" },
      execution: {
        model: "gpt-5",
        serviceTier: "default",
        reasoningLevel: "medium",
        permissionMode: "full",
        source: "client/turn/requested",
      },
      initiator: "user",
      senderThreadId: null,
      request: { method: "turn/start", params: {} },
      source: "tell",
    },
  });
  seedEvent(harness.deps, {
    threadId: fixture.threadId,
    environmentId: fixture.environmentId,
    providerThreadId: "provider-thread-1",
    sequence: 2,
    type: "turn/input/accepted",
    scope: turnScope("turn-plan-1"),
    data: {
      providerThreadId: "provider-thread-1",
      clientRequestId: requestId,
    },
  });
  seedTurnStarted(harness.deps, {
    environmentId: fixture.environmentId,
    providerThreadId: "provider-thread-1",
    sequence: 3,
    threadId: fixture.threadId,
    turnId: "turn-plan-1",
  });
}

function seedActiveGoal(harness: TestAppHarness, fixture: BannerFixture): void {
  seedThreadRuntimeState(harness.deps, {
    environmentId: fixture.environmentId,
    providerThreadId: "provider-thread-1",
    sequenceStart: 1,
    threadId: fixture.threadId,
  });
  seedEvent(harness.deps, {
    threadId: fixture.threadId,
    environmentId: fixture.environmentId,
    providerThreadId: "provider-thread-1",
    sequence: 3,
    type: "thread/goal/updated",
    scope: threadScope(),
    data: {
      providerThreadId: "provider-thread-1",
      objective: "Verify authoritative Goal cancellation",
      status: "active",
      tokenBudget: null,
      tokensUsed: 100,
      timeUsedSeconds: 10,
    },
  });
}

async function readBannerActivity(
  harness: TestAppHarness,
  fixture: BannerFixture,
): Promise<{ activeGoalCount: number; activePlanModeCount: number }> {
  const response = await harness.app.request(
    `/api/v1/threads?projectId=${fixture.projectId}`,
  );
  expect(response.status).toBe(200);
  const threads = (await readJson(response)) as Array<{
    id: string;
    activity: { activeGoalCount: number; activePlanModeCount: number };
  }>;
  const thread = threads.find((entry) => entry.id === fixture.threadId);
  if (!thread) throw new Error(`Missing thread ${fixture.threadId}`);
  return thread.activity;
}

describe("public thread banner actions", () => {
  it("persists a successful Plan cancellation and returns zero after refetch", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedBannerFixture(harness, { status: "active" });
      seedActivePlan(harness, fixture);
      const responder = registerHostRpcResponder(harness, {
        hostId: fixture.hostId,
        sessionId: fixture.sessionId,
        handle: ({ command }) => {
          expect(command).toMatchObject({
            type: "thread.plan.cancel",
            threadId: fixture.threadId,
            expectedTurnId: "turn-plan-1",
          });
          return { ok: true, result: { cancelled: true } };
        },
      });

      const response = await harness.app.request(
        `/api/v1/threads/${fixture.threadId}/plan/cancel`,
        { method: "POST" },
      );

      expect(
        response.status,
        JSON.stringify(await readJson(response.clone())),
      ).toBe(200);
      expect(responder.requests).toHaveLength(1);
      await expect(readBannerActivity(harness, fixture)).resolves.toMatchObject(
        {
          activePlanModeCount: 0,
        },
      );
      await expect(readBannerActivity(harness, fixture)).resolves.toMatchObject(
        {
          activePlanModeCount: 0,
        },
      );
    });
  });

  it("keeps Plan active when provider cancellation fails", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedBannerFixture(harness, { status: "active" });
      seedActivePlan(harness, fixture);
      registerHostRpcResponder(harness, {
        hostId: fixture.hostId,
        sessionId: fixture.sessionId,
        handle: () => ({
          ok: false,
          errorCode: "provider_error",
          errorMessage: "Plan cancellation failed",
        }),
      });

      const response = await harness.app.request(
        `/api/v1/threads/${fixture.threadId}/plan/cancel`,
        { method: "POST" },
      );

      expect(response.status).not.toBe(200);
      expect(getThread(harness.db, fixture.threadId)?.status).toBe("active");
      await expect(readBannerActivity(harness, fixture)).resolves.toMatchObject(
        {
          activePlanModeCount: 1,
        },
      );
    });
  });

  it("does not finalize the thread when a stale Plan cancellation finds a newer turn", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedBannerFixture(harness, { status: "active" });
      seedActivePlan(harness, fixture);
      const responder = registerHostRpcResponder(harness, {
        hostId: fixture.hostId,
        sessionId: fixture.sessionId,
        handle: ({ command }) => {
          expect(command).toMatchObject({
            type: "thread.plan.cancel",
            threadId: fixture.threadId,
            expectedTurnId: "turn-plan-1",
          });
          return { ok: true, result: { cancelled: false } };
        },
      });

      const response = await harness.app.request(
        `/api/v1/threads/${fixture.threadId}/plan/cancel`,
        { method: "POST" },
      );

      expect(response.status).toBe(409);
      expect(responder.requests).toHaveLength(1);
      expect(getThread(harness.db, fixture.threadId)?.status).toBe("active");
      expect(
        listEvents(harness.db, { threadId: fixture.threadId }).some(
          (event) => event.type === "system/thread/interrupted",
        ),
      ).toBe(false);
      await expect(readBannerActivity(harness, fixture)).resolves.toMatchObject(
        { activePlanModeCount: 1 },
      );
    });
  });

  it("does not finalize a newer server turn when the daemon reports the Plan turn cancelled", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedBannerFixture(harness, { status: "active" });
      seedActivePlan(harness, fixture);
      registerHostRpcResponder(harness, {
        hostId: fixture.hostId,
        sessionId: fixture.sessionId,
        handle: ({ command }) => {
          expect(command).toMatchObject({
            type: "thread.plan.cancel",
            expectedTurnId: "turn-plan-1",
          });
          seedTurnStarted(harness.deps, {
            environmentId: fixture.environmentId,
            providerThreadId: "provider-thread-1",
            sequence: 4,
            threadId: fixture.threadId,
            turnId: "turn-newer-2",
          });
          return { ok: true, result: { cancelled: true } };
        },
      });

      const response = await harness.app.request(
        `/api/v1/threads/${fixture.threadId}/plan/cancel`,
        { method: "POST" },
      );

      expect(response.status).toBe(409);
      expect(getThread(harness.db, fixture.threadId)?.status).toBe("active");
      expect(
        listEvents(harness.db, { threadId: fixture.threadId }).some(
          (event) => event.type === "system/thread/interrupted",
        ),
      ).toBe(false);
      await expect(readBannerActivity(harness, fixture)).resolves.toMatchObject(
        { activePlanModeCount: 1 },
      );
    });
  });

  it("accepts a stale Plan cancellation only after provider events show the Plan turn ended", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedBannerFixture(harness, { status: "active" });
      seedActivePlan(harness, fixture);
      registerHostRpcResponder(harness, {
        hostId: fixture.hostId,
        sessionId: fixture.sessionId,
        handle: () => {
          seedEvent(harness.deps, {
            threadId: fixture.threadId,
            environmentId: fixture.environmentId,
            providerThreadId: "provider-thread-1",
            sequence: 4,
            type: "turn/completed",
            scope: turnScope("turn-plan-1"),
            data: {
              providerThreadId: "provider-thread-1",
              status: "completed",
            },
          });
          return { ok: true, result: { cancelled: false } };
        },
      });

      const response = await harness.app.request(
        `/api/v1/threads/${fixture.threadId}/plan/cancel`,
        { method: "POST" },
      );

      expect(response.status).toBe(200);
      expect(
        listEvents(harness.db, { threadId: fixture.threadId }).some(
          (event) => event.type === "system/thread/interrupted",
        ),
      ).toBe(false);
      await expect(readBannerActivity(harness, fixture)).resolves.toMatchObject(
        { activePlanModeCount: 0 },
      );
    });
  });

  it("refuses to clear a Goal on a thread that has none, whatever its provider", async () => {
    // No provider gate: a Goal is provider extension state, so the only
    // question is whether this thread has one. The 409 code is unchanged
    // from the old provider check; the message names the real reason.
    await withTestHarness(async (harness) => {
      const fixture = seedBannerFixture(harness, { status: "idle" });
      const response = await harness.app.request(
        `/api/v1/threads/${fixture.threadId}/goal/clear`,
        { method: "POST" },
      );
      expect(response.status).toBe(409);
      expect(await readJson(response)).toMatchObject({
        code: "invalid_request",
        message: "No active Goal to clear",
      });
    });
  });

  it("persists a successful Goal clear and returns zero after refetch", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedBannerFixture(harness, { status: "idle" });
      seedActiveGoal(harness, fixture);
      const responder = registerHostRpcResponder(harness, {
        hostId: fixture.hostId,
        sessionId: fixture.sessionId,
        handle: ({ command }) => {
          if (command.type === "host.list_files") {
            return { ok: true, result: { files: [], truncated: false } };
          }
          if (command.type === "host.read_file") {
            return {
              ok: false,
              errorCode: "ENOENT",
              errorMessage: `Path does not exist: ${command.path}`,
            };
          }
          expect(command).toMatchObject({
            type: "thread.goal.clear",
            threadId: fixture.threadId,
          });
          seedEvent(harness.deps, {
            threadId: fixture.threadId,
            environmentId: fixture.environmentId,
            providerThreadId: "provider-thread-1",
            sequence: 4,
            type: "thread/goal/cleared",
            scope: threadScope(),
            data: { providerThreadId: "provider-thread-1" },
          });
          return { ok: true, result: { cleared: true } };
        },
      });

      const response = await harness.app.request(
        `/api/v1/threads/${fixture.threadId}/goal/clear`,
        { method: "POST" },
      );

      expect(
        response.status,
        JSON.stringify(await readJson(response.clone())),
      ).toBe(200);
      expect(
        responder.requests.some(
          ({ command }) => command.type === "thread.goal.clear",
        ),
      ).toBe(true);
      await expect(readBannerActivity(harness, fixture)).resolves.toMatchObject(
        {
          activeGoalCount: 0,
        },
      );
      await expect(readBannerActivity(harness, fixture)).resolves.toMatchObject(
        {
          activeGoalCount: 0,
        },
      );
    });
  });

  it("accepts a stale Goal clear result after provider events persist the clear", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedBannerFixture(harness, { status: "idle" });
      seedActiveGoal(harness, fixture);
      registerHostRpcResponder(harness, {
        hostId: fixture.hostId,
        sessionId: fixture.sessionId,
        handle: ({ command }) => {
          if (command.type === "host.list_files") {
            return { ok: true, result: { files: [], truncated: false } };
          }
          if (command.type === "host.read_file") {
            return {
              ok: false,
              errorCode: "ENOENT",
              errorMessage: `Path does not exist: ${command.path}`,
            };
          }
          expect(command).toMatchObject({
            type: "thread.goal.clear",
            threadId: fixture.threadId,
          });
          seedEvent(harness.deps, {
            threadId: fixture.threadId,
            environmentId: fixture.environmentId,
            providerThreadId: "provider-thread-1",
            sequence: 4,
            type: "thread/goal/cleared",
            scope: threadScope(),
            data: { providerThreadId: "provider-thread-1" },
          });
          return { ok: true, result: { cleared: false } };
        },
      });

      const response = await harness.app.request(
        `/api/v1/threads/${fixture.threadId}/goal/clear`,
        { method: "POST" },
      );

      expect(
        response.status,
        JSON.stringify(await readJson(response.clone())),
      ).toBe(200);
      await expect(readBannerActivity(harness, fixture)).resolves.toMatchObject(
        {
          activeGoalCount: 0,
        },
      );
    });
  });

  it("keeps Goal active when provider cancellation fails", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedBannerFixture(harness, { status: "idle" });
      seedActiveGoal(harness, fixture);
      const responder = registerHostRpcResponder(harness, {
        hostId: fixture.hostId,
        sessionId: fixture.sessionId,
        handle: ({ command }) => {
          if (command.type === "host.list_files") {
            return { ok: true, result: { files: [], truncated: false } };
          }
          if (command.type === "host.read_file") {
            return {
              ok: false,
              errorCode: "ENOENT",
              errorMessage: `Path does not exist: ${command.path}`,
            };
          }
          return { ok: true, result: { cleared: false } };
        },
      });

      const response = await harness.app.request(
        `/api/v1/threads/${fixture.threadId}/goal/clear`,
        { method: "POST" },
      );

      expect(
        response.status,
        JSON.stringify(await readJson(response.clone())),
      ).toBe(409);
      expect(
        responder.requests.some(
          ({ command }) => command.type === "thread.goal.clear",
        ),
      ).toBe(true);
      await expect(readBannerActivity(harness, fixture)).resolves.toMatchObject(
        {
          activeGoalCount: 1,
        },
      );
    });
  });
});
