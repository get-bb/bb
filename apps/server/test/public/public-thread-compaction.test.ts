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
import { withTestHarness } from "../helpers/test-app.js";

describe("public thread compaction", () => {
  it("compacts through both the explicit route and a selected built-in command", async () => {
    await withTestHarness(async (harness) => {
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
        providerId: "pi",
        status: "idle",
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-thread-1",
        threadId: thread.id,
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
            resumeContext: {
              providerId: "pi",
              providerThreadId: "provider-thread-1",
            },
          });
          return { ok: true, result: {} };
        },
      });

      const explicitResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/compact`,
        { method: "POST" },
      );
      expect(
        explicitResponse.status,
        JSON.stringify(await readJson(explicitResponse.clone())),
      ).toBe(200);

      const commandResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "auto",
            input: [
              {
                type: "text",
                text: "/compact",
                mentions: [
                  {
                    start: 0,
                    end: 8,
                    resource: {
                      kind: "command",
                      trigger: "/",
                      name: "compact",
                      source: "command",
                      origin: "builtin",
                      label: "compact",
                      argumentHint: null,
                    },
                  },
                ],
              },
            ],
          }),
        },
      );
      expect(
        commandResponse.status,
        JSON.stringify(await readJson(commandResponse.clone())),
      ).toBe(200);
      expect(
        responder.requests.filter(
          ({ command }) => command.type === "thread.compact",
        ),
      ).toHaveLength(2);
      expect(
        responder.requests.some(
          ({ command }) => command.type === "turn.submit",
        ),
      ).toBe(false);
    });
  });

  it("compacts OpenCode ACP with its declared provider-local prompt", async () => {
    await withTestHarness(async (harness) => {
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
        providerId: "acp-opencode",
        status: "idle",
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "opencode-session-1",
        threadId: thread.id,
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
            acpLaunchSpec: {
              command: "opencode",
              args: ["acp"],
              manualCompaction: { method: "prompt", prompt: "/compact" },
            },
            resumeContext: {
              providerId: "acp-opencode",
              providerThreadId: "opencode-session-1",
              acpLaunchSpec: {
                manualCompaction: {
                  method: "prompt",
                  prompt: "/compact",
                },
              },
            },
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
  });

  it("compacts Cursor ACP with its built-in reseed strategy", async () => {
    await withTestHarness(async (harness) => {
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
        providerId: "acp-cursor",
        status: "idle",
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "cursor-session-1",
        threadId: thread.id,
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
            resumeContext: {
              providerId: "acp-cursor",
              providerThreadId: "cursor-session-1",
            },
          });
          expect(command).not.toHaveProperty("acpLaunchSpec");
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
  });

  it("rejects manual compaction for unsupported providers and active threads", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const unsupportedThread = seedThread(harness.deps, {
        projectId: project.id,
        providerId: "acp-grok",
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
