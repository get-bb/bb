import { describe, expect, it } from "vitest";
import {
  registerHostRpcResponder,
  type HostRpcHandlerResult,
} from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function seedCompactableThread(
  harness: TestAppHarness,
  args: { providerId: string; providerThreadId: string },
) {
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
    providerId: args.providerId,
    status: "idle",
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    providerThreadId: args.providerThreadId,
    threadId: thread.id,
  });
  return { host, session, thread };
}

const compactionCases = [
  {
    label: "Pi",
    providerId: "pi",
    providerThreadId: "provider-thread-1",
    expectedCommand: {
      resumeContext: {
        providerId: "pi",
        providerThreadId: "provider-thread-1",
      },
    },
  },
  {
    label: "OpenCode ACP",
    providerId: "acp-opencode",
    providerThreadId: "opencode-session-1",
    expectedCommand: {
      acpLaunchSpec: {
        command: "opencode",
        args: ["acp"],
        manualCompaction: { method: "prompt", prompt: "/compact" },
      },
      resumeContext: {
        providerId: "acp-opencode",
        providerThreadId: "opencode-session-1",
        acpLaunchSpec: {
          manualCompaction: { method: "prompt", prompt: "/compact" },
        },
      },
    },
  },
] as const;

describe("public thread compaction", () => {
  it.each(compactionCases)(
    "dispatches $label compaction through the explicit route",
    async ({ expectedCommand, providerId, providerThreadId }) => {
      await withTestHarness(async (harness) => {
        const { host, session, thread } = seedCompactableThread(harness, {
          providerId,
          providerThreadId,
        });
        const responder = registerHostRpcResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
          handle: ({ command }): HostRpcHandlerResult => {
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
              type: "thread.compact",
              threadId: thread.id,
              ...expectedCommand,
            });
            return { ok: true, result: {} };
          },
        });

        const response = await harness.app.request(
          `/api/v1/threads/${thread.id}/compact`,
          { method: "POST" },
        );
        expect(
          response.status,
          JSON.stringify(await readJson(response.clone())),
        ).toBe(200);

        expect(
          responder.requests.filter(
            ({ command }) => command.type === "thread.compact",
          ),
        ).toHaveLength(1);
      });
    },
  );

  it("rejects manual compaction for unsupported providers and active threads", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const unsupportedThread = seedThread(harness.deps, {
        projectId: project.id,
        providerId: "acp-cursor",
        status: "idle",
      });
      const activeThread = seedThread(harness.deps, {
        projectId: project.id,
        providerId: "codex",
        status: "active",
      });

      const unsupportedResponse = await harness.app.request(
        `/api/v1/threads/${unsupportedThread.id}/compact`,
        { method: "POST" },
      );
      expect(unsupportedResponse.status).toBe(409);
      await expect(readJson(unsupportedResponse)).resolves.toMatchObject({
        message: expect.stringContaining(
          "does not support manual context compaction",
        ),
      });

      const activeResponse = await harness.app.request(
        `/api/v1/threads/${activeThread.id}/compact`,
        { method: "POST" },
      );
      expect(activeResponse.status).toBe(409);
      await expect(readJson(activeResponse)).resolves.toMatchObject({
        message:
          "Context can only be compacted while the thread is idle or errored",
      });
    });
  });
});
