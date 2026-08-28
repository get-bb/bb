import type { ExperimentalAiInferenceCompleteOutput } from "@get-bb/plugin-sdk/ai-services";
import type { JsonValue } from "@bb/domain";
import { describe, expect, it, vi } from "vitest";
import { registerFakeAiService } from "../helpers/ai-services.js";
import { generateCommitMessage } from "../../src/services/ai/commit-message.js";
import { AiServiceCallError } from "../../src/services/ai/ai-service-call.js";
import type { AppDeps, LoggedWorkSessionDeps } from "../../src/types.js";
import {
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { createTestAppHarness, withTestHarness } from "../helpers/test-app.js";

type FakeAiService = ReturnType<typeof registerFakeAiService>;
type FakeInferenceResponse = ExperimentalAiInferenceCompleteOutput | Error;

interface TestCommitMessageDeps {
  cleanup: () => Promise<void>;
  deps: LoggedWorkSessionDeps;
  fake: FakeAiService;
  logger: AppDeps["logger"];
}

interface MockCommitMessage extends Record<string, JsonValue> {
  message: string;
}

const commitMessageArgs = {
  diffDescription: "uncommitted changes",
  files: "M\tfile.ts\n",
  patch:
    "diff --git a/file.ts b/file.ts\n@@ -1 +1,2 @@\n export {}\n+export const changed = true;\n",
  shortstat: "1 file changed, 1 insertion(+)\n",
};

async function createCommitMessageDeps(
  responses: readonly FakeInferenceResponse[],
): Promise<TestCommitMessageDeps> {
  const harness = await createTestAppHarness({
    inferenceFallbackModel: "codex/mock-fallback-model",
    inferenceModel: "codex/mock-model",
  });
  const logger = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
  let responseIndex = 0;
  const fake = registerFakeAiService(harness.deps.aiServices, {
    completeInference: () => {
      const response = responses[responseIndex++];
      if (response instanceof Error) throw response;
      if (response === undefined) {
        throw new Error("fake AI service ran out of responses");
      }
      return response;
    },
  });
  seedHostSession(harness.deps);
  return {
    deps: {
      ...harness.deps,
      logger,
    },
    cleanup: harness.cleanup,
    fake,
    logger,
  };
}

function commitMessageCompletion(
  commitMessage: MockCommitMessage,
): ExperimentalAiInferenceCompleteOutput {
  return {
    ok: true,
    model: "mock-model",
    value: commitMessage,
  };
}

function invalidCommitMessageCompletion(): ExperimentalAiInferenceCompleteOutput {
  return { ok: true, model: "mock-model", value: {} };
}

describe("commit message generation", () => {
  it("retries once when commit message inference times out", async () => {
    const { cleanup, deps, fake, logger } = await createCommitMessageDeps([
      { ok: false, code: "timeout", message: "request timed out" },
      commitMessageCompletion({ message: "fix: recover commit message" }),
    ]);
    try {
      const message = await generateCommitMessage(deps, commitMessageArgs);

      expect(message).toBe("fix: recover commit message");
      expect(fake.inferenceCalls).toHaveLength(2);
      expect(fake.inferenceCalls[0]?.input.model).toBe("mock-model");
      expect(fake.inferenceCalls[1]?.input.model).toBe("mock-fallback-model");
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          attempt: 1,
          fallbackModel: "codex/mock-fallback-model",
          maxAttempts: 2,
          reason: "transient-failure",
          timeoutMs: 5_000,
        }),
        "Commit message inference failed transiently; using fallback model",
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          attempts: 2,
          model: "codex/mock-fallback-model",
          reason: "transient-failure",
        }),
        "Commit message inference completed with fallback model",
      );
    } finally {
      await cleanup();
    }
  });

  it("uses the fallback model after transient service unavailability", async () => {
    const { cleanup, deps, fake, logger } = await createCommitMessageDeps([
      new AiServiceCallError(
        "codex",
        "service_unavailable",
        "Our servers are currently overloaded. Please try again later.",
      ),
      commitMessageCompletion({ message: "fix: recover with fallback model" }),
    ]);
    try {
      await expect(
        generateCommitMessage(deps, commitMessageArgs),
      ).resolves.toBe("fix: recover with fallback model");
      expect(fake.inferenceCalls[1]?.input.model).toBe("mock-fallback-model");
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: "ai_service_unavailable",
          fallbackModel: "codex/mock-fallback-model",
        }),
        "Commit message inference failed transiently; using fallback model",
      );
    } finally {
      await cleanup();
    }
  });

  it("returns a timeout outcome after exhausting commit message retries", async () => {
    const { cleanup, deps, fake, logger } = await createCommitMessageDeps([
      { ok: false, code: "timeout", message: "request timed out" },
      { ok: false, code: "timeout", message: "request timed out" },
    ]);
    try {
      const message = await generateCommitMessage(deps, commitMessageArgs);

      expect(message).toBeNull();
      expect(fake.inferenceCalls).toHaveLength(2);
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          attempts: 2,
          reason: "timeout",
          timeoutMs: 5_000,
        }),
        "Commit message inference timed out",
      );
    } finally {
      await cleanup();
    }
  });

  it("returns null without retrying when the service returns an invalid result", async () => {
    const { cleanup, deps, fake, logger } = await createCommitMessageDeps([
      invalidCommitMessageCompletion(),
    ]);
    try {
      const message = await generateCommitMessage(deps, commitMessageArgs);

      expect(message).toBeNull();
      expect(fake.inferenceCalls).toHaveLength(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          attempts: 1,
          reason: "failed",
        }),
        "Commit message inference failed",
      );
    } finally {
      await cleanup();
    }
  });

  it("does not retry non-timeout failures", async () => {
    const { cleanup, deps, fake, logger } = await createCommitMessageDeps([
      invalidCommitMessageCompletion(),
    ]);
    try {
      const message = await generateCommitMessage(deps, commitMessageArgs);

      expect(message).toBeNull();
      expect(fake.inferenceCalls).toHaveLength(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          attempts: 1,
          err: expect.any(Error),
          reason: "failed",
        }),
        "Commit message inference failed",
      );
    } finally {
      await cleanup();
    }
  });

  it("returns null for Codex inference setup failures", async () => {
    await withTestHarness(
      {
        inferenceModel: "codex/gpt-5.6-luna",
      },
      async (harness) => {
        await expect(
          generateCommitMessage(harness.deps, commitMessageArgs),
        ).resolves.toBeNull();
      },
    );
  });

  it("returns null for a failed plugin-served inference", async () => {
    await withTestHarness(
      {
        inferenceModel: "codex/gpt-5.6-luna",
      },
      async (harness) => {
        seedHostSession(harness.deps);
        registerFakeAiService(harness.deps.aiServices, {
          completeInference: () => ({
            ok: false,
            code: "request_failed",
            message: "Codex request failed",
          }),
        });

        await expect(
          generateCommitMessage(harness.deps, commitMessageArgs),
        ).resolves.toBeNull();
      },
    );
  });

  it("uses the route fallback message only after commit message timeout retries are exhausted", async () => {
    await withTestHarness(
      {
        inferenceFallbackModel: "codex/mock-fallback-model",
        inferenceModel: "codex/mock-model",
      },
      async (harness) => {
        const fake = registerFakeAiService(harness.deps.aiServices, {
          completeInference: () => ({
            ok: false,
            code: "timeout",
            message: "request timed out",
          }),
        });
        const { host } = seedHostSession(harness.deps);
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
        });

        const responsePromise = harness.app.request(
          `/api/v1/environments/${environment.id}/actions`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              action: "commit",
            }),
          },
        );

        const statusCommand = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "workspace.status" &&
            command.environmentId === environment.id,
        );
        await reportQueuedCommandSuccess(harness, statusCommand, {
          outcome: "available",
          workspaceStatus: {
            branch: {
              currentBranch: "feature",
              defaultBranch: "main",
            },
            checkout: {
              kind: "branch",
              branchName: "feature",
              headSha: null,
            },
            mergeBase: null,
            workingTree: {
              deletions: 0,
              files: [],
              hasUncommittedChanges: true,
              insertions: 1,
              lineStatsComplete: true,
              state: "dirty_uncommitted",
            },
          },
        });

        const diffCommand = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "workspace.diff" &&
            command.environmentId === environment.id,
        );
        await reportQueuedCommandSuccess(harness, diffCommand, {
          outcome: "available",
          diff: {
            diff: commitMessageArgs.patch,
            files: commitMessageArgs.files,
            mergeBaseRef: null,
            shortstat: commitMessageArgs.shortstat,
            truncated: false,
          },
        });

        const commitCommand = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "workspace.commit" &&
            command.environmentId === environment.id,
        );
        expect(commitCommand.command).toMatchObject({
          message: "bb: automated commit",
        });
        expect(fake.inferenceCalls).toHaveLength(2);
        await reportQueuedCommandSuccess(harness, commitCommand, {
          commitSha: "abc123",
          commitSubject: "bb: automated commit",
        });

        const response = await responsePromise;
        expect(response.status).toBe(200);
        await expect(readJson(response)).resolves.toMatchObject({
          action: "commit",
          commitSubject: "bb: automated commit",
          ok: true,
        });
      },
    );
  });

  it("uses the route fallback message when Codex commit-message inference fails", async () => {
    await withTestHarness(
      {
        inferenceModel: "codex/gpt-5.6-luna",
      },
      async (harness) => {
        const { host } = seedHostSession(harness.deps);
        registerFakeAiService(harness.deps.aiServices, {
          completeInference: () => ({
            ok: false,
            code: "request_failed",
            message: "Codex request failed",
          }),
        });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
        });

        const responsePromise = harness.app.request(
          `/api/v1/environments/${environment.id}/actions`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              action: "commit",
            }),
          },
        );

        const statusCommand = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "workspace.status" &&
            command.environmentId === environment.id,
        );
        await reportQueuedCommandSuccess(harness, statusCommand, {
          outcome: "available",
          workspaceStatus: {
            branch: {
              currentBranch: "feature",
              defaultBranch: "main",
            },
            checkout: {
              kind: "branch",
              branchName: "feature",
              headSha: null,
            },
            mergeBase: null,
            workingTree: {
              deletions: 0,
              files: [],
              hasUncommittedChanges: true,
              insertions: 1,
              lineStatsComplete: true,
              state: "dirty_uncommitted",
            },
          },
        });

        const diffCommand = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "workspace.diff" &&
            command.environmentId === environment.id,
        );
        await reportQueuedCommandSuccess(harness, diffCommand, {
          outcome: "available",
          diff: {
            diff: commitMessageArgs.patch,
            files: commitMessageArgs.files,
            mergeBaseRef: null,
            shortstat: commitMessageArgs.shortstat,
            truncated: false,
          },
        });

        const commitCommand = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "workspace.commit" &&
            command.environmentId === environment.id,
        );
        expect(commitCommand.command).toMatchObject({
          message: "bb: automated commit",
        });
        await reportQueuedCommandSuccess(harness, commitCommand, {
          commitSha: "abc123",
          commitSubject: "bb: automated commit",
        });

        const response = await responsePromise;
        expect(response.status).toBe(200);
        await expect(readJson(response)).resolves.toMatchObject({
          action: "commit",
          commitSubject: "bb: automated commit",
          ok: true,
        });
      },
    );
  });
});
