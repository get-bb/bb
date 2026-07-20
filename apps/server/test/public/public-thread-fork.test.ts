import { getThread, listEvents } from "@bb/db";
import { turnRequestEventDataSchema } from "@bb/domain";
import { threadResponseSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { waitForQueuedCommand } from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function seedForkSource(
  harness: TestAppHarness,
  args: {
    model?: string;
    permissionMode?: "accept-edits" | "auto" | "full";
    reasoningLevel?: string;
    serviceTier?: string;
  } = {},
) {
  const { host } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: "/tmp/public-thread-fork",
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: "/tmp/public-thread-fork",
  });
  const sourceThread = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    ...(args.model === undefined ? {} : { model: args.model }),
    permissionMode: args.permissionMode ?? "full",
    providerThreadId: "provider-fork-source",
    ...(args.reasoningLevel === undefined
      ? {}
      : { reasoningLevel: args.reasoningLevel }),
    ...(args.serviceTier === undefined
      ? {}
      : { serviceTier: args.serviceTier }),
    threadId: sourceThread.id,
  });
  seedTurnStarted(harness.deps, {
    environmentId: environment.id,
    providerThreadId: "provider-fork-source",
    sequence: 3,
    threadId: sourceThread.id,
    turnId: "turn-fork-source",
  });
  return { environment, host, project, sourceThread };
}

async function postFork(
  harness: TestAppHarness,
  body: Record<string, unknown>,
) {
  return harness.app.request("/api/v1/threads/fork", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("public thread fork route", () => {
  it("creates an idle fork at the source tip with no first run", async () => {
    await withTestHarness(async (harness) => {
      const { sourceThread } = seedForkSource(harness);

      const response = await postFork(harness, {
        sourceThreadId: sourceThread.id,
        workspace: "reuse",
      });

      expect(response.status).toBe(201);
      const fork = threadResponseSchema.parse(await readJson(response));
      expect(fork).toMatchObject({
        originKind: "fork",
        sourceThreadId: sourceThread.id,
        visibility: "visible",
      });
      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === fork.id,
      );
      if (queued.command.type !== "thread.start") {
        throw new Error("Expected thread.start");
      }
      expect(queued.command.input).toEqual([]);
      expect(queued.command.fork).toEqual({
        sourceProviderThreadId: "provider-fork-source",
      });
    });
  });

  it("runs optional input from the requested fork point", async () => {
    await withTestHarness(async (harness) => {
      const { environment, sourceThread } = seedForkSource(harness);
      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-later-source",
        sequence: 8,
        threadId: sourceThread.id,
        turnId: "turn-later-source",
      });
      const input = [
        { type: "text" as const, text: "Continue here", mentions: [] },
      ];

      const response = await postFork(harness, {
        sourceThreadId: sourceThread.id,
        sourceSeqEnd: 3,
        input,
        workspace: "reuse",
      });

      expect(response.status).toBe(201);
      const fork = threadResponseSchema.parse(await readJson(response));
      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === fork.id,
      );
      if (queued.command.type !== "thread.start") {
        throw new Error("Expected thread.start");
      }
      expect(queued.command.input).toEqual(input);
      expect(queued.command.fork).toEqual({
        sourceProviderThreadId: "provider-fork-source",
      });
    });
  });

  it("persists an agent-only seed while keeping an idle fork input empty", async () => {
    await withTestHarness(async (harness) => {
      const { sourceThread } = seedForkSource(harness);
      const seed = {
        type: "text" as const,
        text: "Replying to the selected earlier message",
        mentions: [],
        visibility: "agent-only" as const,
      };

      const response = await postFork(harness, {
        sourceThreadId: sourceThread.id,
        agentContextSeed: [seed],
        workspace: "reuse",
      });

      expect(response.status).toBe(201);
      const fork = threadResponseSchema.parse(await readJson(response));
      const requested = listEvents(harness.db, { threadId: fork.id }).find(
        (event) => event.type === "client/turn/requested",
      );
      expect(requested).toBeDefined();
      const requestData = turnRequestEventDataSchema.parse(
        JSON.parse(requested?.data ?? "null"),
      );
      expect(requestData).toMatchObject({
        initiator: "agent",
        input: [seed],
        senderThreadId: sourceThread.id,
      });
      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === fork.id,
      );
      if (queued.command.type !== "thread.start") {
        throw new Error("Expected thread.start");
      }
      expect(queued.command.input).toEqual([]);
    });
  });

  it("inherits the source thread effective permission mode by default", async () => {
    await withTestHarness(async (harness) => {
      const { sourceThread } = seedForkSource(harness, {
        permissionMode: "accept-edits",
      });

      const response = await postFork(harness, {
        sourceThreadId: sourceThread.id,
        workspace: "reuse",
      });

      expect(response.status).toBe(201);
      const fork = threadResponseSchema.parse(await readJson(response));
      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === fork.id,
      );
      if (queued.command.type !== "thread.start") {
        throw new Error("Expected thread.start");
      }
      expect(queued.command.options.permissionMode).toBe("accept-edits");
    });
  });

  it("inherits the source's recorded model, reasoning level, and service tier", async () => {
    await withTestHarness(async (harness) => {
      const { sourceThread } = seedForkSource(harness, {
        model: "gpt-5-mini",
        reasoningLevel: "high",
        serviceTier: "fast",
      });

      const response = await postFork(harness, {
        sourceThreadId: sourceThread.id,
        workspace: "reuse",
      });

      expect(response.status).toBe(201);
      const fork = threadResponseSchema.parse(await readJson(response));
      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === fork.id,
      );
      if (queued.command.type !== "thread.start") {
        throw new Error("Expected thread.start");
      }
      expect(queued.command.options).toMatchObject({
        model: "gpt-5-mini",
        reasoningLevel: "high",
        serviceTier: "fast",
      });
    });
  });

  it("rejects a source provider without native fork capability", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const sourceThread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        providerId: "acp-test-agent",
      });

      const response = await postFork(harness, {
        sourceThreadId: sourceThread.id,
      });

      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
        message: "Provider acp-test-agent does not support thread forks",
      });
      expect(getThread(harness.db, sourceThread.id)).not.toBeNull();
    });
  });
});
