import { appendThreadProvisioningEvent } from "../../../src/services/threads/thread-events.js";
import { requestThreadStopForCurrentState } from "../../../src/services/threads/thread-lifecycle.js";
import { prepareProviderEnvironment } from "../../../src/services/threads/thread-environment-placement.js";
import { withEnvironmentCleanupSlot } from "../../../src/services/environments/cleanup-concurrency.js";
import { registerTestHostRpcCapture } from "../../helpers/commands.js";
import { recordProvisionedEnvironmentWorkspace } from "@bb/db/internal-environment-lifecycle";
import { createThreadFromRequest } from "../../../src/services/threads/thread-create.js";
import {
  encodeClientTurnRequestIdNumber,
  systemThreadProvisioningEventDataSchema,
} from "@bb/domain";
import { requireThreadCommandEnvironment } from "../../../src/services/threads/thread-command-environment.js";
import { ensureThreadProvisionEnvironmentReady } from "../../../src/services/threads/thread-provisioning-environment.js";
import {
  saveThreadProvisionContext,
  createThreadStartup,
} from "../../../src/services/threads/thread-startup-store.js";
import { z } from "zod";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { handleUpdateEnvironmentDirectoryToolCall } from "../../../src/services/threads/thread-environment-directory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  listEvents,
  claimEnvironmentPath,
  createEnvironment,
  environments,
  getEnvironment,
  getPreparingEnvironment,
  getThread,
  getProject,
  pruneDestroyedEnvironments,
  reserveEnvironment,
  updatePreparingEnvironment,
  threads,
  updateThread,
} from "@bb/db";
import type { JsonValue } from "@bb/domain";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import type { PluginEnvironmentProviderDeclaration } from "@get-bb/plugin-sdk";
import { validatePluginEnvironmentProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import {
  markProviderEnvironmentAttached,
  cancelProviderEnvironmentCreation,
  sweepProviderEnvironment,
  sweepProviderLifecycles,
} from "../../../src/services/environments/environment-engine.js";
import { toEnvironmentResponse } from "../../../src/services/environments/environment-response.js";
import { setPluginEnvironmentProviderBridge } from "../../../src/services/plugins/plugin-environment-provider-registry.js";
import {
  advanceProjectDeletion,
  beginProjectDeletion,
} from "../../../src/services/projects/project-deletion.js";
import {
  runPeriodicSweeps,
  runEnvironmentProvisioningSweep,
} from "../../../src/services/system/periodic-sweeps.js";
import { toThreadResponseFromThread } from "../../../src/services/threads/thread-runtime-display.js";
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
      description: "Prepare a workspace for this thread.",
      icon: "Folder",
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
  let lastEnvironmentId: string | null = null;
  const row = () => {
    const attachedId = getThread(harness.db, thread.id)?.environmentId;
    const value =
      getPreparingEnvironment(harness.db, thread.id) ??
      (attachedId
        ? getEnvironment(harness.db, attachedId)
        : lastEnvironmentId === null
          ? null
          : getEnvironment(harness.db, lastEnvironmentId));
    if (value === null) throw new Error("Missing preparing environment");
    lastEnvironmentId = value.id;
    return value;
  };
  const ask = () => prepareProviderEnvironment(harness.deps, record, context);
  const settled = async () =>
    expect.poll(() => row().status).not.toBe("creating");
  const attach = () => {
    const prepared = row();
    if (prepared.hostId === null || prepared.path === null) {
      throw new Error("Environment is not ready");
    }
    const environment = getEnvironment(harness.db, prepared.id)!;
    harness.db
      .update(environments)
      .set({ status: "ready" })
      .where(eq(environments.id, environment.id))
      .run();
    markProviderEnvironmentAttached(harness.db, thread.id, environment.id);
    recordProvisionedEnvironmentWorkspace(
      harness.db,
      harness.hub,
      environment.id,
      {
        path: prepared.path,
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

function saveProviderStartup(
  harness: TestAppHarness,
  fixture: ReturnType<typeof setup>,
) {
  const context = createThreadStartup({
    clientRequestId: encodeClientTurnRequestIdNumber({ value: 1 }),
    environmentIntent: {
      type: "provider",
      environmentProviderId: fixture.record.provider.id,
      machine: fixture.context.machine,
      inputs: null,
      selectionResolved: true,
    },
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
  });
  context.state.provisionEventSequence = appendThreadProvisioningEvent(
    harness.deps,
    {
      threadId: fixture.thread.id,
      environmentId: null,
      provisioningId: context.state.provisioningId,
      status: "active",
      entries: [
        {
          type: "step",
          key: "workspace-started",
          text: "Preparing workspace",
          status: "started",
        },
      ],
    },
  );
  saveThreadProvisionContext({
    db: harness.db,
    replace: true,
    threadId: fixture.thread.id,
    context,
  });
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
  it("limits cleanup globally and per host, and releases slots after failures", async () =>
    withTestHarness(async (harness) => {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const activeHosts = new Set<string>();
      const started: string[] = [];
      let maximum = 0;
      const pending = ["a", "a", "b", "c", "d", "e"].map((hostId) =>
        withEnvironmentCleanupSlot(harness.db, hostId, async () => {
          expect(activeHosts.has(hostId)).toBe(false);
          activeHosts.add(hostId);
          started.push(hostId);
          maximum = Math.max(maximum, activeHosts.size);
          await gate;
          activeHosts.delete(hostId);
          if (hostId === "b") throw new Error("cleanup failed");
        }).catch((error: unknown) => {
          expect(error).toBeInstanceOf(Error);
          expect(String(error)).toContain("cleanup failed");
        }),
      );
      try {
        await expect.poll(() => started.length).toBe(4);
        expect(started).toEqual(["a", "b", "c", "d"]);
      } finally {
        release();
        await Promise.all(pending);
      }
      expect(started).toHaveLength(6);
      expect(maximum).toBe(4);
      expect(activeHosts.size).toBe(0);
    }));

  it("refuses a foreign path before setup and never hands it to cleanup", async () =>
    withTestHarness(async (harness) => {
      const hooks = vi.fn(async () => {});
      const remove = vi.fn(async () => ({ status: "removed" as const }));
      const fixture = setup(harness, {
        create: async () => ({
          status: "created",
          path: "/tmp/foreign/work",
          ownsPath: true,
        }),
        remove,
      });
      const foreign = seedProjectWithSource(harness.deps, {
        hostId: fixture.host.id,
        path: "/tmp/foreign",
      });
      createEnvironment(harness.db, harness.hub, {
        projectId: foreign.project.id,
        hostId: fixture.host.id,
        path: "/tmp/foreign",
        status: "ready",
        providerOwnsPath: true,
      });
      registerTestHostRpcCapture(harness.deps, {
        hostId: fixture.host.id,
        sessionId: fixture.session.id,
        onEnvironmentHook: hooks,
      });
      fixture.ask();
      await fixture.settled();
      expect(fixture.row()).toMatchObject({
        status: "error",
      });
      await cancelProviderEnvironmentCreation(harness.deps, fixture.thread.id);
      expect(hooks).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(fixture.row().teardownStatus).toBe("removed");
    }));

  it.each(["preparing environment", "attached environment"])(
    "preserves the original plugin owner of a %s",
    async (kind) =>
      withTestHarness(async (harness) => {
        const fixture = setup(harness, { policy: { retireGraceMs: 0 } });
        fixture.ask();
        await fixture.settled();
        const environmentId =
          kind === "attached environment" ? fixture.attach() : null;
        const create = vi.fn(fixture.record.provider.create);
        const remove = vi.fn(async () => ({ status: "removed" as const }));
        const replacement = {
          ...fixture.record,
          pluginId: "replacement",
          provider: { ...fixture.record.provider, create, remove },
        };
        setPluginEnvironmentProviderBridge({
          listEnvironmentProviders: () => [replacement],
          getEnvironmentProvider: () => replacement,
          invokeProvider: async (_id, _label, run) => ({
            ok: true,
            value: await run(),
          }),
          decisionTimeoutMs: 10_000,
        });
        if (environmentId === null) {
          expect(
            prepareProviderEnvironment(
              harness.deps,
              replacement,
              fixture.context,
            ),
          ).toMatchObject({ action: "reject" });
          await expect(
            cancelProviderEnvironmentCreation(harness.deps, fixture.thread.id),
          ).rejects.toThrow();
        } else {
          await sweepProviderEnvironment(harness.deps, environmentId);
          expect(
            getEnvironment(harness.db, environmentId)?.teardownStatus,
          ).not.toBe("removed");
        }
        expect(create).not.toHaveBeenCalled();
        expect(remove).not.toHaveBeenCalled();
      }),
  );

  it("persists verbose progress without broadcasting configuration changes", async () =>
    withTestHarness(async (harness) => {
      const fixture = setup(harness, {
        create: async ({ report }) => {
          for (let i = 0; i < 50; i += 1) report.log(`line ${i}\n`);
          return { status: "created", path: "/tmp/progress", ownsPath: false };
        },
      });
      const notify = vi.spyOn(harness.hub, "notifySystem");
      fixture.ask();
      await fixture.settled();
      expect(fixture.row().pendingLog).toContain("line 49");
      expect(
        notify.mock.calls.some(([changes]) =>
          changes.includes("config-changed"),
        ),
      ).toBe(false);
      notify.mockRestore();
    }));

  it("claim then terminal create failure never runs teardown in the original checkout", async () =>
    withTestHarness(async (harness) => {
      const hooks = vi.fn();
      const remove = vi.fn(async () => ({ status: "removed" as const }));
      const fixture = setup(harness, {
        create: async (context) => {
          expect(await context.experimental_claimPath("/tmp/project")).toBe(
            true,
          );
          return {
            status: "failed",

            message: "checkout create failed",
          };
        },
        remove,
      });
      registerTestHostRpcCapture(harness.deps, {
        hostId: fixture.host.id,
        sessionId: fixture.session.id,
        onEnvironmentHook: hooks,
      });
      fixture.ask();
      await fixture.settled();
      expect(fixture.row().providerOwnsPath).toBe(false);
      await cancelProviderEnvironmentCreation(harness.deps, fixture.thread.id);
      expect(remove).toHaveBeenCalledOnce();
      expect(hooks).not.toHaveBeenCalled();
      expect(fixture.row().claimPath).toBeNull();
    }));

  it("finalizes a workspace path already claimed by the same launch", async () =>
    withTestHarness(async (harness) => {
      const fixture = setup(harness, {
        create: async (context) => {
          expect(await context.experimental_claimPath("/tmp/project")).toBe(
            true,
          );
          context.report.log("Checkout prepared");
          return { status: "created", path: "/tmp/project", ownsPath: false };
        },
      });
      fixture.ask();
      await fixture.settled();
      expect(fixture.row().path).toBe("/tmp/project");
      expect(["provisioning", "ready"]).toContain(fixture.row().status);
    }));

  it.each([true, false])(
    "runs teardown only for ownsPath=%s, in provider order",
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
          },
        });
        fixture.ask();
        await fixture.settled();
        expect(fixture.row().status).toBe("provisioning");
        const environmentId = fixture.attach();
        await sweepProviderEnvironment(harness.deps, environmentId);
        expect(getEnvironment(harness.db, environmentId)?.teardownStatus).toBe(
          "removed",
        );
        expect(order).toEqual(
          ownsPath ? ["create", "teardown", "remove"] : ["create", "remove"],
        );
      }),
  );

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
    "refuses %s admission while another environment preparation owns the checkout",
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
        const target = getEnvironment(harness.db, fixture.row().id)!;
        harness.db
          .update(environments)
          .set({ status: "ready" })
          .where(eq(environments.id, target.id))
          .run();
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
          const context = createThreadStartup({
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
          });
          saveThreadProvisionContext({
            db: harness.db,
            replace: true,
            threadId: thread.id,
            context,
          });
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
      const competitor = seedThread(harness.deps, {
        projectId: fixture.context.project.id,
        status: "starting",
      });
      const second = reserveEnvironment(harness.db, {
        ...fixture.row(),
        ownerThreadId: competitor.id,
        status: "creating" as const,
        path: null,
        claimPath: null,
      });
      let cleanup: Promise<void> | undefined;
      try {
        expect(claimEnvironmentPath(harness.db, second, "/tmp/project")).toBe(
          false,
        );
        cleanup = cancelProviderEnvironmentCreation(
          harness.deps,
          fixture.thread.id,
        );
        expect(claimEnvironmentPath(harness.db, second, "/tmp/project")).toBe(
          false,
        );
      } finally {
        release();
        await cleanup;
      }
      expect(claimEnvironmentPath(harness.db, second, "/tmp/project")).toBe(
        true,
      );
    }));

  it("normalizes trailing slashes on claimed paths", async () =>
    withTestHarness(async (harness) => {
      const fixture = setup(harness, {
        create: async (context) => {
          await context.experimental_claimPath("/tmp/project/");
          return { status: "created", path: "/tmp/project/", ownsPath: false };
        },
      });
      fixture.ask();
      await fixture.settled();
      const competitor = seedThread(harness.deps, {
        projectId: fixture.context.project.id,
        status: "starting",
      });
      const second = reserveEnvironment(harness.db, {
        ...fixture.row(),
        ownerThreadId: competitor.id,
        status: "creating" as const,
        path: null,
        claimPath: null,
      });
      expect(claimEnvironmentPath(harness.db, second, "/tmp/project")).toBe(
        false,
      );
      expect(fixture.row().path).toBe("/tmp/project");
    }));

  it("preserves the attached path for live checkout exclusion", async () =>
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
      expect(getEnvironment(harness.db, environmentId)?.path).toBe(
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
          projectCheckout: {
            experimental_ownsPath: false,
            path: "/tmp/project",
          },
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
        projectCheckout: { experimental_ownsPath: false, path: "/tmp/project" },
        inputs: { branch: { kind: "existing", name: "release" } },
      };
      try {
        prepareProviderEnvironment(harness.deps, record, context);
        prepareProviderEnvironment(harness.deps, record, {
          ...context,
          thread: toThreadResponseFromThread(harness.deps, {
            thread: second,
          }),
          inputs: { branch: { kind: "existing", name: "feature" } },
        });
        await expect
          .poll(() => getPreparingEnvironment(harness.db, second.id)?.status)
          .toBe("error");
        expect(
          getPreparingEnvironment(harness.db, second.id)?.statusMessage,
        ).toContain("another thread is using this workspace");
        expect(switched).toEqual(["release"]);
        expect(fixture.row()).toMatchObject({
          hostId: fixture.host.id,
          claimPath: "/tmp/project",
          status: "creating",
        });
      } finally {
        release();
        await fixture.settled();
      }
      expect(fixture.row().status).toBe("provisioning");
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
        path: "/tmp/same-project-worktree",
        status: "ready",
        providerOwnsPath: true,
        environmentProvider: {
          environmentProviderId: "git-worktree",
          instanceKey: "worktree",
          selection: fixture.row().environmentProviderSelection!,
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
    "queues same-host %s cleanup and waits for the bounded batch",
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
            await gate;
            return { status: "removed" };
          },
        });
        fixture.ask();
        await fixture.settled();
        const second = seedThread(harness.deps, {
          projectId: fixture.context.project.id,
          status: "starting",
        });
        reserveEnvironment(harness.db, {
          ...fixture.row(),
          ownerThreadId: second.id,
          environmentProviderInstanceKey: second.id,
          path: "/tmp/second",
        });
        if (kind === "removal") {
          fixture.attach();
          const env = getPreparingEnvironment(harness.db, second.id)!;
          harness.db
            .update(environments)
            .set({ status: "ready" })
            .where(eq(environments.id, env.id))
            .run();
          markProviderEnvironmentAttached(harness.db, second.id, env.id);
        } else {
          for (const id of [fixture.thread.id, second.id]) {
            updatePreparingEnvironment(harness.db, {
              ...getPreparingEnvironment(harness.db, id)!,
              status: "error",
              teardownStatus: "running",
              retireAt: Date.now(),
            });
          }
        }
        let enumerated = false;
        const sweep = sweepProviderLifecycles(harness.deps).then(() => {
          enumerated = true;
        });
        try {
          await expect.poll(() => calls.length).toBe(1);
          expect(enumerated).toBe(false);
        } finally {
          release();
          await sweep;
        }
        expect(calls.sort()).toEqual([fixture.thread.id, second.id].sort());
        expect(enumerated).toBe(true);
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
      expect(fixture.row()).toMatchObject({
        id: environmentId,
      });
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
      reserveEnvironment(harness.db, {
        projectId: fixture.context.project.id,
        ownerThreadId: fixture.thread.id,
        environmentProviderId: fixture.record.provider.id,
        environmentProviderPluginId: fixture.record.pluginId,
        attempt: 7,
        status: "creating",
        environmentProviderInstanceKey: "durable-path-key",
        hostId: fixture.host.id,
        path: null,
        claimPath: null,
        providerOwnsPath: true,
        mergeBaseBranch: null,
        resource: null,
        statusMessage: "Preparing Test…",
        pendingLog: "",
        environmentProviderSelection: {
          machine: { type: "existing", hostId: fixture.host.id },
          inputs: null,
        },
        teardownStatus: null,
      });

      expect(fixture.ask().action).toBe("wait");
      await fixture.settled();
      expect(calls).toEqual([{ attempt: 7, pathKey: "durable-path-key" }]);
      expect(fixture.row()).toMatchObject({
        attempt: 7,
        environmentProviderInstanceKey: "durable-path-key",
        status: "provisioning",
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
      saveProviderStartup(harness, fixture);
      fixture.ask();
      await expect
        .poll(() => fixture.ask())
        .toMatchObject({ reason: "Cloning repository" });
      expect(fixture.row().pendingLog).toBe("");
      fixture.ask();
      const output = listEvents(harness.db, { threadId: fixture.thread.id })
        .filter((event) => event.type === "system/thread-provisioning")
        .flatMap(
          (event) =>
            systemThreadProvisioningEventDataSchema.parse(
              JSON.parse(event.data),
            ).entries,
        )
        .filter(
          (entry) => entry.type === "output" && entry.text === "clone output",
        );
      expect(output).toHaveLength(1);
      release();
      await fixture.settled();
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
      await cancelProviderEnvironmentCreation(harness.deps, fixture.thread.id);
      expect(events).toEqual([
        `create:${fixture.thread.id}`,
        "abort",
        `remove:${fixture.thread.id}`,
      ]);
      expect(fixture.row()).toMatchObject({
        status: "destroyed",
        teardownStatus: "removed",
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
      const cancellation = cancelProviderEnvironmentCreation(
        harness.deps,
        fixture.thread.id,
      );
      await expect.poll(() => events).toEqual(["create", "abort"]);
      release();
      await cancellation;
      expect(events).toEqual(["create", "abort", "create-stopped", "remove"]);
    }));

  it("keeps failed creation terminal and retries explicitly on the same row", async () =>
    withTestHarness(async (harness) => {
      const creates: string[] = [];
      const fixture = setup(harness, {
        policy: { pathKeys: "per-attempt" },
        create: async (context) => {
          creates.push(context.pathKey);
          return { status: "failed", message: "offline" };
        },
      });
      fixture.ask();
      await fixture.settled();
      const previousAttempt = fixture.row();
      const id = previousAttempt.id;
      for (let i = 0; i < 4; i++)
        expect(fixture.ask()).toMatchObject({
          action: "reject",
          message: "offline",
        });
      expect(creates).toHaveLength(1);
      await cancelProviderEnvironmentCreation(harness.deps, fixture.thread.id);
      fixture.ask();
      await fixture.settled();
      expect(
        updatePreparingEnvironment(harness.db, {
          ...previousAttempt,
          status: "provisioning",
        }),
      ).toBe(false);
      expect(fixture.row()).toMatchObject({ id, attempt: 2, status: "error" });
      expect(creates).toEqual([
        `${fixture.thread.id}-1`,
        `${fixture.thread.id}-2`,
      ]);
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
      const competingThread = seedThread(harness.deps, {
        projectId: fixture.context.project.id,
        status: "starting",
      });
      const context = {
        ...fixture.context,
        thread: toThreadResponseFromThread(harness.deps, {
          thread: competingThread,
        }),
      };
      prepareProviderEnvironment(harness.deps, fixture.record, context);
      try {
        await expect
          .poll(
            () =>
              getPreparingEnvironment(harness.db, competingThread.id)?.status,
          )
          .toBe("error");
        expect(
          getPreparingEnvironment(harness.db, competingThread.id)
            ?.statusMessage,
        ).toContain("cleanup is still pending");
      } finally {
        release();
        await removal;
      }
      await cancelProviderEnvironmentCreation(harness.deps, competingThread.id);
      prepareProviderEnvironment(harness.deps, fixture.record, context);
      await expect
        .poll(
          () => getPreparingEnvironment(harness.db, competingThread.id)?.status,
        )
        .toBe("provisioning");
    }));

  it("records a failed remove and retries after the core retry delay", async () =>
    withTestHarness(async (harness) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      let removes = 0;
      const fixture = setup(harness, {
        policy: { retireGraceMs: 0 },
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
      vi.setSystemTime(Date.now() + 60_001);
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

it("keeps one environment identity from provider creation through removal", async () => {
  await withTestHarness(async (harness) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixture = setup(harness, {
      policy: { retireGraceMs: 0 },
      create: async (context) => {
        await gate;
        return {
          status: "created",
          path: `/tmp/${context.pathKey}`,
          ownsPath: true,
          resource: { checkpoint: "allocated" },
        };
      },
    });
    fixture.ask();
    const reserved = fixture.row().id;
    expect(getEnvironment(harness.db, reserved)?.status).toBe("creating");
    release();
    await fixture.settled();
    expect(fixture.row().id).toBe(reserved);
    expect(fixture.attach()).toBe(reserved);
    expect(
      harness.db
        .select()
        .from(environments)
        .where(eq(environments.projectId, fixture.context.project.id))
        .all(),
    ).toHaveLength(1);
    await cancelProviderEnvironmentCreation(harness.deps, fixture.thread.id);
    expect(getEnvironment(harness.db, reserved)?.resource).toEqual({
      checkpoint: "allocated",
    });
    await sweepProviderEnvironment(harness.deps, reserved);
    expect(getEnvironment(harness.db, reserved)?.status).toBe("destroyed");
  });
});

it("shares one removal operation between cancellation and lifecycle sweeps", async () => {
  await withTestHarness(async (harness) => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const remove = vi.fn(async () => {
      await gate;
      return { status: "removed" as const };
    });
    const fixture = setup(harness, { remove });
    fixture.ask();
    await fixture.settled();
    const environmentId = fixture.row().id;
    const cancellation = cancelProviderEnvironmentCreation(
      harness.deps,
      fixture.thread.id,
    );
    await expect.poll(() => remove.mock.calls.length).toBe(1);
    const sweep = sweepProviderEnvironment(harness.deps, environmentId);
    const all = sweepProviderLifecycles(harness.deps);
    try {
      expect(fixture.row().teardownStatus).toBe("running");
      expect(remove).toHaveBeenCalledTimes(1);
    } finally {
      release();
      await Promise.all([cancellation, sweep, all]);
    }
    expect(remove).toHaveBeenCalledTimes(1);
    expect(getEnvironment(harness.db, environmentId)).toMatchObject({
      status: "destroyed",
      teardownStatus: "removed",
    });
  });
});

it("retries cancelled cleanup through environment teardown without dropping its checkpoint", async () => {
  await withTestHarness(async (harness) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const attempts: number[] = [];
    const fixture = setup(harness, {
      create: async () => ({
        status: "created",
        path: "/tmp/cancel-retry",
        ownsPath: false,
        resource: { allocation: "retained" },
      }),
      remove: async ({ attempt, resource }) => {
        attempts.push(attempt);
        expect(resource).toEqual({ allocation: "retained" });
        return attempts.length === 1
          ? { status: "failed", message: "temporarily unavailable" }
          : { status: "removed" };
      },
    });
    fixture.ask();
    await fixture.settled();
    await expect(
      cancelProviderEnvironmentCreation(harness.deps, fixture.thread.id),
    ).rejects.toThrow("temporarily unavailable");
    const failed = fixture.row();
    expect(failed).toMatchObject({
      status: "error",
      teardownStatus: "failed",
      claimPath: "/tmp/cancel-retry",
      resource: { allocation: "retained" },
    });
    await sweepProviderLifecycles(harness.deps);
    expect(attempts).toEqual([1]);
    vi.setSystemTime(failed.retireAt!);
    await sweepProviderLifecycles(harness.deps);
    expect(attempts).toEqual([1, 2]);
    expect(fixture.row()).toMatchObject({
      id: failed.id,
      status: "destroyed",
      teardownStatus: "removed",
      claimPath: null,
      resource: null,
    });
  });
});

it("prepares a previously removed path without inheriting completed teardown", async () => {
  await withTestHarness(async (harness) => {
    const remove = vi.fn(async () => ({ status: "removed" as const }));
    const fixture = setup(harness, { remove });
    fixture.ask();
    await fixture.settled();
    const environmentId = fixture.row().id;
    await cancelProviderEnvironmentCreation(harness.deps, fixture.thread.id);
    fixture.ask();
    await fixture.settled();
    expect(fixture.row()).toMatchObject({
      attempt: 2,
      status: "provisioning",
      teardownStatus: null,
    });
    await cancelProviderEnvironmentCreation(harness.deps, fixture.thread.id);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(getEnvironment(harness.db, environmentId)?.teardownStatus).toBe(
      "removed",
    );
    expect(fixture.row().teardownStatus).toBe("removed");
  });
});

it("keeps reserved environments provisioning while a provider creates their workspace", async () => {
  await withTestHarness(async (harness) => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixture = setup(harness, {
      create: async () => {
        await gate;
        return {
          status: "created",
          path: "/tmp/swept-workspace",
          ownsPath: true,
        };
      },
    });
    fixture.ask();
    try {
      await runEnvironmentProvisioningSweep(harness.deps);
      expect(fixture.row()).toMatchObject({
        status: "creating",
      });
    } finally {
      release();
      await fixture.settled();
    }
    await runEnvironmentProvisioningSweep(harness.deps);
    expect(fixture.row()).toMatchObject({
      status: "provisioning",
    });
  });
});

it("keeps a shared workspace ready when its preparing owner cancels before attachment", async () => {
  await withTestHarness(async (harness) => {
    const remove = vi.fn(async () => ({ status: "removed" as const }));
    const fixture = setup(harness, {
      create: async () => ({
        status: "created",
        path: "/tmp/shared-ready",
        ownsPath: false,
      }),
      remove,
    });
    const shared = createEnvironment(harness.db, harness.hub, {
      projectId: fixture.context.project.id,
      hostId: fixture.host.id,
      path: "/tmp/shared-ready",
      status: "ready",
      providerOwnsPath: false,
    });
    const existingThread = seedThread(harness.deps, {
      projectId: fixture.context.project.id,
      environmentId: shared.id,
      status: "idle",
    });
    fixture.ask();
    await expect
      .poll(() => getPreparingEnvironment(harness.db, fixture.thread.id)?.id)
      .toBe(shared.id);
    expect(getEnvironment(harness.db, shared.id)).toMatchObject({
      status: "ready",
      ownerThreadId: fixture.thread.id,
    });
    expect(getThread(harness.db, fixture.thread.id)?.environmentId).toBeNull();
    saveProviderStartup(harness, fixture);
    requestThreadStopForCurrentState(harness.deps, fixture.thread, null);
    await expect
      .poll(() => getEnvironment(harness.db, shared.id)?.ownerThreadId)
      .toBeNull();
    expect(getEnvironment(harness.db, shared.id)).toMatchObject({
      status: "ready",
      claimPath: null,
      teardownStatus: null,
      retireAt: null,
    });
    expect(getThread(harness.db, existingThread.id)?.environmentId).toBe(
      shared.id,
    );
    expect(getThread(harness.db, fixture.thread.id)?.status).toBe("idle");
    const transcript = listEvents(harness.db, {
      threadId: fixture.thread.id,
    }).filter((event) => event.type === "system/thread-provisioning");
    expect(
      systemThreadProvisioningEventDataSchema.parse(
        JSON.parse(transcript.at(-1)!.data),
      ).status,
    ).toBe("cancelled");
    expect(remove).not.toHaveBeenCalled();
  });
});
