/** Provider integration tests for per-thread shell environment isolation. */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cleanup,
  createApprovalResolution,
  createTestRuntime,
  newThreadId,
  resolveRuntimeOptions,
  turnCompletedCountForThread,
  waitForRuntimeCondition,
} from "./test/runtime-integration-harness.js";
import { promptTextInput } from "./test/prompt-input.js";

interface ThreadEnvCapture {
  fileName: string;
  projectId: string;
  threadId: string;
}

interface ReadCapturedEnvArgs {
  ctxTmpDir: string;
  fileName: string;
}

const providers = ["codex", "claude-code", "pi"];

function createCaptureCommand(fileName: string): string {
  return (
    `printf '%s\\n%s\\n%s\\n' ` +
    `"$BB_THREAD_ID" "$BB_PROJECT_ID" "$BB_ENVIRONMENT_ID" > ${fileName}`
  );
}

function createCapturePrompt(command: string): string {
  return (
    "Run this shell command exactly once from the current working directory: " +
    `\`${command}\`. ` +
    "After the command finishes, reply with exactly DONE."
  );
}

function readCapturedEnv(args: ReadCapturedEnvArgs): string[] {
  return readFileSync(join(args.ctxTmpDir, args.fileName), "utf8")
    .trim()
    .split(/\r?\n/u);
}

function createNoNestingCaptureCommand(fileName: string): string {
  return (
    `printf '%s\\n%s\\n%s\\n' ` +
    `"\${BB_THREAD_ID:-absent}" "\${BB_SERVER_URL:-absent}" ` +
    `"$(bb status >/dev/null 2>&1 && echo ran || echo blocked)" > ${fileName}`
  );
}

/** Mirrors the daemon-side restricted env (`prepareWorkflowAgentShellEnv`):
 *  the inherited PATH stays intact and a leading shim directory makes every
 *  `bb` invocation fail fast with a clear message. */
function createFailingBbShimDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bb-wf-shim-"));
  writeFileSync(
    join(dir, "bb"),
    '#!/bin/sh\necho "bb is not available inside workflow agent sessions" >&2\nexit 1\n',
    { mode: 0o755 },
  );
  return dir;
}

