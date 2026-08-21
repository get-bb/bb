import { ensurePersonalProject, getThread, listEvents } from "@bb/db";
import { PERSONAL_PROJECT_ID, turnRequestEventDataSchema } from "@bb/domain";
import { threadResponseSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
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

function seedPersonalDirectoryForkSource(harness: TestAppHarness) {
  const { host } = seedHostSession(harness.deps);
  ensurePersonalProject(harness.db);
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    path: "/tmp/personal-switched-directory",
    projectId: PERSONAL_PROJECT_ID,
    workspaceProvisionType: "unmanaged",
  });
  const sourceThread = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: PERSONAL_PROJECT_ID,
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    permissionMode: "full",
    providerThreadId: "provider-personal-directory-source",
    threadId: sourceThread.id,
  });
  seedTurnStarted(harness.deps, {
    environmentId: environment.id,
    providerThreadId: "provider-personal-directory-source",
    sequence: 3,
    threadId: sourceThread.id,
    turnId: "turn-personal-directory-source",
  });
  return { environment, sourceThread };
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
  it("reuses a switched directory from a personal-project source", async () => {
    await withTestHarness(async (harness) => {
      const { environment, sourceThread } =
        seedPersonalDirectoryForkSource(harness);

      const response = await postFork(harness, {
        sourceThreadId: sourceThread.id,
        workspace: "reuse",
      });

      expect(response.status).toBe(201);
      const fork = threadResponseSchema.parse(await readJson(response));
      expect(getThread(harness.db, fork.id)?.environmentId).toBe(
        environment.id,
      );
      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === fork.id,
      );
      if (queued.command.type !== "thread.start") {
        throw new Error("Expected thread.start");
      }
      expect(queued.command.fork).toEqual({
        sourceProviderThreadId: "provider-personal-directory-source",
      });
    });
  });

  it("uses a personal workspace for an isolated fork after a directory switch", async () => {
    await withTestHarness(async (harness) => {
      const { environment, sourceThread } =
        seedPersonalDirectoryForkSource(harness);

      const response = await postFork(harness, {
        sourceThreadId: sourceThread.id,
        workspace: "isolated",
      });

      expect(response.status).toBe(201);
      const fork = threadResponseSchema.parse(await readJson(response));
      expect(getThread(harness.db, fork.id)?.environmentId).not.toBe(
        environment.id,
      );
      const personalEnvironment = getThread(harness.db, fork.id)?.environmentId;
      expect(personalEnvironment).not.toBeNull();
      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.provision" &&
          command.environmentId === personalEnvironment,
      );
      if (queued.command.type !== "environment.provision") {
        throw new Error("Expected personal environment.provision");
      }
      expect(queued.command.workspaceProvisionType).toBe("personal");
      if (queued.command.workspaceProvisionType !== "personal") {
        throw new Error("Expected personal environment.provision");
      }
      await reportQueuedCommandSuccess(harness, queued, {
        path: queued.command.targetPath,
        branchName: "main",
        defaultBranch: "main",
        isGitRepo: false,
        isWorktree: false,
        transcript: [],
      });

      const start = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === fork.id,
      );
      if (start.command.type !== "thread.start") {
        throw new Error("Expected thread.start");
      }
      expect(start.command.fork).toEqual({
        sourceProviderThreadId: "provider-personal-directory-source",
      });
    });
  });

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

  it("forks a custom ACP provider and uses the returned child session", async () => {
    await withTestHarness(
      {
        customAcpAgents: [
          {
            id: "test-agent",
            displayName: "Test Agent",
            command: "test-agent",
            args: ["acp"],
            env: {},
            supportsManualCompaction: false,
          },
        ],
      },
      async (harness) => {
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
        seedThreadRuntimeState(harness.deps, {
          environmentId: environment.id,
          model: "acp-default",
          providerThreadId: "provider-acp-source",
          threadId: sourceThread.id,
        });
        seedTurnStarted(harness.deps, {
          environmentId: environment.id,
          providerThreadId: "provider-acp-source",
          sequence: 3,
          threadId: sourceThread.id,
          turnId: "turn-acp-source",
        });

        const response = await postFork(harness, {
          sourceThreadId: sourceThread.id,
          workspace: "reuse",
        });

        expect(response.status).toBe(201);
        const fork = threadResponseSchema.parse(await readJson(response));
        const start = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "thread.start" && command.threadId === fork.id,
        );
        if (start.command.type !== "thread.start") {
          throw new Error("Expected thread.start");
        }
        expect(start.command).toMatchObject({
          providerId: "acp-test-agent",
          acpLaunchSpec: {
            command: "test-agent",
            args: ["acp"],
          },
          fork: { sourceProviderThreadId: "provider-acp-source" },
        });

        await reportQueuedCommandSuccess(harness, start, {
          providerThreadId: "provider-acp-child",
        });
        expect(
          listEvents(harness.db, { threadId: fork.id }).some(
            (event) => event.providerThreadId === "provider-acp-child",
          ),
        ).toBe(true);

        const sendResponse = await harness.app.request(
          `/api/v1/threads/${fork.id}/send`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              input: [{ type: "text", text: "Continue the fork" }],
              mode: "auto",
              permissionMode: "full",
            }),
          },
        );
        expect(sendResponse.status).toBe(200);
        const turn = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "turn.submit" && command.threadId === fork.id,
        );
        expect(turn.command).toMatchObject({
          resumeContext: { providerThreadId: "provider-acp-child" },
        });
      },
    );
  });
});
