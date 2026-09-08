import { registerTestHostRpcCapture } from "../../helpers/commands.js";
import { reportEnvironmentHookProgress } from "../../../src/services/environments/environment-hooks.js";
import { recordProvisionedEnvironmentWorkspace } from "@bb/db/internal-environment-lifecycle";
import { createThreadFromRequest } from "../../../src/services/threads/thread-create.js";
import { encodeClientTurnRequestIdNumber } from "@bb/domain";
import { requireThreadCommandEnvironment } from "../../../src/services/threads/thread-command-environment.js";
import { ensureThreadProvisionEnvironmentReady } from "../../../src/services/threads/thread-provisioning-environment.js";
import {
  createMetadataPendingContext,
  createEnvironmentPendingContext,
} from "../../../src/services/threads/thread-provisioning-context.js";
import { z } from "zod";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { handleUpdateEnvironmentDirectoryToolCall } from "../../../src/services/threads/thread-environment-directory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  claimEnvironmentLaunchPath,
  createEnvironment,
  environments,
  getEnvironment,
  getEnvironmentLaunch,
  getThread,
  getProject,
  pruneDestroyedEnvironments,
  saveEnvironmentLaunch,
  threads,
  updateThread,
} from "@bb/db";
import type { JsonValue } from "@bb/domain";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import type { PluginEnvironmentProviderDeclaration } from "@get-bb/plugin-sdk";
import { validatePluginEnvironmentProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import {
  askProviderLaunch,
  attachProviderLaunch,
  cancelProviderLaunch,
  sweepProviderEnvironment,
  sweepProviderLifecycles,
} from "../../../src/services/environments/provider-orchestration.js";
import { toEnvironmentResponse } from "../../../src/services/environments/environment-response.js";
import { setPluginEnvironmentProviderBridge } from "../../../src/services/plugins/plugin-environment-provider-registry.js";
import {
  advanceProjectDeletion,
  beginProjectDeletion,
} from "../../../src/services/projects/project-deletion.js";
import { runPeriodicSweeps } from "../../../src/services/system/periodic-sweeps.js";
import { toThreadResponseFromThread } from "../../../src/services/threads/thread-runtime-display.js";
import { resolveProducedEnvironmentPlacement } from "../../../src/services/threads/thread-environment-placement.js";
import type { TestEnvironmentProviderContext } from "../../helpers/provider-decisions.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedTurnStarted,
} from "../../helpers/seed.js";
import {
  withTestHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

function setup(
  harness: TestAppHarness,
  overrides: Partial<PluginEnvironmentProviderDeclaration> = {},
) {
  const { host, session } = seedHostSession(harness.deps, { id: "host_test" });
  const { project, source } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: "/tmp/project",
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    status: "starting",
  });
  const record = {
    pluginId: "test",
    provider: validatePluginEnvironmentProviderDeclaration({
      id: "test-provider",
      displayName: "Test",
      create: async () => ({
        status: "created",
        path: `/tmp/${thread.id}`,
        ownsPath: true,
      }),
      remove: async () => ({ status: "removed" }),
      ...overrides,
    }),
  };
  setPluginEnvironmentProviderBridge({
    listEnvironmentProviders: () => [record],
    getEnvironmentProvider: (id) =>
      id === record.provider.id ? record : undefined,
    invokeProvider: async (_id, _label, run) => ({
      ok: true,
      value: await run(),
    }),
    decisionTimeoutMs: 10_000,
  });
  const context: TestEnvironmentProviderContext = {
    thread: toThreadResponseFromThread(harness.deps, { thread }),
    project,
    host: makeHost({ id: host.id, name: host.name }),
    machine: { type: "existing", hostId: host.id },
    projectCheckout: null,
    gitRemote: null,
    inputs: null,
    suggestedBranchName: "bb/test",
    environment: null,
  };
  const row = () => {
    const value = getEnvironmentLaunch(harness.db, thread.id);
    if (value === null) throw new Error("Missing launch");
    return value;
  };
  const ask = () => askProviderLaunch(harness.deps, record, context, null);
  const settled = async () =>
    expect.poll(() => row().phase).not.toBe("creating");
  const attach = () => {
    const launch = row();
    if (launch.hostId === null || launch.path === null) {
      throw new Error("Launch is not ready");
    }
    const environment = createEnvironment(harness.db, harness.hub, {
      projectId: project.id,
      hostId: launch.hostId,
      path: null,
      providerOwnsPath: launch.ownsPath,
      status: "ready",
      environmentProvider: {
        environmentProviderId: record.provider.id,
        selection: launch.selection,
        instanceKey: launch.pathKey,
      },
    });
    attachProviderLaunch(harness.db, thread.id, environment.id);
    recordProvisionedEnvironmentWorkspace(
      harness.db,
      harness.hub,
      environment.id,
      {
        path: launch.path,
        isGitRepo: false,
        isWorktree: false,
        branchName: null,
        defaultBranch: null,
      },
    );
    return environment.id;
  };
  return {
    ask,
    attach,
    context,
    host,
    session,
    record,
    row,
    settled,
    source,
    thread,
  };
}

function pendingUntilAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener(
      "abort",
      () => reject(new Error("Environment creation aborted")),
      { once: true },
    );
  });
}

afterEach(() => {
  vi.useRealTimers();
  setPluginEnvironmentProviderBridge(undefined);
});

describe("core environment orchestration", () => {
  it.each([true, false])(
    "runs core hooks only for ownsPath=%s, in provider order",
    async (ownsPath) =>
      withTestHarness(async (harness) => {
        const order: string[] = [];
        const fixture = setup(harness, {
          policy: { retireGraceMs: 0 },
          create: async () => {
            order.push("create");
            return { status: "created", path: "/tmp/hooks", ownsPath };
          },
          remove: async () => {
            order.push("remove");
            return { status: "removed" };
          },
        });
        registerTestHostRpcCapture(harness.deps, {
          hostId: fixture.host.id,
          sessionId: fixture.session.id,
          onEnvironmentHook: async (command) => {
            expect(command.timeoutMs).toBe(15 * 60 * 1000);
            expect(command.path).toBe("/tmp/hooks");
            order.push(command.kind);
            reportEnvironmentHookProgress(harness.deps, fixture.host.id, {
              type: "environment.hook.progress",
              operationId: command.operationId,
              entry: {
                type: "step",
                text: "Running setup…",
                status: "started",
              },
            });
            if (command.kind === "setup")
              expect(fixture.row().stepText).toBe("Running setup…");
          },
        });
        fixture.ask();
        await fixture.settled();
        expect(fixture.row().phase).toBe("ready");
        const environmentId = fixture.attach();
        await sweepProviderEnvironment(harness.deps, environmentId);
        expect(getEnvironment(harness.db, environmentId)?.teardownStatus).toBe(
          "removed",
        );
        expect(order).toEqual(
          ownsPath
            ? ["create", "setup", "teardown", "remove"]
            : ["create", "remove"],
        );
      }),
  );

  it("fails setup with its output and retains the path claim through cleanup", async () =>
    withTestHarness(async (harness) => {
      const order: string[] = [];
      const fixture = setup(harness, {
        create: async (context) => {
          expect(await context.experimental_claimPath("/tmp/hooks")).toBe(true);
          return {
            status: "created",
            path: "/tmp/hooks",
            ownsPath: true,
            resource: { token: "cleanup" },
          };
        },
        remove: async (context) => {
          order.push("remove");
          expect(context.path).toBe("/tmp/hooks");
          expect(context.resource).toEqual({ token: "cleanup" });
          expect(fixture.row().claimPath).toBe("/tmp/hooks");
          return { status: "removed" };
        },
      });
      registerTestHostRpcCapture(harness.deps, {
        hostId: fixture.host.id,
        sessionId: fixture.session.id,
        onEnvironmentHook: async (command) => {
          order.push(command.kind);
          reportEnvironmentHookProgress(harness.deps, fixture.host.id, {
            type: "environment.hook.progress",
            operationId: command.operationId,
            entry: { type: "output", text: "script diagnostic", status: null },
          });
          throw new Error(`${command.kind} failed`);
        },
      });
      fixture.ask();
      await fixture.settled();
      expect(fixture.row()).toMatchObject({
        phase: "failed",
        failure: "terminal",
        claimPath: "/tmp/hooks",
      });
      expect(fixture.ask()).toMatchObject({
        action: "reject",
        message: expect.stringContaining("setup failed"),
        log: expect.stringContaining("script diagnostic"),
      });
      await cancelProviderLaunch(harness.deps, fixture.thread.id);
      expect(order).toEqual(["setup", "teardown", "remove"]);
      expect(fixture.row()).toMatchObject({
        claimPath: null,
        cancelPending: false,
      });
    }));

  it("reports teardown transport failure and still removes the environment", async () =>
    withTestHarness(async (harness) => {
      const remove = vi.fn(async () => ({ status: "removed" as const }));
      const fixture = setup(harness, { policy: { retireGraceMs: 0 }, remove });
      registerTestHostRpcCapture(harness.deps, {
        hostId: fixture.host.id,
        sessionId: fixture.session.id,
        onEnvironmentHook: async (command) => {
          if (command.kind === "teardown")
            throw new Error("teardown unavailable");
        },
      });
      const warn = vi.fn();
      harness.deps.logger = { ...harness.deps.logger, warn };
      fixture.ask();
      await fixture.settled();
      const environmentId = fixture.attach();
      await sweepProviderEnvironment(harness.deps, environmentId);
      expect(remove).toHaveBeenCalledOnce();
      expect(getEnvironment(harness.db, environmentId)?.teardownStatus).toBe(
        "removed",
      );
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "teardown unavailable" }),
        "Environment teardown hook failed; continuing removal",
      );
    }));

  it.each(["new reuse", "reuse", "directory", "restored dispatch"])(
    "refuses %s admission while another launch owns the checkout",
    async (admission) =>
      withTestHarness(async (harness) => {
        const fixture = setup(harness, {
          create: async (context) => {
            await context.experimental_claimPath("/tmp/project");
            return { status: "created", path: "/tmp/project", ownsPath: false };
          },
        });
        fixture.ask();
        await fixture.settled();
        const target = createEnvironment(harness.db, harness.hub, {
          projectId: fixture.context.project.id,
          hostId: fixture.host.id,
          path: "/tmp/project",
          status: "ready",
          providerOwnsPath: false,
        });
        const current = createEnvironment(harness.db, harness.hub, {
          projectId: fixture.context.project.id,
          hostId: fixture.host.id,
          path: "/tmp/other",
          status: "ready",
          providerOwnsPath: false,
        });
        const thread = seedThread(harness.deps, {
          projectId: fixture.context.project.id,
          status: "starting",
          environmentId:
            admission === "restored dispatch" ? target.id : current.id,
        });
        const busy =
          "Cannot checkout branch while another thread is using this workspace";
        if (admission === "new reuse") {
          await expect(
            createThreadFromRequest(harness.deps, {
              environment: { type: "reuse", environmentId: target.id },
              input: [{ type: "text", text: "Start", mentions: [] }],
              origin: "app",
              projectId: fixture.context.project.id,
              providerId: "codex",
              model: "gpt-5",
              startedOnBehalfOf: null,
            }),
          ).rejects.toThrow(busy);
        } else if (admission === "directory") {
          seedTurnStarted(harness.deps, {
            environmentId: current.id,
            providerThreadId: "provider_admission",
            sequence: 1,
            threadId: thread.id,
            turnId: "turn_admission",
          });
          const result = await handleUpdateEnvironmentDirectoryToolCall(
            harness.deps,
            {
              currentEnvironment: current,
              thread,
              turnId: "turn_admission",
              input: { path: target.path },
            },
          );
          expect(result).toMatchObject({
            success: false,
            contentItems: [{ type: "inputText", text: busy }],
          });
        } else if (admission === "restored dispatch") {
          await expect(
            requireThreadCommandEnvironment(harness.deps, { thread }),
          ).rejects.toThrow(busy);
          await expect(
            requireThreadCommandEnvironment(harness.deps, {
              thread: { ...fixture.thread, environmentId: target.id },
            }),
          ).resolves.toMatchObject({ id: target.id });
        } else {
          const context = createEnvironmentPendingContext(
            createMetadataPendingContext({
              clientRequestId: encodeClientTurnRequestIdNumber({ value: 1 }),
              environmentIntent: { type: "reuse", environmentId: target.id },
              execution: {
                model: "gpt-5",
                serviceTier: "default",
                reasoningLevel: "medium",
                permissionMode: "accept-edits",
                source: "client/turn/requested",
              },
              fork: null,
              input: [],
              titleProvided: true,
              seedWithoutRun: false,
            }),
          );
          await expect(
            ensureThreadProvisionEnvironmentReady(harness.deps, {
              thread,
              context,
            }),
          ).rejects.toThrow(busy);
        }
      }),
  );

  it("retains a failed claim through cleanup and releases it only after removal", async () =>
    withTestHarness(async (harness) => {
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const fixture = setup(harness, {
        create: async (context) => {
          await context.experimental_claimPath("/tmp/project");
          return {
            status: "failed",
            failure: "terminal",
            message: "provision failed",
          };
        },
        remove: async () => {
          await gate;
          return { status: "removed" };
        },
      });
      fixture.ask();
      await fixture.settled();
      const second = {
        ...fixture.row(),
        threadId: "thr_competing",
        phase: "creating" as const,
        path: null,
        claimPath: null,
      };
      saveEnvironmentLaunch(harness.db, second);
      let cleanup: Promise<void> | undefined;
      try {
        expect(
          claimEnvironmentLaunchPath(harness.db, second, "/tmp/project"),
        ).toBe(false);
        cleanup = cancelProviderLaunch(harness.deps, fixture.thread.id);
        expect(
          claimEnvironmentLaunchPath(harness.db, second, "/tmp/project"),
        ).toBe(false);
      } finally {
        release();
        await cleanup;
      }
      expect(
        claimEnvironmentLaunchPath(harness.db, second, "/tmp/project"),
      ).toBe(true);
    }));

  it("does not replace the canonical claim with a provider's trailing slash result", async () =>
    withTestHarness(async (harness) => {
      const fixture = setup(harness, {
        create: async (context) => {
          await context.experimental_claimPath("/tmp/project/");
          return { status: "created", path: "/tmp/project/", ownsPath: false };
        },
      });
      fixture.ask();
      await fixture.settled();
      const second = {
        ...fixture.row(),
        threadId: "thr_competing",
        phase: "creating" as const,
        path: null,
        claimPath: null,
      };
      saveEnvironmentLaunch(harness.db, second);
      expect(
        claimEnvironmentLaunchPath(harness.db, second, "/tmp/project"),
      ).toBe(false);
      expect(fixture.row().path).toBe("/tmp/project/");
    }));

  it("preserves canonical identity after attachment for live checkout exclusion", async () =>
    withTestHarness(async (harness) => {
      const fixture = setup(harness, {
        id: "project-checkout",
        create: async (context) => {
          await context.experimental_claimPath("/tmp/project/");
          return { status: "created", path: "/tmp/project/", ownsPath: false };
        },
      });
      fixture.ask();
      await fixture.settled();
      const environmentId = fixture.attach();
      updateThread(harness.db, harness.hub, fixture.thread.id, {
        environmentId,
      });
      harness.db
        .update(threads)
        .set({ status: "active" })
        .where(eq(threads.id, fixture.thread.id))
        .run();
      expect(getEnvironment(harness.db, environmentId)?.canonicalPath).toBe(
        "/tmp/project",
      );
      const response = await harness.app.request(
        `/api/v1/environments?hostId=${fixture.host.id}&path=%2Ftmp%2Fproject`,
      );
      expect(response.status).toBe(200);
      expect(
        z
          .array(z.object({ id: z.string() }))
          .parse(await response.json())
          .map((row) => row.id),
      ).toContain(environmentId);
      const fake = createFakePluginHost({
        pluginId: "environment-project-checkout",
        sdk: {
          environments: {
            list: async (filters) => {
              if (filters?.hostId === undefined || filters.path === undefined)
                throw new Error("Missing host/path filter");
              const response = await harness.app.request(
                `/api/v1/environments?${new URLSearchParams({ hostId: filters.hostId, path: filters.path })}`,
              );
              expect(response.status).toBe(200);
              return response.json();
            },
          },
          threads: {
            list: async (filters) => {
              if (filters?.environmentId === undefined)
                throw new Error("Missing environment filter");
              const response = await harness.app.request(
                `/api/v1/threads?${new URLSearchParams({ environmentId: filters.environmentId })}`,
              );
              expect(response.status).toBe(200);
              return response.json();
            },
          },
        },
      });
      const module = z
        .object({
          default: z.custom<(bb: BbPluginApi) => Promise<void>>(
            (value) => typeof value === "function",
          ),
        })
        .parse(
          await import(
            new URL(
              "../../../../../plugins/environment-project-checkout/server.ts",
              import.meta.url,
            ).href
          ),
        );
      await module.default(fake.bb);
      const provider =
        fake.harness.registrations.environmentProviders.get("project-checkout");
      if (provider?.validate === null || provider === undefined)
        throw new Error("Missing checkout provider");
      expect(
        await provider.validate({
          ...fixture.context,
          projectCheckout: { path: "/tmp/project" },
          inputs: { branch: { kind: "existing", name: "release" } },
        }),
      ).toEqual({
        action: "refuse",
        message:
          "Cannot checkout branch while another thread is using this workspace",
      });
    }));

  it("reserves a checkout before concurrent branch mutations until attachment", async () =>
    withTestHarness(async (harness) => {
      const fixture = setup(harness);
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const switched: string[] = [];
      const fake = createFakePluginHost({
        pluginId: "environment-project-checkout",
        sdk: { environments: { list: () => [] }, threads: { list: () => [] } },
        experimental_callHostRpc: async ({ input }) => {
          const parsed = z
            .object({
              path: z.string(),
              branch: z.object({ name: z.string() }),
            })
            .parse(input);
          switched.push(parsed.branch.name);
          await gate;
          return {
            status: "attached",
            path: parsed.path,
            branchName: parsed.branch.name,
          };
        },
      });
      const module = z
        .object({
          default: z.custom<(bb: BbPluginApi) => Promise<void>>(
            (value) => typeof value === "function",
          ),
        })
        .parse(
          await import(
            new URL(
              "../../../../../plugins/environment-project-checkout/server.ts",
              import.meta.url,
            ).href
          ),
        );
      await module.default(fake.bb);
      const provider =
        fake.harness.registrations.environmentProviders.get("project-checkout");
      if (provider === undefined) throw new Error("Missing checkout provider");
      const record = { pluginId: "environment-project-checkout", provider };
      setPluginEnvironmentProviderBridge({
        listEnvironmentProviders: () => [record],
        getEnvironmentProvider: () => record,
        invokeProvider: async (_id, _label, run) => ({
          ok: true,
          value: await run(),
        }),
        decisionTimeoutMs: 10_000,
      });
      const second = seedThread(harness.deps, {
        projectId: fixture.context.project.id,
        status: "starting",
      });
      const context = {
        ...fixture.context,
        projectCheckout: { path: "/tmp/project" },
        inputs: { branch: { kind: "existing", name: "release" } },
      };
      try {
        askProviderLaunch(harness.deps, record, context, null);
        askProviderLaunch(
          harness.deps,
          record,
          {
            ...context,
            thread: toThreadResponseFromThread(harness.deps, {
              thread: second,
            }),
            inputs: { branch: { kind: "existing", name: "feature" } },
          },
          null,
        );
        await expect
          .poll(() => getEnvironmentLaunch(harness.db, second.id)?.phase)
          .toBe("failed");
        expect(getEnvironmentLaunch(harness.db, second.id)?.message).toContain(
          "another thread is using this workspace",
        );
        expect(switched).toEqual(["release"]);
        expect(fixture.row()).toMatchObject({
          hostId: fixture.host.id,
          path: "/tmp/project",
          environmentId: null,
          phase: "creating",
        });
      } finally {
        release();
        await fixture.settled();
      }
      expect(fixture.row().phase).toBe("ready");
    }));

  it("reuses a same-project worktree before checkout validation", async () =>
    withTestHarness(async (harness) => {
      const validate = vi.fn(() => ({
        action: "refuse" as const,
        message: "reuse that environment instead",
      }));
      const fixture = setup(harness, { id: "project-checkout", validate });
      fixture.ask();
      await fixture.settled();
      const currentId = fixture.attach();
      const current = getEnvironment(harness.db, currentId)!;
      updateThread(harness.db, harness.hub, fixture.thread.id, {
        environmentId: currentId,
      });
      const target = createEnvironment(harness.db, harness.hub, {
        projectId: fixture.context.project.id,
        hostId: fixture.host.id,
        path: "/tmp/same-project-worktree/",
        status: "ready",
        providerOwnsPath: true,
        environmentProvider: {
          environmentProviderId: "git-worktree",
          instanceKey: "worktree",
          selection: fixture.row().selection,
        },
      });
      seedTurnStarted(harness.deps, {
        environmentId: currentId,
        providerThreadId: "provider_directory",
        sequence: 1,
        threadId: fixture.thread.id,
        turnId: "turn_directory",
      });
      const result = await handleUpdateEnvironmentDirectoryToolCall(
        harness.deps,
        {
          currentEnvironment: current,
          thread: { ...fixture.thread, environmentId: currentId },
          turnId: "turn_directory",
          input: { path: "/tmp/same-project-worktree" },
        },
      );
      expect(result.success).toBe(true);
      expect(validate).not.toHaveBeenCalled();
      expect(getThread(harness.db, fixture.thread.id)?.environmentId).toBe(
        target.id,
      );
    }));

  it.each(["removal", "cancellation"])(
    "starts unrelated %s cleanup while the first operation is pending",
    async (kind) =>
      withTestHarness(async (harness) => {
        let release: () => void = () => {};
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const calls: string[] = [];
        const fixture = setup(harness, {
          policy: { retireGraceMs: 0 },
          remove: async ({ pathKey }) => {
            calls.push(pathKey);
            if (pathKey === fixture.thread.id) await gate;
            return { status: "removed" };
          },
        });
        fixture.ask();
        await fixture.settled();
        const second = seedThread(harness.deps, {
          projectId: fixture.context.project.id,
          status: "starting",
        });
        saveEnvironmentLaunch(harness.db, {
          ...fixture.row(),
          threadId: second.id,
          pathKey: second.id,
          path: "/tmp/second",
        });
        if (kind === "removal") {
          fixture.attach();
          const env = createEnvironment(harness.db, harness.hub, {
            projectId: fixture.context.project.id,
            hostId: fixture.host.id,
            path: "/tmp/second",
            status: "ready",
            providerOwnsPath: true,
            environmentProvider: {
              environmentProviderId: fixture.record.provider.id,
              instanceKey: second.id,
              selection: fixture.row().selection,
            },
          });
          attachProviderLaunch(harness.db, second.id, env.id);
        } else {
          for (const id of [fixture.thread.id, second.id]) {
            saveEnvironmentLaunch(harness.db, {
              ...getEnvironmentLaunch(harness.db, id)!,
              phase: "cancelled",
              cancelPending: true,
            });
          }
        }
        let enumerated = false;
        const sweep = sweepProviderLifecycles(harness.deps).then(() => {
          enumerated = true;
        });
        try {
          await expect.poll(() => calls).toContain(second.id);
          await expect.poll(() => enumerated).toBe(true);
          await sweepProviderLifecycles(harness.deps);
          expect(calls.filter((id) => id === fixture.thread.id)).toHaveLength(
            1,
          );
        } finally {
          release();
          await sweep;
        }
      }),
  );

  it("runs one long create call and records the ready result", async () =>
    withTestHarness(async (harness) => {
      const fixture = setup(harness);
      expect(fixture.ask()).toMatchObject({
        action: "wait",
        reason: "Preparing Test…",
      });
      await fixture.settled();
      expect(fixture.ask()).toMatchObject({
        action: "ready",
        environment: { path: `/tmp/${fixture.thread.id}` },
      });
      const environmentId = fixture.attach();
      expect(fixture.row().environmentId).toBe(environmentId);
    }));

  it("re-runs a persisted creating attempt with the same path key", async () =>
    withTestHarness(async (harness) => {
      const calls: Array<{ attempt: number; pathKey: string }> = [];
      const fixture = setup(harness, {
        create: async (context) => {
          calls.push({ attempt: context.attempt, pathKey: context.pathKey });
          return {
            status: "created",
            path: `/tmp/${context.pathKey}`,
            ownsPath: true,
          };
        },
      });
      saveEnvironmentLaunch(harness.db, {
        threadId: fixture.thread.id,
        providerId: fixture.record.provider.id,
        attempt: 7,
        phase: "creating",
        startedAt: Date.now() - 1_000,
        failedAt: null,
        failure: null,
        message: null,
        transientFailures: 0,
        pathKey: "durable-path-key",
        hostId: null,
        path: null,
        claimPath: null,
        ownsPath: true,
        mergeBaseBranch: null,
        resource: null,
        stepText: "Preparing Test…",
        pendingLog: "",
        replacedEnvironmentId: null,
        environmentId: null,
        selection: {
          machine: { type: "existing", hostId: fixture.host.id },
          inputs: null,
        },
        cancelPending: false,
        request: null,
      });

      expect(fixture.ask().action).toBe("wait");
      await fixture.settled();
      expect(calls).toEqual([{ attempt: 7, pathKey: "durable-path-key" }]);
      expect(fixture.row()).toMatchObject({
        attempt: 7,
        pathKey: "durable-path-key",
        phase: "ready",
      });
    }));

  it("persists progress reported from inside create", async () =>
    withTestHarness(async (harness) => {
      let release: () => void = () => {};
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      const fixture = setup(harness, {
        create: async (context) => {
          context.report.step("Cloning repository");
          context.report.log("clone output");
          await waiting;
          return {
            status: "created",
            path: "/tmp/progress",
            ownsPath: true,
          };
        },
      });
      fixture.ask();
      await expect
        .poll(() => fixture.ask())
        .toMatchObject({ reason: "Cloning repository", log: "clone output" });
      expect(fixture.ask()).toMatchObject({ log: "" });
      release();
      await fixture.settled();
    }));

  it("aborts create at its timeout and records a transient failure", async () =>
    withTestHarness(async (harness) => {
      let aborted = false;
      const fixture = setup(harness, {
        policy: { createTimeoutMs: 5, transientRetryLimit: 0 },
        create: async (context) => {
          context.signal.addEventListener("abort", () => {
            aborted = true;
          });
          return pendingUntilAbort(context.signal);
        },
      });
      fixture.ask();
      await fixture.settled();
      expect(aborted).toBe(true);
      expect(fixture.row()).toMatchObject({
        phase: "failed",
        failure: "transient",
        transientFailures: 1,
        message: "Environment creation timed out after 5 ms.",
      });
    }));

  it("aborts create before removing everything under its path key", async () =>
    withTestHarness(async (harness) => {
      const events: string[] = [];
      const fixture = setup(harness, {
        create: async (context) => {
          events.push(`create:${context.pathKey}`);
          context.signal.addEventListener("abort", () => events.push("abort"));
          return pendingUntilAbort(context.signal);
        },
        remove: async (context) => {
          events.push(`remove:${context.pathKey}`);
          expect(context.environment).toBeNull();
          expect(context.path).toBeNull();
          return { status: "removed" };
        },
      });
      fixture.ask();
      await expect.poll(() => events).toHaveLength(1);
      await cancelProviderLaunch(harness.deps, fixture.thread.id);
      expect(events).toEqual([
        `create:${fixture.thread.id}`,
        "abort",
        `remove:${fixture.thread.id}`,
      ]);
      expect(fixture.row()).toMatchObject({
        phase: "cancelled",
        cancelPending: false,
      });
    }));

  it("waits for an aborted create to stop before removing its path key", async () =>
    withTestHarness(async (harness) => {
      const events: string[] = [];
      let release: () => void = () => {};
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      const fixture = setup(harness, {
        create: async (context) => {
          events.push("create");
          context.signal.addEventListener("abort", () => events.push("abort"));
          await waiting;
          events.push("create-stopped");
          return {
            status: "created",
            path: `/tmp/${context.pathKey}`,
            ownsPath: true,
          };
        },
        remove: async () => {
          events.push("remove");
          return { status: "removed" };
        },
      });
      fixture.ask();
      await expect.poll(() => events).toEqual(["create"]);
      const cancellation = cancelProviderLaunch(
        harness.deps,
        fixture.thread.id,
      );
      await expect.poll(() => events).toEqual(["create", "abort"]);
      release();
      await cancellation;
      expect(events).toEqual(["create", "abort", "create-stopped", "remove"]);
    }));

  it("cleans each transient attempt before retrying under a new path key", async () =>
    withTestHarness(async (harness) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const creates: string[] = [];
      const removes: string[] = [];
      const fixture = setup(harness, {
        policy: {
          pathKeys: "per-attempt",
          transientRetryMs: 1,
          transientRetryLimit: 1,
        },
        create: async (context) => {
          creates.push(context.pathKey);
          return {
            status: "failed",
            failure: "transient",
            message: "offline",
          };
        },
        remove: async (context) => {
          removes.push(context.pathKey);
          return { status: "removed" };
        },
      });
      fixture.ask();
      await fixture.settled();
      expect(fixture.ask()).toMatchObject({
        action: "wait",
        reason: "offline; cleaning up before retry",
      });
      await expect.poll(() => removes).toEqual([`${fixture.thread.id}-1`]);
      await expect
        .poll(() => fixture.row())
        .toMatchObject({
          phase: "cancelled",
          cancelPending: false,
        });
      vi.setSystemTime(Date.now() + 2);
      fixture.ask();
      await fixture.settled();
      expect(fixture.ask()).toMatchObject({
        action: "reject",
        message: "offline",
      });
      await expect
        .poll(() => removes)
        .toEqual([`${fixture.thread.id}-1`, `${fixture.thread.id}-2`]);
      expect(creates).toEqual([
        `${fixture.thread.id}-1`,
        `${fixture.thread.id}-2`,
      ]);
      expect(fixture.row()).toMatchObject({
        attempt: 2,
        transientFailures: 2,
        phase: "cancelled",
        cancelPending: false,
      });
    }));

  it("round-trips a private resource handle into remove", async () =>
    withTestHarness(async (harness) => {
      const resources: JsonValue[] = [];
      const fixture = setup(harness, {
        create: async () => ({
          status: "created",
          path: "/tmp/resource-test",
          ownsPath: true,
          resource: { secret: "private" },
        }),
        remove: async (context) => {
          resources.push(context.resource);
          return { status: "removed" };
        },
        policy: { retireGraceMs: 0 },
      });
      fixture.ask();
      await fixture.settled();
      const environmentId = fixture.attach();
      expect(
        JSON.stringify(
          toEnvironmentResponse(getEnvironment(harness.db, environmentId)!),
        ),
      ).not.toContain("private");
      await sweepProviderEnvironment(harness.deps, environmentId);
      expect(resources).toEqual([{ secret: "private" }]);
      expect(getEnvironment(harness.db, environmentId)?.resource).toBeNull();
    }));

  it("rejects a resource handle larger than 16 KiB", async () =>
    withTestHarness(async (harness) => {
      const fixture = setup(harness, {
        create: async () => ({
          status: "created",
          path: "/tmp/cap",
          ownsPath: true,
          resource: "x".repeat(16_385),
        }),
      });
      fixture.ask();
      await fixture.settled();
      expect(fixture.ask()).toMatchObject({
        action: "reject",
        message: expect.stringContaining("16 KiB"),
      });
    }));

  it("serializes overlapping remove sweeps", async () =>
    withTestHarness(async (harness) => {
      let removes = 0;
      let release: () => void = () => {};
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      const fixture = setup(harness, {
        policy: { retireGraceMs: 0 },
        remove: async () => {
          removes += 1;
          await waiting;
          return { status: "removed" };
        },
      });
      fixture.ask();
      await fixture.settled();
      const environmentId = fixture.attach();
      const first = sweepProviderEnvironment(harness.deps, environmentId);
      await expect.poll(() => removes).toBe(1);
      const second = sweepProviderEnvironment(harness.deps, environmentId);
      expect(removes).toBe(1);
      release();
      await Promise.all([first, second]);
      expect(removes).toBe(1);
    }));

  it("reserves a path until provider removal finishes", async () =>
    withTestHarness(async (harness) => {
      let removes = 0;
      let release: () => void = () => {};
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      const path = "/tmp/reserved-until-removed";
      const fixture = setup(harness, {
        policy: { retireGraceMs: 0 },
        create: async () => ({
          status: "created",
          path,
          ownsPath: true,
        }),
        remove: async () => {
          removes += 1;
          await waiting;
          return { status: "removed" };
        },
      });
      fixture.ask();
      await fixture.settled();
      const environmentId = fixture.attach();
      const removal = sweepProviderEnvironment(harness.deps, environmentId);
      await expect.poll(() => removes).toBe(1);
      await expect(
        resolveProducedEnvironmentPlacement(harness.deps, {
          environmentProviderId: fixture.record.provider.id,
          inputs: null,
          producedEnvironment: {
            type: "host",
            hostId: fixture.host.id,
            path,
            ownsPath: true,
          },
          projectId: fixture.context.project.id,
        }),
      ).rejects.toThrow(/not ready|unavailable/iu);
      release();
      await removal;
      await expect(
        resolveProducedEnvironmentPlacement(harness.deps, {
          environmentProviderId: fixture.record.provider.id,
          inputs: null,
          producedEnvironment: {
            type: "host",
            hostId: fixture.host.id,
            path,
            ownsPath: true,
          },
          projectId: fixture.context.project.id,
        }),
      ).resolves.toMatchObject({
        environmentId: null,
        environmentIntent: { type: "provider" },
      });
    }));

  it("records a failed remove and retries after the declared delay", async () =>
    withTestHarness(async (harness) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      let removes = 0;
      const fixture = setup(harness, {
        policy: { retireGraceMs: 0, removeRetryMs: 10 },
        remove: async () => {
          removes += 1;
          return removes === 1
            ? { status: "failed", message: "busy" }
            : { status: "removed" };
        },
      });
      fixture.ask();
      await fixture.settled();
      const environmentId = fixture.attach();
      await sweepProviderEnvironment(harness.deps, environmentId);
      expect(getEnvironment(harness.db, environmentId)).toMatchObject({
        teardownStatus: "failed",
        teardownMessage: "busy",
      });
      await sweepProviderEnvironment(harness.deps, environmentId);
      expect(removes).toBe(1);
      vi.setSystemTime(Date.now() + 11);
      await sweepProviderEnvironment(harness.deps, environmentId);
      expect(getEnvironment(harness.db, environmentId)).toMatchObject({
        status: "destroyed",
        teardownStatus: "removed",
      });
    }));

  it("does not retire an environment under the keep policy", async () =>
    withTestHarness(async (harness) => {
      const fixture = setup(harness, { policy: { retireGraceMs: null } });
      fixture.ask();
      await fixture.settled();
      const environmentId = fixture.attach();
      await sweepProviderEnvironment(harness.deps, environmentId);
      expect(getEnvironment(harness.db, environmentId)).toMatchObject({
        retireAt: null,
        teardownStatus: null,
        status: "ready",
      });
    }));

  it("cancels retirement when a live thread returns", async () =>
    withTestHarness(async (harness) => {
      const fixture = setup(harness, { policy: { retireGraceMs: 60_000 } });
      fixture.ask();
      await fixture.settled();
      const environmentId = fixture.attach();
      await sweepProviderEnvironment(harness.deps, environmentId);
      expect(
        getEnvironment(harness.db, environmentId)?.retireAt,
      ).not.toBeNull();
      updateThread(harness.db, harness.hub, fixture.thread.id, {
        environmentId,
      });
      await sweepProviderEnvironment(harness.deps, environmentId);
      expect(getEnvironment(harness.db, environmentId)?.retireAt).toBeNull();
    }));

  it("waits for an archived runtime to stop before remove", async () =>
    withTestHarness(async (harness) => {
      let removes = 0;
      const fixture = setup(harness, {
        policy: { retireGraceMs: 0 },
        remove: async () => {
          removes += 1;
          return { status: "removed" };
        },
      });
      fixture.ask();
      await fixture.settled();
      const environmentId = fixture.attach();
      harness.db
        .update(threads)
        .set({
          environmentId,
          archivedAt: Date.now(),
          status: "stopping",
        })
        .where(eq(threads.id, fixture.thread.id))
        .run();
      await sweepProviderEnvironment(harness.deps, environmentId);
      expect(removes).toBe(0);
      harness.db
        .update(threads)
        .set({ status: "idle" })
        .where(eq(threads.id, fixture.thread.id))
        .run();
      await sweepProviderEnvironment(harness.deps, environmentId);
      expect(removes).toBe(1);
    }));

  it("removes an expired environment through the periodic sweep", async () =>
    withTestHarness(async (harness) => {
      const fixture = setup(harness, { policy: { retireGraceMs: 0 } });
      fixture.ask();
      await fixture.settled();
      const environmentId = fixture.attach();
      harness.db
        .update(threads)
        .set({ status: "idle" })
        .where(eq(threads.id, fixture.thread.id))
        .run();
      await runPeriodicSweeps({
        ...harness.deps,
        pluginSchedules: harness.pluginService,
        plugins: harness.pluginService,
      });
      expect(getEnvironment(harness.db, environmentId)).toMatchObject({
        status: "destroyed",
        teardownStatus: "removed",
        teardownAttempt: 1,
      });
    }));

  it("keeps destroyed rows until provider remove finishes", async () =>
    withTestHarness(async (harness) => {
      const fixture = setup(harness);
      fixture.ask();
      await fixture.settled();
      const environmentId = fixture.attach();
      harness.db
        .update(environments)
        .set({ status: "destroyed", updatedAt: 1, teardownStatus: "failed" })
        .where(eq(environments.id, environmentId))
        .run();
      const prune = () =>
        pruneDestroyedEnvironments(harness.db, harness.hub, {
          updatedBefore: Date.now(),
          eventBatchSize: 10,
          limit: 10,
        });
      expect(prune().deleted).toBe(0);
      harness.db
        .update(environments)
        .set({ teardownStatus: "removed" })
        .where(eq(environments.id, environmentId))
        .run();
      expect(prune().deleted).toBe(1);
    }));

  it.each([
    { retireGraceMs: 0, ownsPath: true },
    { retireGraceMs: null, ownsPath: true },
    { retireGraceMs: null, ownsPath: false },
  ])(
    "allows provider source cleanup during project deletion with grace $retireGraceMs and ownsPath $ownsPath",
    async ({ retireGraceMs, ownsPath }) =>
      withTestHarness(async (harness) => {
        let cleanupStatus = 0;
        const fixture = setup(harness, {
          policy: { retireGraceMs },
          create: async () => ({
            status: "created",
            path: "/tmp/project-cleanup",
            ownsPath,
          }),
          remove: async (context) => {
            const projectId = context.environment?.projectId;
            if (projectId === undefined) throw new Error("Missing project");
            const response = await harness.app.request(
              `/api/v1/projects/${projectId}/sources/${fixture.source.id}`,
              { method: "DELETE" },
            );
            cleanupStatus = response.status;
            return response.ok
              ? { status: "removed" }
              : { status: "failed", message: await response.text() };
          },
        });
        fixture.ask();
        await fixture.settled();
        const environmentId = fixture.attach();
        harness.db
          .update(threads)
          .set({ status: "idle" })
          .where(eq(threads.id, fixture.thread.id))
          .run();
        beginProjectDeletion(harness.deps, {
          projectId: fixture.context.project.id,
        });
        await advanceProjectDeletion(harness.deps, {
          projectId: fixture.context.project.id,
        });
        expect(
          cleanupStatus,
          JSON.stringify(getEnvironment(harness.db, environmentId)),
        ).toBe(200);
        expect(getEnvironment(harness.db, environmentId)).toBeNull();
        expect(getProject(harness.db, fixture.context.project.id)).toBeNull();
      }),
  );
});