for (const providerId of providers) {
  describe.concurrent(`${providerId} provider env isolation`, () => {
    it("keeps concurrent thread shell env isolated in one provider process", async () => {
      const ctx = createTestRuntime(providerId, {
        onInteractiveRequest: createApprovalResolution,
      });
      const sharedEnvironmentId = `env-isolation-${randomUUID()}`;
      const firstCapture: ThreadEnvCapture = {
        fileName: `env-first-${randomUUID()}.txt`,
        projectId: `project-first-${randomUUID()}`,
        threadId: newThreadId(),
      };
      const secondCapture: ThreadEnvCapture = {
        fileName: `env-second-${randomUUID()}.txt`,
        projectId: `project-second-${randomUUID()}`,
        threadId: newThreadId(),
      };

      try {
        const options = await resolveRuntimeOptions({
          ctx,
          providerId,
          preset: "full",
        });

        await ctx.runtime.startThread({
          sessionKind: "thread",
          environmentId: sharedEnvironmentId,
          threadId: firstCapture.threadId,
          projectId: firstCapture.projectId,
          providerId,
          options,
          instructions:
            "When the user asks you to run an exact shell command, use your shell or command execution tool and preserve command output.",
        });
        await ctx.runtime.startThread({
          sessionKind: "thread",
          environmentId: sharedEnvironmentId,
          threadId: secondCapture.threadId,
          projectId: secondCapture.projectId,
          providerId,
          options,
          instructions:
            "When the user asks you to run an exact shell command, use your shell or command execution tool and preserve command output.",
        });

        const firstFilePath = join(ctx.tmpDir, firstCapture.fileName);
        const secondFilePath = join(ctx.tmpDir, secondCapture.fileName);

        await Promise.all([
          ctx.runtime.runTurn({
            threadId: firstCapture.threadId,
            clientRequestId: "creq_23456789ab",
            options,
            input: [
              promptTextInput({
                text: createCapturePrompt(
                  createCaptureCommand(firstCapture.fileName),
                ),
              }),
            ],
          }),
          ctx.runtime.runTurn({
            threadId: secondCapture.threadId,
            clientRequestId: "creq_23456789ab",
            options,
            input: [
              promptTextInput({
                text: createCapturePrompt(
                  createCaptureCommand(secondCapture.fileName),
                ),
              }),
            ],
          }),
        ]);

        await waitForRuntimeCondition({
          ctx,
          label: "both thread env capture files",
          predicate: () =>
            (existsSync(firstFilePath) && existsSync(secondFilePath)) ||
            (turnCompletedCountForThread(ctx.events, firstCapture.threadId) >
              0 &&
              turnCompletedCountForThread(ctx.events, secondCapture.threadId) >
                0),
          timeoutMs: 90_000,
        });

        const firstFileExists = existsSync(firstFilePath);
        const secondFileExists = existsSync(secondFilePath);
        if (!firstFileExists || !secondFileExists) {
          const firstTurnCompletedCount = turnCompletedCountForThread(
            ctx.events,
            firstCapture.threadId,
          );
          const secondTurnCompletedCount = turnCompletedCountForThread(
            ctx.events,
            secondCapture.threadId,
          );
          throw new Error(
            [
              `${providerId} turns completed without writing env capture files`,
              `firstThread=${firstCapture.threadId}`,
              `firstFile=${firstFilePath}`,
              `firstFileExists=${firstFileExists}`,
              `firstTurnCompletedCount=${firstTurnCompletedCount}`,
              `secondThread=${secondCapture.threadId}`,
              `secondFile=${secondFilePath}`,
              `secondFileExists=${secondFileExists}`,
              `secondTurnCompletedCount=${secondTurnCompletedCount}`,
            ].join(" "),
          );
        }

        const firstCapturedEnv = readCapturedEnv({
          ctxTmpDir: ctx.tmpDir,
          fileName: firstCapture.fileName,
        });
        const secondCapturedEnv = readCapturedEnv({
          ctxTmpDir: ctx.tmpDir,
          fileName: secondCapture.fileName,
        });

        expect(firstCapturedEnv).toEqual([
          firstCapture.threadId,
          firstCapture.projectId,
          sharedEnvironmentId,
        ]);
        expect(secondCapturedEnv).toEqual([
          secondCapture.threadId,
          secondCapture.projectId,
          sharedEnvironmentId,
        ]);
      } finally {
        await ctx.runtime.shutdown();
        cleanup(ctx);
      }
    }, 95_000);

    it("withholds server coordinates and bb from workflowAgent shells while normal threads keep them", async () => {
      // A stub "real bb" that exits 0, so a thread-session `bb status` reports
      // "ran" while the workflow shim reports "blocked".
      const bbStubDir = mkdtempSync(join(tmpdir(), "bb-stub-"));
      writeFileSync(join(bbStubDir, "bb"), "#!/bin/sh\nexit 0\n", {
        mode: 0o755,
      });
      const shimDir = createFailingBbShimDir();
      const inheritedPath = process.env.PATH ?? "/usr/bin:/bin";
      const serverUrl = "http://127.0.0.1:3334";
      const ctx = createTestRuntime(providerId, {
        onInteractiveRequest: createApprovalResolution,
        shellEnv: {
          PATH: `${bbStubDir}${delimiter}${inheritedPath}`,
          BB_SERVER_URL: serverUrl,
          BB_HOST_DAEMON_PORT: "3002",
        },
        workflowAgentShellEnv: {
          PATH: `${shimDir}${delimiter}${inheritedPath}`,
        },
      });
      const sharedEnvironmentId = `env-no-nesting-${randomUUID()}`;
      const workflowCapture: ThreadEnvCapture = {
        fileName: `env-workflow-${randomUUID()}.txt`,
        projectId: `project-workflow-${randomUUID()}`,
        threadId: newThreadId(),
      };
      const threadCapture: ThreadEnvCapture = {
        fileName: `env-thread-${randomUUID()}.txt`,
        projectId: `project-thread-${randomUUID()}`,
        threadId: newThreadId(),
      };

      try {
        const options = await resolveRuntimeOptions({
          ctx,
          providerId,
          preset: "full",
        });
        const instructions =
          "When the user asks you to run an exact shell command, use your shell or command execution tool and preserve command output.";

        await ctx.runtime.startThread({
          sessionKind: "workflowAgent",
          environmentId: sharedEnvironmentId,
          threadId: workflowCapture.threadId,
          projectId: workflowCapture.projectId,
          providerId,
          options,
          instructions,
        });
        await ctx.runtime.startThread({
          sessionKind: "thread",
          environmentId: sharedEnvironmentId,
          threadId: threadCapture.threadId,
          projectId: threadCapture.projectId,
          providerId,
          options,
          instructions,
        });

        const workflowFilePath = join(ctx.tmpDir, workflowCapture.fileName);
        const threadFilePath = join(ctx.tmpDir, threadCapture.fileName);

        await Promise.all([
          ctx.runtime.runTurn({
            threadId: workflowCapture.threadId,
            clientRequestId: "creq_23456789ab",
            options,
            input: [
              {
                type: "text",
                text: createCapturePrompt(
                  createNoNestingCaptureCommand(workflowCapture.fileName),
                ),
                mentions: [],
              },
            ],
          }),
          ctx.runtime.runTurn({
            threadId: threadCapture.threadId,
            clientRequestId: "creq_23456789ab",
            options,
            input: [
              {
                type: "text",
                text: createCapturePrompt(
                  createNoNestingCaptureCommand(threadCapture.fileName),
                ),
                mentions: [],
              },
            ],
          }),
        ]);

        await waitForRuntimeCondition({
          ctx,
          label: "both no-nesting env capture files",
          predicate: () =>
            existsSync(workflowFilePath) && existsSync(threadFilePath),
          timeoutMs: 90_000,
        });

        expect(
          readCapturedEnv({
            ctxTmpDir: ctx.tmpDir,
            fileName: workflowCapture.fileName,
          }),
        ).toEqual(["absent", "absent", "blocked"]);
        expect(
          readCapturedEnv({
            ctxTmpDir: ctx.tmpDir,
            fileName: threadCapture.fileName,
          }),
        ).toEqual([threadCapture.threadId, serverUrl, "ran"]);
      } finally {
        await ctx.runtime.shutdown();
        cleanup(ctx);
        rmSync(bbStubDir, { recursive: true, force: true });
        rmSync(shimDir, { recursive: true, force: true });
      }
    }, 95_000);
  });
}
