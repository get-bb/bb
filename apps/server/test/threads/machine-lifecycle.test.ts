import {
  getEnvironment,
  getHost,
  getLatestSessionForHost,
  getNonDestroyedHostByLaunchKey,
  getThread,
  listQueuedThreadMessages,
  setProjectGitRemoteUrlIfMissing,
} from "@bb/db";
import { threadScope, turnScope, type ThreadEvent } from "@bb/domain";
import { groupHostDaemonEvents } from "@bb/host-daemon-contract";
import { validatePluginMachineProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import { createDeferredPromise } from "@bb/test-helpers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sweepMachineLifecycles } from "../../src/services/machines/provider-orchestration.js";
import { setPluginEnvironmentProviderBridge } from "../../src/services/plugins/plugin-environment-provider-registry.js";
import { setPluginMachineProviderBridge } from "../../src/services/plugins/plugin-machine-provider-registry.js";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import { clearAllThreadProvisionSchedules } from "../../src/services/threads/thread-startup-store.js";
import {
  createTestDaemonEventEnvelope,
  internalAuthHeaders,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { defaultEnvironmentProviderRecords } from "../helpers/environment-provider.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedSession,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

afterEach(() => {
  clearAllThreadProvisionSchedules();
  setPluginEnvironmentProviderBridge(undefined);
  setPluginMachineProviderBridge(undefined);
});

describe("composed machine thread lifecycle", () => {
  it.each([
    { firstTurn: "completed", archiveFrom: "active" },
    { firstTurn: "stopped", archiveFrom: "suspended" },
  ] as const)(
    "pauses after a $firstTurn turn, resumes for a follow-up, and retires from $archiveFrom",
    async ({ firstTurn, archiveFrom }) => {
      await withTestHarness(async (harness) => {
        const source = seedHostSession(harness.deps, { id: "source-machine" });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: source.host.id,
        });
        const remoteUrl = "https://example.test/project.git";
        const path = "/tmp/machine-lifecycle-checkout";
        setProjectGitRemoteUrlIfMissing(
          harness.db,
          harness.hub,
          project.id,
          remoteUrl,
        );
        const suspend = vi.fn(async ({ hostId }: { hostId: string }) => {
          expect(harness.hub.hasDaemonForHost(hostId)).toBe(false);
          return { resource: { snapshot: "saved" } };
        });
        const resumeStarted = createDeferredPromise<void>();
        const finishResume = createDeferredPromise<void>();
        const resume = vi.fn(async ({ hostId }: { hostId: string }) => {
          seedSession(harness.deps, hostId);
          resumeStarted.resolve();
          await finishResume.promise;
          return { resource: { snapshot: "saved" } };
        });
        const remove = vi.fn(async () => ({ status: "removed" as const }));
        const machine = {
          pluginId: "test-cloud",
          provider: validatePluginMachineProviderDeclaration({
            id: "test-machine",
            displayName: "Test machine",
            description: "Disposable lifecycle test machine",
            icon: "Terminal",
            ephemeral: true,
            async create({ key }) {
              const host = getNonDestroyedHostByLaunchKey(harness.db, key);
              if (host === null) throw new Error("Missing creating machine");
              seedSession(harness.deps, host.id);
              return {
                status: "created",
                name: "Test machine",
                resource: { snapshot: null },
              };
            },
            reconcileCleanup: async () => ({ status: "removed" }),
            suspend,
            resume,
            remove,
          }),
        };
        setPluginMachineProviderBridge({
          listMachineProviders: () => [machine],
          getMachineProvider: (id) =>
            id === machine.provider.id ? machine : undefined,
          invokeProvider: async (_pluginId, _label, run) => ({
            ok: true,
            value: await run(),
          }),
          decisionTimeoutMs: 10_000,
        });
        const environments = defaultEnvironmentProviderRecords();
        setPluginEnvironmentProviderBridge({
          listEnvironmentProviders: () => environments,
          getEnvironmentProvider: (id) =>
            environments.find((record) => record.provider.id === id),
          listEnvironmentCompositions: () => [
            {
              pluginId: machine.pluginId,
              composition: {
                id: "test-sandbox",
                displayName: "Test sandbox",
                description: "Prepare a workspace for this thread.",
                icon: "Cloud",
                machineProviderId: machine.provider.id,
                environmentProviderId: "project-checkout",
              },
            },
          ],
          invokeProvider: async (_pluginId, _label, run) => ({
            ok: true,
            value: await run(),
          }),
          decisionTimeoutMs: 10_000,
        });

        const thread = await createThreadFromRequest(harness.deps, {
          projectId: project.id,
          environment: {
            type: "provider",
            environmentProviderId: "test-sandbox",
            inputs: {},
          },
          input: textInput("First turn"),
          providerId: "codex",
          model: "requested-model",
          origin: "app",
          startedOnBehalfOf: null,
        });
        const defaultPath = await waitForQueuedCommand(
          harness,
          ({ command }) => command.type === "project.clone_default_path",
          5_000,
        );
        const hostId = defaultPath.row.hostId;
        expect(getHost(harness.db, hostId)).toMatchObject({
          launchKey: thread.id,
          type: "ephemeral",
          phase: "active",
        });
        const busy = await harness.app.request(
          `/api/v1/hosts/${hostId}/suspend`,
          { method: "POST" },
        );
        expect(busy.status).toBe(409);
        expect(await busy.json()).toMatchObject({ code: "machine_busy" });
        await reportQueuedCommandSuccess(harness, defaultPath, { path });
        const exists = await waitForQueuedCommand(
          harness,
          ({ command }) => command.type === "host.paths_exist",
        );
        await reportQueuedCommandSuccess(harness, exists, {
          existence: { [path]: false },
        });
        const clone = await waitForQueuedCommand(
          harness,
          ({ command }) => command.type === "project.clone",
        );
        await reportQueuedCommandSuccess(harness, clone, {
          path,
          gitRemoteUrl: remoteUrl,
        });
        const attach = await waitForQueuedCommand(
          harness,
          ({ command }) => command.type === "environment.attach",
        );
        if (attach.command.type !== "environment.attach")
          throw new Error("Missing environment attach");
        const environmentId = attach.command.environmentId;
        await reportQueuedCommandSuccess(harness, attach, {
          path,
          branchName: "main",
          defaultBranch: "main",
          isGitRepo: true,
          isWorktree: false,
        });
        const start = await waitForQueuedCommand(
          harness,
          ({ command }) => command.type === "thread.start",
        );
        const providerThreadId = "provider-machine-lifecycle";
        await reportQueuedCommandSuccess(harness, start, { providerThreadId });

        async function reportEvents(events: ThreadEvent[]) {
          const session = getLatestSessionForHost(harness.db, { hostId });
          if (session === null) throw new Error("Missing daemon session");
          const response = await harness.app.request(
            "/internal/session/events",
            {
              method: "POST",
              headers: internalAuthHeaders(harness, { hostId }),
              body: JSON.stringify({
                sessionId: session.id,
                eventGroups: groupHostDaemonEvents(
                  events.map((event) =>
                    createTestDaemonEventEnvelope({ event }),
                  ),
                ),
              }),
            },
          );
          expect(response.status).toBe(200);
        }

        await reportEvents([
          {
            type: "thread/identity",
            threadId: thread.id,
            providerThreadId,
            scope: threadScope(),
          },
          {
            type: "turn/started",
            threadId: thread.id,
            providerThreadId,
            scope: turnScope("first-turn"),
          },
        ]);
        expect(getThread(harness.db, thread.id)?.status).toBe("active");
        if (firstTurn === "stopped") {
          const stopping = harness.app.request(
            `/api/v1/threads/${thread.id}/stop`,
            { method: "POST" },
          );
          const stop = await waitForQueuedCommand(
            harness,
            ({ command }) => command.type === "thread.stop",
          );
          await reportQueuedCommandSuccess(harness, stop, {
            providerCheckpointId: null,
          });
          expect((await stopping).status).toBe(200);
        } else {
          await reportEvents([
            {
              type: "turn/completed",
              threadId: thread.id,
              providerThreadId,
              scope: turnScope("first-turn"),
              status: "completed",
            },
          ]);
        }
        expect(getThread(harness.db, thread.id)).toMatchObject({
          status: "idle",
          archivedAt: null,
          environmentId,
        });
        expect(getEnvironment(harness.db, environmentId)?.status).toBe("ready");

        async function pause() {
          const response = await harness.app.request(
            `/api/v1/hosts/${hostId}/suspend`,
            { method: "POST" },
          );
          expect(response.status).toBe(202);
          await expect
            .poll(() => getHost(harness.db, hostId)?.phase)
            .toBe("suspended");
          expect(harness.hub.hasDaemonForHost(hostId)).toBe(false);
        }

        await pause();
        await sweepMachineLifecycles(harness.deps);
        expect(getHost(harness.db, hostId)?.phase).toBe("suspended");
        expect(remove).not.toHaveBeenCalled();
        const send = await harness.app.request(
          `/api/v1/threads/${thread.id}/send`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              input: textInput("Follow-up"),
              mode: "auto",
            }),
          },
        );
        expect(send.status).toBe(200);
        await resumeStarted.promise;
        try {
          expect(getHost(harness.db, hostId)?.phase).toBe("resuming");
          const resuming = await harness.app.request(`/api/v1/hosts/${hostId}`);
          expect(resuming.status).toBe(200);
          expect(await resuming.json()).toMatchObject({
            status: "connected",
            lifecycle: { phase: "resuming" },
          });
        } finally {
          finishResume.resolve();
        }
        const followup = await waitForQueuedCommand(
          harness,
          ({ command }) => command.type === "turn.submit",
        );
        expect(followup.row.hostId).toBe(hostId);
        await reportQueuedCommandSuccess(harness, followup, {
          appliedAs: "new-turn",
        });
        await reportEvents([
          {
            type: "turn/started",
            threadId: thread.id,
            providerThreadId,
            scope: turnScope("followup-turn"),
          },
        ]);
        expect(getThread(harness.db, thread.id)?.status).toBe("active");
        expect(getHost(harness.db, hostId)?.phase).toBe("active");
        expect(resume).toHaveBeenCalledOnce();
        await reportEvents([
          {
            type: "turn/completed",
            threadId: thread.id,
            providerThreadId,
            scope: turnScope("followup-turn"),
            status: "completed",
          },
        ]);
        expect(getThread(harness.db, thread.id)?.status).toBe("idle");
        expect(listQueuedThreadMessages(harness.db, thread.id)).toEqual([]);
        if (archiveFrom === "suspended") await pause();
        const archive = await harness.app.request(
          `/api/v1/threads/${thread.id}/archive-all`,
          { method: "POST" },
        );
        expect(archive.status).toBe(200);
        await expect
          .poll(() => getHost(harness.db, hostId)?.phase)
          .toBe("destroyed");
        expect(remove).toHaveBeenCalledOnce();
        expect(suspend).toHaveBeenCalledTimes(
          archiveFrom === "suspended" ? 2 : 1,
        );
        expect(getEnvironment(harness.db, environmentId)?.status).toBe(
          "destroyed",
        );
        expect(getThread(harness.db, thread.id)?.archivedAt).not.toBeNull();
        expect(getHost(harness.db, source.host.id)?.destroyedAt).toBeNull();
      });
    },
  );
});
