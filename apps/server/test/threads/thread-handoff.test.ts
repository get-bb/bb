import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createPromptHistoryEntry,
  getThread,
  getThreadHandoffByReplacementThreadId,
  getThreadHandoffBySourceAndIdempotencyKey,
  listEvents,
  listThreads,
  markThreadDeleted,
  updateHost,
} from "@bb/db";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/errors.js";
import {
  hostDaemonOnlineRpcResponseMessageSchema,
  hostDaemonServerWsMessageSchema,
} from "@bb/host-daemon-contract";
import { createThreadHandoff } from "../../src/services/threads/thread-handoff.js";
import {
  listQueuedCommands,
  listQueuedThreadCommands,
  reportQueuedCommandError,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";
import { availableModelFixture } from "../helpers/available-models.js";

function request(sourceThreadId: string) {
  return {
    sourceThreadId,
    providerId: "codex",
    model: "test-provider-default",
    reasoningLevel: "high" as const,
    serviceTier: "fast" as const,
    permissionMode: "full" as const,
    continuationText: "Carry the investigation forward.",
    archiveSource: true,
    idempotencyKey: "handoff-test-key-0001",
    origin: "app" as const,
  };
}

describe("thread handoff service", () => {
  it("creates a fresh visible replacement with exact execution and a typed source mention", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const source = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        title: "Source investigation",
      });
      await mkdir(join(harness.config.dataDir, "attachments", project.id), {
        recursive: true,
      });
      await writeFile(
        join(harness.config.dataDir, "attachments", project.id, "trace.txt"),
        "trace",
      );
      await writeFile(
        join(harness.config.dataDir, "attachments", project.id, "screen.png"),
        "image",
      );
      createPromptHistoryEntry(harness.db, {
        createdAt: 100,
        input: [
          { type: "text", text: "latest", mentions: [] },
          { type: "image", url: "https://example.test/screenshot.png" },
          { type: "localFile", path: "trace.txt", name: "trace.txt" },
          { type: "localImage", path: "screen.png" },
        ],
        projectId: project.id,
        requestSequence: 7,
        scope: "thread",
        threadId: source.id,
      });

      const result = await createThreadHandoff(
        harness.deps,
        request(source.id),
      );

      expect(result).toMatchObject({
        sourceThreadId: source.id,
        state: "provisioning",
        sourceArchived: false,
        failure: null,
      });
      const replacement = getThread(harness.db, result.replacementThreadId);
      expect(replacement).toMatchObject({
        environmentId: environment.id,
        projectId: project.id,
        providerId: "codex",
        parentThreadId: null,
        sourceThreadId: null,
        originKind: null,
        visibility: "visible",
        archivedAt: null,
        deletedAt: null,
      });
      expect(
        getThreadHandoffByReplacementThreadId(harness.db, replacement!.id),
      ).toMatchObject({
        model: "test-provider-default",
        reasoningLevel: "high",
        serviceTier: "fast",
        permissionMode: "full",
      });
      const start = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" &&
          command.threadId === replacement!.id,
      );
      if (start.command.type !== "thread.start")
        throw new Error("Expected thread.start");
      expect(start.command.fork).toBeUndefined();
      expect(start.command.options).toMatchObject({
        model: "test-provider-default",
        reasoningLevel: "high",
        serviceTier: "fast",
        permissionMode: "full",
      });
      expect(start.command.input).toEqual([
        {
          type: "text",
          text: `Continue from @thread:${source.id}\n\nCarry the investigation forward.`,
          mentions: [
            {
              start: "Continue from ".length,
              end: `Continue from @thread:${source.id}`.length,
              resource: {
                kind: "thread",
                projectId: project.id,
                threadId: source.id,
                label: "Source investigation",
              },
            },
          ],
        },
        { type: "image", url: "https://example.test/screenshot.png" },
        { type: "localFile", path: "trace.txt", name: "trace.txt" },
        { type: "localImage", path: "screen.png" },
      ]);
      const requested = listEvents(harness.db, {
        threadId: replacement!.id,
      }).find((event) => event.type === "client/turn/requested");
      expect(JSON.parse(requested?.data ?? "null")).toMatchObject({
        execution: {
          model: "test-provider-default",
          reasoningLevel: "high",
          serviceTier: "fast",
          permissionMode: "full",
        },
      });
    });
  });

  it("still provisions the committed replacement when a thread notification throws", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const source = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });
      vi.spyOn(harness.deps.hub, "notifyThread").mockImplementationOnce(() => {
        throw new Error("stale socket");
      });

      const created = await createThreadHandoff(
        harness.deps,
        request(source.id),
      );
      await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" &&
          command.threadId === created.replacementThreadId,
      );

      expect(
        listQueuedThreadCommands(
          harness,
          "thread.start",
          created.replacementThreadId,
        ),
      ).toHaveLength(1);
    });
  });

  it("rejects an exact execution tuple that the source host cannot run", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      updateHost(harness.db, harness.hub, host.id, {
        maxPermissionMode: "accept-edits",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const source = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });
      const threadIdsBefore = listThreads(harness.db, {
        projectId: project.id,
      }).map((thread) => thread.id);

      expect(
        getThreadHandoffBySourceAndIdempotencyKey(harness.db, {
          sourceThreadId: source.id,
          idempotencyKey: request(source.id).idempotencyKey,
        }),
      ).toBeNull();
      expect(listQueuedCommands(harness, "thread.start")).toHaveLength(0);

      await expect(
        createThreadHandoff(harness.deps, request(source.id)),
      ).rejects.toMatchObject({ body: { code: "invalid_execution_options" } });

      expect(
        listThreads(harness.db, { projectId: project.id }).map(
          (thread) => thread.id,
        ),
      ).toEqual(threadIdsBefore);
      expect(
        getThreadHandoffBySourceAndIdempotencyKey(harness.db, {
          sourceThreadId: source.id,
          idempotencyKey: request(source.id).idempotencyKey,
        }),
      ).toBeNull();
      expect(listQueuedCommands(harness, "thread.start")).toHaveLength(0);
    });
  });

  it("rejects a nonexistent source before provisioning", async () => {
    await withTestHarness(async (harness) => {
      const sourceThreadId = "thr_nonexistent_source";

      await expect(
        createThreadHandoff(harness.deps, request(sourceThreadId)),
      ).rejects.toMatchObject({ body: { code: "thread_not_found" } });
      expect(
        getThreadHandoffBySourceAndIdempotencyKey(harness.db, {
          sourceThreadId,
          idempotencyKey: request(sourceThreadId).idempotencyKey,
        }),
      ).toBeNull();
      expect(listQueuedCommands(harness, "thread.start")).toHaveLength(0);
    });
  });

  it("returns the idempotency winner without provisioning a second replacement", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const source = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });

      const [first, second] = await Promise.all([
        createThreadHandoff(harness.deps, request(source.id)),
        createThreadHandoff(harness.deps, request(source.id)),
      ]);

      expect(second).toEqual(first);
      await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" &&
          command.threadId === first.replacementThreadId,
      );
      expect(
        listQueuedThreadCommands(
          harness,
          "thread.start",
          first.replacementThreadId,
        ),
      ).toHaveLength(1);
      expect(
        await createThreadHandoff(harness.deps, request(source.id)),
      ).toEqual(first);
      expect(
        listQueuedThreadCommands(
          harness,
          "thread.start",
          first.replacementThreadId,
        ),
      ).toHaveLength(1);
    });
  });

  it("settles a provider provisioning failure while leaving the source live", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const source = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });
      const created = await createThreadHandoff(
        harness.deps,
        request(source.id),
      );
      const start = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" &&
          command.threadId === created.replacementThreadId,
      );
      await reportQueuedCommandError(harness, start, {
        errorCode: "provider_start_failed",
        errorMessage: "Provider exited",
      });
      await expect
        .poll(
          () =>
            getThreadHandoffByReplacementThreadId(
              harness.db,
              created.replacementThreadId,
            )?.status,
        )
        .toBe("failed");
      expect(
        getThreadHandoffByReplacementThreadId(
          harness.db,
          created.replacementThreadId,
        ),
      ).toMatchObject({
        failureCode: "provider_start_failed",
        failureMessage: "Provider exited",
      });
      expect(getThread(harness.db, source.id)).toMatchObject({
        archivedAt: null,
        deletedAt: null,
      });
    });
  });

  it("does not infer a browser timeout as terminal handoff failure", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const source = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });
      const requestHostOnlineRpc = harness.deps.hub.requestHostOnlineRpc.bind(
        harness.deps.hub,
      );
      vi.spyOn(harness.deps.hub, "requestHostOnlineRpc").mockImplementation(
        (args) =>
          args.message.command.type === "thread.start"
            ? Promise.reject(
                new ApiError(
                  504,
                  "command_timeout",
                  "Browser timed out waiting",
                ),
              )
            : requestHostOnlineRpc(args),
      );

      const created = await createThreadHandoff(
        harness.deps,
        request(source.id),
      );
      await expect
        .poll(
          () =>
            getThreadHandoffByReplacementThreadId(
              harness.db,
              created.replacementThreadId,
            )?.status,
        )
        .toBe("provisioning");
      expect(getThread(harness.db, source.id)?.archivedAt).toBeNull();
    });
  });

  it("rejects invalid source and environment states before provisioning", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const noEnvironment = seedThread(harness.deps, { projectId: project.id });
      await expect(
        createThreadHandoff(harness.deps, request(noEnvironment.id)),
      ).rejects.toMatchObject({
        body: { code: "thread_environment_unavailable" },
      });

      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const deleted = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });
      markThreadDeleted(harness.db, harness.hub, { threadId: deleted.id });
      await expect(
        createThreadHandoff(harness.deps, request(deleted.id)),
      ).rejects.toMatchObject({ body: { code: "thread_not_found" } });
    });
  });

  it.each([
    { field: "providerId", value: "missing-provider" },
    { field: "model", value: "retired-model" },
    { field: "reasoningLevel", value: "ultra" },
  ] as const)(
    "rejects unavailable $field without substitution",
    async ({ field, value }) => {
      await withTestHarness(async (harness) => {
        const { host } = seedHostSession(harness.deps);
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
        });
        const source = seedThread(harness.deps, {
          environmentId: environment.id,
          projectId: project.id,
        });
        await expect(
          createThreadHandoff(harness.deps, {
            ...request(source.id),
            [field]: value,
          }),
        ).rejects.toMatchObject({
          body: { code: "invalid_execution_options" },
        });
      });
    },
  );

  it("rejects a selected-only model returned by the actual source host", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const source = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });
      harness.hub.registerDaemon(session.id, host.id, {
        close() {},
        send(data) {
          const message = hostDaemonServerWsMessageSchema.parse(
            JSON.parse(data),
          );
          if (
            message.type !== "host-rpc.request" ||
            message.command.type !== "provider.list_models"
          ) {
            return;
          }
          harness.hub.recordHostOnlineRpcResponse({
            sessionId: session.id,
            message: hostDaemonOnlineRpcResponseMessageSchema.parse({
              type: "host-rpc.response",
              requestId: message.requestId,
              commandType: "provider.list_models",
              ok: true,
              result: {
                models: [],
                selectedOnlyModels: [
                  availableModelFixture({
                    model: "selected-only-model",
                    reasoningLevels: ["medium"],
                  }),
                ],
              },
            }),
          });
        },
      });

      await expect(
        createThreadHandoff(harness.deps, {
          ...request(source.id),
          model: "selected-only-model",
          reasoningLevel: "medium",
        }),
      ).rejects.toMatchObject({ body: { code: "invalid_execution_options" } });
    });
  });

  it.each([
    {
      providerId: "claude-code",
      permissionMode: "full" as const,
      serviceTier: "fast" as const,
      label: "unsupported service tier",
    },
    {
      providerId: "pi",
      permissionMode: "auto" as const,
      serviceTier: "default" as const,
      label: "unsupported provider permission",
    },
  ])("rejects $label", async ({ permissionMode, providerId, serviceTier }) => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const source = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });
      await expect(
        createThreadHandoff(harness.deps, {
          ...request(source.id),
          permissionMode,
          providerId,
          reasoningLevel: "medium",
          serviceTier,
        }),
      ).rejects.toMatchObject({ body: { code: "invalid_execution_options" } });
    });
  });

  it("rejects a non-ready environment and an offline source host", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const provisioning = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: null,
        status: "provisioning",
      });
      const notReady = seedThread(harness.deps, {
        environmentId: provisioning.id,
        projectId: project.id,
      });
      await expect(
        createThreadHandoff(harness.deps, request(notReady.id)),
      ).rejects.toMatchObject({ body: { code: "environment_not_ready" } });

      const ready = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/ready-offline",
      });
      const offline = seedThread(harness.deps, {
        environmentId: ready.id,
        projectId: project.id,
      });
      harness.hub.unregisterDaemon(session.id);
      await expect(
        createThreadHandoff(harness.deps, request(offline.id)),
      ).rejects.toMatchObject({ body: { code: "host_unavailable" } });
    });
  });

  it("rejects a source whose environment belongs to another project", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project: sourceProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/source-project",
      });
      const { project: otherProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/other-project",
      });
      const otherEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: otherProject.id,
      });
      const source = seedThread(harness.deps, {
        environmentId: otherEnvironment.id,
        projectId: sourceProject.id,
      });
      await expect(
        createThreadHandoff(harness.deps, request(source.id)),
      ).rejects.toMatchObject({ body: { code: "project_mismatch" } });
    });
  });
});
