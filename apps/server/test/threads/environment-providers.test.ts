import { createDeferredPromise } from "@bb/test-helpers";
import { resolveGitCheckoutAvailability } from "../../src/services/environments/provider-availability.js";
import { invalidateEnvironmentProviderMachineAvailability } from "../../src/services/environments/provider-machine-availability.js";
import {
  providerOperations,
  type TestEnvironmentProviderContext,
  type TestProviderDecision,
} from "../helpers/provider-decisions.js";
import {
  createEnvironment,
  createProjectSource,
  ensurePersonalProject,
  getEnvironment,
  getEnvironmentLaunch,
  getDefaultProjectSource,
  getThread,
  listEnvironments,
  listEvents,
} from "@bb/db";
import { PERSONAL_PROJECT_ID, type JsonValue } from "@bb/domain";
import type {
  PluginDispatchEnvironmentIntent,
  PluginEnvironmentProviderDeclaration,
  PluginEnvironmentValidateDecision,
  PluginHookName,
} from "@get-bb/plugin-sdk";
import type { PluginEnvironmentProviderValidateContext } from "@get-bb/plugin-sdk/environment-provider";
import { validatePluginEnvironmentProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError } from "../../src/errors.js";
import {
  setPluginEnvironmentProviderBridge,
  type PluginEnvironmentProviderRecord,
} from "../../src/services/plugins/plugin-environment-provider-registry.js";
import {
  setPluginHookProvider,
  type PluginHookRegistration,
} from "../../src/services/plugins/plugin-hook-registry.js";
import { attemptDispatch } from "../../src/services/threads/dispatch-attempt.js";
import {
  recheckEnvironmentProviderLaunches,
  scheduledEnvironmentProviderAskCount,
} from "../../src/services/threads/thread-environment-providers.js";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import {
  forgetAllActiveThreadProvisionContexts,
  getActiveThreadProvisionContext,
} from "../../src/services/threads/thread-provisioning-active-context.js";
import {
  registerTestHostRpcCapture,
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHost,
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const WORKSPACE_PATH = "/tmp/environment-providers-project";
const PLUGIN_ID = "sandbox";
const PROVIDER_ID = "container";

interface FakeTarget {
  id?: string;
  remove?: PluginEnvironmentProviderDeclaration["remove"];
  provision: (
    context: TestEnvironmentProviderContext,
  ) => TestProviderDecision | Promise<TestProviderDecision>;
  requiresProjectCheckout?: boolean;
  requiresGitCheckout?: boolean;
  requiresGitRemote?: boolean;
  requiresProjectless?: boolean;
  inputs?: z.ZodType;
  validate?: (
    context: PluginEnvironmentProviderValidateContext,
  ) =>
    | PluginEnvironmentValidateDecision
    | Promise<PluginEnvironmentValidateDecision>;
  availability?: PluginEnvironmentProviderDeclaration["availability"];
}

const CONTAINER_INPUTS = z.object({
  image: z.string().min(1),
  cpus: z.number().int().positive().default(2),
});

function installTargets(fakes: FakeTarget[]): void {
  const records: PluginEnvironmentProviderRecord[] = fakes.map((fake) => ({
    pluginId: PLUGIN_ID,
    provider: validatePluginEnvironmentProviderDeclaration({
      id: fake.id ?? PROVIDER_ID,
      displayName: "Fake container",
      requires: {
        projectCheckout: fake.requiresProjectCheckout ?? false,
        gitCheckout: fake.requiresGitCheckout ?? false,
        gitRemote: fake.requiresGitRemote ?? false,
        projectless: fake.requiresProjectless ?? false,
      },
      ...(fake.inputs === undefined ? {} : { inputs: fake.inputs }),
      ...(fake.validate === undefined ? {} : { validate: fake.validate }),
      ...(fake.availability === undefined
        ? {}
        : { availability: fake.availability }),
      ...providerOperations(fake.provision),
      ...(fake.remove === undefined ? {} : { remove: fake.remove }),
    }),
  }));
  setPluginEnvironmentProviderBridge({
    listEnvironmentProviders: () => records,
    getEnvironmentProvider: (id) =>
      records.find((record) => record.provider.id === id),
    invokeProvider: async (_pluginId, _label, run) => {
      try {
        return { ok: true, value: await run() };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    decisionTimeoutMs: 10_000,
  });
}

function installTarget(fake: FakeTarget | null): void {
  installTargets(fake === null ? [] : [fake]);
}

function installEnvironmentIntentProbe(): PluginDispatchEnvironmentIntent[] {
  const environmentIntents: PluginDispatchEnvironmentIntent[] = [];
  const registry: {
    [K in PluginHookName]: PluginHookRegistration<K>[];
  } = { "message.dispatch": [] };
  registry["message.dispatch"].push({
    pluginId: "observer",
    handler: (context) => {
      if (context.environmentIntent !== null)
        environmentIntents.push(context.environmentIntent);
      return { action: "proceed" } as const;
    },
  });
  setPluginHookProvider({
    listHooks: (hook) => registry[hook],
    invokeHook: async (_pluginId, _label, run) => ({
      ok: true,
      value: await run(),
    }),
    decisionTimeoutMs: 10_000,
  });
  return environmentIntents;
}

afterEach(() => {
  forgetAllActiveThreadProvisionContexts();
  setPluginEnvironmentProviderBridge(undefined);
  setPluginHookProvider(undefined);
});

function seedTargetFixture(
  harness: TestAppHarness,
  hostId: string,
  args: { environmentProviderId?: string } = {},
) {
  const { host, session } = seedHostSession(harness.deps, { id: hostId });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: WORKSPACE_PATH,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: WORKSPACE_PATH,
    ...(args.environmentProviderId === undefined
      ? {}
      : {
          environmentProviderId: args.environmentProviderId,
          environmentProviderPluginId: PLUGIN_ID,
        }),
  });
  return { environment, host, project, session };
}

function createTargetThread(
  harness: TestAppHarness,
  args: {
    projectId: string;
    inputs?: JsonValue | null;
    hostId?: string | null;
    model?: string | undefined;
    environmentProviderId?: string;
  },
) {
  const model = "model" in args ? args.model : "requested-model";
  const source = getDefaultProjectSource(harness.db, args.projectId);
  const sourceHostId = source?.type === "local_path" ? source.hostId : null;
  const hostId = args.hostId ?? sourceHostId ?? "host-1";
  return createThreadFromRequest(harness.deps, {
    environment: {
      type: "provider",
      environmentProviderId: args.environmentProviderId ?? PROVIDER_ID,
      machine: { type: "existing", hostId },
      inputs: args.inputs ?? null,
    },
    input: textInput("Do the thing"),
    origin: "app",
    projectId: args.projectId,
    providerId: "codex",
    ...(model !== undefined ? { model } : {}),
    startedOnBehalfOf: null,
  });
}

function provisioningEvents(harness: TestAppHarness, threadId: string) {
  return listEvents(harness.db, { threadId })
    .filter((event) => event.type === "system/thread-provisioning")
    .map(
      (event) =>
        JSON.parse(event.data) as {
          status: string;
          environmentId: string | null;
          entries: Array<{ type: string; key: string; text: string }>;
        },
    );
}

function blockEntries(harness: TestAppHarness, threadId: string) {
  return provisioningEvents(harness, threadId).flatMap((event) =>
    event.entries.map((entry) => [entry.type, entry.text] as const),
  );
}

function readyAt(host: { id: string }): TestProviderDecision {
  return {
    action: "ready",
    environment: {
      type: "host",
      hostId: host.id,
      path: WORKSPACE_PATH,
    },
  };
}

describe("environment providers are asked inside provisioning", () => {
  it("shares a projectless parent's personal workspace when no environment flags are supplied", async () => {
    await withTestHarness(async (harness) => {
      installTargets([
        {
          id: "personal-workspace",
          provision: () => ({
            action: "wait",
            reason: "Preparing personal workspace",
          }),
          requiresProjectless: true,
        },
      ]);
      const { host } = seedHostSession(harness.deps, {
        id: "host-projectless-child",
      });
      seedPrimaryHost(harness.deps, host.id);
      ensurePersonalProject(harness.db);
      const parentEnvironment = createEnvironment(harness.db, harness.hub, {
        providerOwnsPath: true,
        hostId: host.id,
        projectId: PERSONAL_PROJECT_ID,
        path: "/tmp/projectless-parent",
        status: "ready",
        environmentProvider: {
          environmentProviderId: "personal-workspace",
          instanceKey: null,
          selection: {
            machine: { type: "existing", hostId: host.id },
            inputs: null,
          },
        },
      });
      const parent = seedThread(harness.deps, {
        environmentId: parentEnvironment.id,
        projectId: PERSONAL_PROJECT_ID,
        status: "idle",
      });

      const child = await createThreadFromRequest(harness.deps, {
        environment: { type: "project-default" },
        input: textInput("Do the thing"),
        origin: "cli",
        parentThreadId: parent.id,
        projectId: PERSONAL_PROJECT_ID,
        providerId: "codex",
        model: "requested-model",
        startedOnBehalfOf: null,
      });

      expect(
        getActiveThreadProvisionContext(child.id)?.request.environmentIntent,
      ).toEqual({
        type: "reuse",
        environmentId: parentEnvironment.id,
      });
    });
  });

  it("opens the workspace-setup block and parks the thread starting on a wait", async () => {
    await withTestHarness(async (harness) => {
      const contexts: TestEnvironmentProviderContext[] = [];
      installTarget({
        inputs: CONTAINER_INPUTS,
        provision: (context) => {
          contexts.push(context);
          return { action: "wait", reason: "Starting container…" };
        },
      });
      const { project } = seedTargetFixture(harness, "host-target-wait");
      const created = await createTargetThread(harness, {
        projectId: project.id,
        inputs: { image: "img" },
      });

      await vi.waitFor(() => {
        expect(blockEntries(harness, created.id)).toContainEqual([
          "step",
          "Starting container…",
        ]);
      });
      const thread = getThread(harness.db, created.id);
      expect(thread?.status).toBe("starting");
      expect(thread?.environmentId).toBeNull();
      expect(contexts.length).toBeGreaterThanOrEqual(1);
      expect(contexts[0]?.thread.id).toBe(created.id);
      expect(contexts[0]?.inputs).toEqual({ image: "img", cpus: 2 });
      const entries = blockEntries(harness, created.id);
      expect(entries[0]).toEqual(["step", "Preparing workspace"]);
      expect(
        provisioningEvents(harness, created.id).every(
          (event) => event.status === "active" && event.environmentId === null,
        ),
      ).toBe(true);
      expect(scheduledEnvironmentProviderAskCount()).toBe(1);
    });
  });

  it("passes transformed inputs to create without parsing them twice", async () => {
    await withTestHarness(async (harness) => {
      const inputs: JsonValue[] = [];
      installTarget({
        inputs: z.string().transform(Number),
        provision: (context) => {
          inputs.push(context.inputs);
          return { action: "wait", reason: "Starting container…" };
        },
      });
      const { project } = seedTargetFixture(
        harness,
        "host-target-transformed-inputs",
      );
      await createTargetThread(harness, {
        projectId: project.id,
        inputs: "2",
      });

      await expect.poll(() => inputs).toEqual([2]);
    });
  });

  it("attaches the provisioning environment before provider-owned setup completes", async () => {
    await withTestHarness(async (harness) => {
      const { host, project, session } = seedTargetFixture(
        harness,
        "host-target-provider-setup",
      );
      const producedPath = "/tmp/environment-providers-owned-setup";
      registerTestHostRpcCapture(harness, {
        hostId: host.id,
        sessionId: session.id,
      });
      installTarget({
        provision: () => ({
          action: "ready",
          environment: {
            type: "host",
            hostId: host.id,
            mergeBaseBranch: "origin/main",
            ownsPath: true,
            path: producedPath,
          },
        }),
      });

      const created = await createTargetThread(harness, {
        projectId: project.id,
      });
      const queued = await waitForQueuedCommand(
        harness,
        (candidate) => candidate.command.type === "environment.attach",
      );
      if (queued.command.type !== "environment.attach") {
        throw new Error("Expected environment.attach command");
      }
      const environmentId = queued.command.environmentId;

      const thread = getThread(harness.db, created.id);
      expect(thread?.environmentId).toBe(environmentId);
      expect(getEnvironment(harness.db, environmentId)).toMatchObject({
        hostId: host.id,
        mergeBaseBranch: "origin/main",
        path: producedPath,
        providerOwnsPath: true,
        status: "provisioning",
      });
      expect(queued.command).toMatchObject({
        path: producedPath,
        setupScriptTimeoutMs: 15 * 60 * 1_000,
      });

      await reportQueuedCommandSuccess(harness, queued, {
        branchName: "feature/provider-setup",
        defaultBranch: "main",
        isGitRepo: true,
        isWorktree: true,
        path: producedPath,
      });
      await vi.waitFor(() => {
        expect(getEnvironment(harness.db, environmentId)?.status).toBe("ready");
      });
    });
  });

  it("keeps the attached environment for diagnosis when provider-owned setup fails", async () => {
    await withTestHarness(async (harness) => {
      const { host, project, session } = seedTargetFixture(
        harness,
        "host-target-provider-setup-failure",
      );
      const producedPath = "/tmp/environment-providers-setup-failure";
      registerTestHostRpcCapture(harness, {
        hostId: host.id,
        sessionId: session.id,
      });
      installTarget({
        provision: () => ({
          action: "ready",
          environment: {
            type: "host",
            hostId: host.id,
            path: producedPath,
          },
        }),
      });

      const created = await createTargetThread(harness, {
        projectId: project.id,
      });
      const queued = await waitForQueuedCommand(
        harness,
        (candidate) => candidate.command.type === "environment.attach",
      );
      if (queued.command.type !== "environment.attach") {
        throw new Error("Expected environment.attach command");
      }
      const environmentId = queued.command.environmentId;

      await reportQueuedCommandError(harness, queued, {
        errorCode: "setup_script_failed",
        errorMessage: ".bb-env-setup.sh failed with exit code 7",
      });
      await vi.waitFor(() => {
        expect(getThread(harness.db, created.id)).toMatchObject({
          environmentId,
          status: "error",
        });
        expect(getEnvironment(harness.db, environmentId)).toMatchObject({
          path: producedPath,
          status: "error",
        });
      });
    });
  });

  it("attaches a ready answer through placement and tells the hook the environment intent", async () => {
    await withTestHarness(async (harness) => {
      const environmentIntents = installEnvironmentIntentProbe();
      const { environment, host, project, session } = seedTargetFixture(
        harness,
        "host-target-ready",
        { environmentProviderId: PROVIDER_ID },
      );
      let provisioningThreadId: string | null = null;
      const refreshAssignments: Array<{
        launch: string | null;
        thread: string | null;
      }> = [];
      registerTestHostRpcCapture(harness, {
        hostId: host.id,
        sessionId: session.id,
        onInspectGitSource: () => {
          if (provisioningThreadId === null) return;
          refreshAssignments.push({
            launch:
              getEnvironmentLaunch(harness.db, provisioningThreadId)
                ?.environmentId ?? null,
            thread:
              getThread(harness.db, provisioningThreadId)?.environmentId ??
              null,
          });
        },
      });
      installTarget({
        inputs: CONTAINER_INPUTS,
        provision: (context) => {
          provisioningThreadId = context.thread.id;
          return readyAt(host);
        },
      });
      const created = await createTargetThread(harness, {
        projectId: project.id,
        inputs: { image: "img", cpus: 4 },
      });

      await vi.waitFor(() => {
        expect(getThread(harness.db, created.id)?.environmentId).toBe(
          environment.id,
        );
      });
      expect(refreshAssignments).toEqual([{ launch: null, thread: null }]);
      expect(getEnvironmentLaunch(harness.db, created.id)?.environmentId).toBe(
        environment.id,
      );
      expect(getThread(harness.db, created.id)?.status).toBe("starting");
      expect(environmentIntents).toEqual([
        {
          kind: "provider",
          environmentProviderId: PROVIDER_ID,
          machine: { type: "existing", hostId: host.id },
          inputs: { image: "img", cpus: 4 },
        },
      ]);
      expect(scheduledEnvironmentProviderAskCount()).toBe(0);
    });
  });

  it("re-asks on recheck and streams steps and output into the block", async () => {
    await withTestHarness(async (harness) => {
      let ask = 0;
      const cloning = createDeferredPromise<void>();
      const ready = createDeferredPromise<void>();
      const { environment, host, project } = seedTargetFixture(
        harness,
        "host-target-recheck",
        { environmentProviderId: PROVIDER_ID },
      );
      installTarget({
        provision: async () => {
          ask += 1;
          if (ask === 1) {
            return { action: "wait", reason: "Starting container…" };
          }
          if (ask === 2) {
            await cloning.promise;
            return {
              action: "wait",
              reason: "Cloning repository…",
              log: "cloned 100 objects",
            };
          }
          await ready.promise;
          return { ...readyAt(host), log: "scripts/setup.sh: done" };
        },
      });
      try {
        const created = await createTargetThread(harness, {
          projectId: project.id,
        });
        await vi.waitFor(() => {
          expect(blockEntries(harness, created.id)).toContainEqual([
            "step",
            "Starting container…",
          ]);
        });

        cloning.resolve();
        recheckEnvironmentProviderLaunches(harness.deps, PLUGIN_ID);
        await vi.waitFor(() => {
          expect(blockEntries(harness, created.id)).toContainEqual([
            "output",
            "cloned 100 objects",
          ]);
        });
        ready.resolve();
        recheckEnvironmentProviderLaunches(harness.deps, PLUGIN_ID);
        await vi.waitFor(() => {
          expect(getThread(harness.db, created.id)?.environmentId).toBe(
            environment.id,
          );
        });

        const entries = blockEntries(harness, created.id);
        const targetEntries = entries.filter(
          ([, text]) =>
            text.includes("container") ||
            text.includes("repository") ||
            text.includes("cloned") ||
            text.includes("setup.sh"),
        );
        expect(targetEntries).toEqual([
          ["step", "Preparing Fake container…"],
          ["step", "Preparing Fake container…"],
          ["step", "Starting container…"],
          ["step", "Starting container…"],
          ["step", "Cloning repository…"],
          ["output", "cloned 100 objects"],
          ["step", "Cloning repository…"],
          ["output", "scripts/setup.sh: done"],
        ]);
        expect(scheduledEnvironmentProviderAskCount()).toBe(0);
      } finally {
        cloning.resolve();
        ready.resolve();
      }
    });
  });

  it("preserves a launch recheck that overlaps an in-flight provisioning advance", async () => {
    await withTestHarness(async (harness) => {
      const createReady = createDeferredPromise<void>();
      const firstAdvanceFinished = createDeferredPromise<void>();
      const releaseFirstAdvance = createDeferredPromise<void>();
      const { environment, host, project } = seedTargetFixture(
        harness,
        "host-target-overlapping-recheck",
        { environmentProviderId: PROVIDER_ID },
      );
      installTarget({
        provision: async () => {
          await createReady.promise;
          return readyAt(host);
        },
      });

      let pendingAdvance: Promise<void> | null = null;
      let coalescedAdvanceCount = 0;
      harness.deps.lifecycleDedupers.threadProvisionAdvance = {
        run(_threadId, task) {
          if (pendingAdvance !== null) {
            coalescedAdvanceCount += 1;
            return pendingAdvance;
          }
          const started = (async () => {
            await task();
            firstAdvanceFinished.resolve();
            await releaseFirstAdvance.promise;
          })();
          pendingAdvance = started.finally(() => {
            pendingAdvance = null;
          });
          return pendingAdvance;
        },
      };

      try {
        const created = await createTargetThread(harness, {
          projectId: project.id,
        });
        await firstAdvanceFinished.promise;
        createReady.resolve();
        await vi.waitFor(() => {
          expect(getEnvironmentLaunch(harness.db, created.id)?.phase).toBe(
            "ready",
          );
        });
        await vi.waitFor(() => {
          expect(coalescedAdvanceCount).toBeGreaterThan(0);
        });
        releaseFirstAdvance.resolve();
        await vi.waitFor(() => {
          expect(getThread(harness.db, created.id)?.environmentId).toBe(
            environment.id,
          );
        });
      } finally {
        createReady.resolve();
        releaseFirstAdvance.resolve();
      }
    });
  });

  it("refuses a host answer naming a path another provider's row holds", async () => {
    await withTestHarness(async (harness) => {
      const { host, project, session } = seedTargetFixture(
        harness,
        "host-target-foreign-path",
      );
      registerTestHostRpcCapture(harness, {
        hostId: host.id,
        sessionId: session.id,
      });
      const foreign = seedEnvironment(harness.deps, {
        environmentProviderId: "git-worktree",
        hostId: host.id,
        path: "/tmp/environment-providers-foreign",
        projectId: project.id,
      });
      installTarget({
        provision: () => ({
          action: "ready",
          environment: {
            type: "host",
            hostId: host.id,
            path: "/tmp/environment-providers-foreign",
          },
        }),
      });
      const created = await createTargetThread(harness, {
        projectId: project.id,
      });
      await vi.waitFor(() => {
        expect(getThread(harness.db, created.id)?.status).toBe("error");
      });
      const error = listEvents(harness.db, { threadId: created.id }).find(
        (event) => event.type === "system/error",
      );
      const detail = (JSON.parse(error?.data ?? "null") as { detail: string })
        .detail;
      expect(detail).toContain(`"${PROVIDER_ID}" environment provider`);
      expect(detail).toContain('which the "git-worktree" environment provider');
      expect(
        getEnvironment(harness.db, foreign.id)?.environmentProviderId,
      ).toBe("git-worktree");
      expect(getThread(harness.db, created.id)?.environmentId).toBeNull();
    });
  });

  it("records the branch a reused host row is on when the provider answers with its path", async () => {
    await withTestHarness(async (harness) => {
      const { host, project, session } = seedTargetFixture(
        harness,
        "host-target-refresh-branch",
      );
      const attached = seedEnvironment(harness.deps, {
        branchName: "main",
        environmentProviderId: PROVIDER_ID,
        environmentProviderPluginId: PLUGIN_ID,
        environmentProviderInstanceKey: "old-instance",
        environmentProviderSelection: {
          machine: { type: "existing", hostId: "old-host" },
          inputs: { stale: true },
        },
        hostId: host.id,
        path: "/tmp/environment-providers-refresh-branch",
        projectId: project.id,
      });
      const inspected: string[] = [];
      registerTestHostRpcCapture(harness, {
        hostId: host.id,
        sessionId: session.id,
        gitSourceInspectionResult: {
          isWorktree: false,
          checkout: {
            kind: "branch",
            branchName: "release",
            headSha: "def456",
          },
          defaultBranch: "main",
          defaultBranchRelation: "local-ahead",
          hasUncommittedChanges: false,
          operation: { kind: "none" },
          originDefaultBranch: "origin/main",
        },
        onInspectGitSource: (command) => {
          inspected.push(command.path);
        },
      });
      installTarget({
        provision: () => ({
          action: "ready",
          environment: {
            type: "host",
            hostId: host.id,
            path: "/tmp/environment-providers-refresh-branch",
          },
        }),
      });
      const created = await createTargetThread(harness, {
        projectId: project.id,
      });
      await vi.waitFor(() => {
        expect(getEnvironment(harness.db, attached.id)?.branchName).toBe(
          "release",
        );
      });
      expect(getThread(harness.db, created.id)?.environmentId).toBe(
        attached.id,
      );
      expect(inspected).toEqual(["/tmp/environment-providers-refresh-branch"]);
      expect(getEnvironment(harness.db, attached.id)).toMatchObject({
        environmentProviderInstanceKey: created.id,
        environmentProviderSelection: {
          machine: { type: "existing", hostId: host.id },
          inputs: null,
        },
      });
    });
  });

  it("fails the thread with the plugin named when provision throws", async () => {
    await withTestHarness(async (harness) => {
      installTarget({
        provision: () => {
          throw new Error("docker daemon unreachable");
        },
      });
      const { project } = seedTargetFixture(harness, "host-target-throw");
      const created = await createTargetThread(harness, {
        projectId: project.id,
      });
      await vi.waitFor(() => {
        expect(getThread(harness.db, created.id)?.status).toBe("error");
      });
      const error = listEvents(harness.db, { threadId: created.id }).find(
        (event) => event.type === "system/error",
      );
      const detail = (JSON.parse(error?.data ?? "null") as { detail: string })
        .detail;
      expect(detail).toContain(PLUGIN_ID);
      expect(detail).toContain("docker daemon unreachable");
      expect(provisioningEvents(harness, created.id).at(-1)?.status).toBe(
        "failed",
      );
      expect(scheduledEnvironmentProviderAskCount()).toBe(0);
    });
  });

  it("retries a provider launch on the next send after failure before a row attaches", async () => {
    await withTestHarness(async (harness) => {
      const { environment, host, project } = seedTargetFixture(
        harness,
        "host-target-retry-pre-row",
        { environmentProviderId: PROVIDER_ID },
      );
      installTarget({
        provision: () => {
          throw new Error("temporary launch failure");
        },
      });
      const created = await createTargetThread(harness, {
        projectId: project.id,
      });
      await vi.waitFor(() => {
        expect(getThread(harness.db, created.id)?.status).toBe("error");
      });

      const asks: string[] = [];
      installTarget({
        provision: (context) => {
          asks.push(context.thread.id);
          return readyAt(host);
        },
      });
      const failedThread = getThread(harness.db, created.id);
      expect(failedThread).not.toBeNull();
      if (failedThread === null) return;

      const outcome = await attemptDispatch(harness.deps, {
        thread: failedThread,
        payload: { input: textInput("Retry the task"), mode: "start" },
        source: { kind: "inline" },
        queuePayload: { kind: "inline" },
        origin: null,
        originPluginId: null,
        startedOnBehalfOf: null,
        trigger: "user",
      });

      expect(outcome.kind).toBe("dispatched");
      await vi.waitFor(() => {
        expect(getThread(harness.db, created.id)?.environmentId).toBe(
          environment.id,
        );
      });
      expect(asks).toEqual([created.id]);
      expect(getThread(harness.db, created.id)?.status).toBe("starting");
    });
  });

  it("fails the thread with the target's message when it rejects", async () => {
    await withTestHarness(async (harness) => {
      installTarget({
        provision: () => ({
          action: "reject",
          message: "Choose a container image.",
        }),
      });
      const { project } = seedTargetFixture(harness, "host-target-reject");
      const created = await createTargetThread(harness, {
        projectId: project.id,
      });
      await vi.waitFor(() => {
        expect(getThread(harness.db, created.id)?.status).toBe("error");
      });
      const error = listEvents(harness.db, { threadId: created.id }).find(
        (event) => event.type === "system/error",
      );
      expect(
        (JSON.parse(error?.data ?? "null") as { detail: string }).detail,
      ).toBe("Choose a container image.");
    });
  });

  it("rejects an unknown environment provider at create", async () => {
    await withTestHarness(async (harness) => {
      installTarget(null);
      const { project } = seedTargetFixture(harness, "host-target-missing");
      const failed = await createTargetThread(harness, {
        projectId: project.id,
      }).then(
        () => null,
        (error: unknown) => error,
      );
      expect(failed).toBeInstanceOf(ApiError);
      expect((failed as ApiError).status).toBe(400);
      expect((failed as ApiError).body.code).toBe("invalid_request");
      expect((failed as ApiError).message).toBe("unknown environment provider");
      expect(scheduledEnvironmentProviderAskCount()).toBe(0);
    });
  });

  it("refuses a checkout provider that needs no git on a machine without the project", async () => {
    await withTestHarness(async (harness) => {
      installTargets([
        {
          provision: () => ({ action: "wait", reason: "…" }),
          requiresProjectCheckout: true,
        },
      ]);
      const { project } = seedTargetFixture(harness, "host-target-checkout");
      const { host: bare } = seedHostSession(harness.deps, {
        id: "host-target-bare",
      });
      const failed = await createTargetThread(harness, {
        projectId: project.id,
        hostId: bare.id,
      }).then(
        () => null,
        (error: unknown) => error,
      );
      expect(failed).toBeInstanceOf(ApiError);
      expect((failed as ApiError).body.code).toBe("invalid_request");
      expect((failed as ApiError).message).toContain("No project source");
    });
  });

  it("refuses a projectless-only provider for a thread in a project", async () => {
    await withTestHarness(async (harness) => {
      installTargets([
        {
          provision: () => ({ action: "wait", reason: "…" }),
          requiresProjectless: true,
        },
      ]);
      const { project } = seedTargetFixture(harness, "host-target-projectless");
      const failed = await createTargetThread(harness, {
        projectId: project.id,
      }).then(
        () => null,
        (error: unknown) => error,
      );
      expect(failed).toBeInstanceOf(ApiError);
      expect((failed as ApiError).body.code).toBe("invalid_request");
      expect((failed as ApiError).message).toContain("no project");
    });
  });

  it("refuses a git-remote provider without a remote when validate is absent", async () => {
    await withTestHarness(async (harness) => {
      installTarget({
        requiresGitRemote: true,
        provision: () => ({ action: "wait", reason: "…" }),
      });
      const { project } = seedTargetFixture(harness, "host-target-no-remote");
      const failed = await createTargetThread(harness, {
        projectId: project.id,
      }).then(
        () => null,
        (error: unknown) => error,
      );
      expect(failed).toBeInstanceOf(ApiError);
      if (!(failed instanceof ApiError)) {
        throw new Error("expected provider selection to be rejected");
      }
      expect(failed.body.code).toBe("environment_provider_rejected");
      expect(failed.message).toContain("has no git remote");
    });
  });

  it("applies git-checkout availability eligibility to explicit selection", async () => {
    await withTestHarness(async (harness) => {
      installTarget({
        requiresGitCheckout: true,
        provision: () => ({ action: "wait", reason: "…" }),
      });
      const { host, project, session } = seedTargetFixture(
        harness,
        "host-target-unusable-git-checkout",
      );
      registerTestHostRpcCapture(harness, {
        hostId: host.id,
        sessionId: session.id,
        gitSourceInspectionResult: {
          checkout: { kind: "unborn", branchName: "main" },
          defaultBranch: null,
          defaultBranchRelation: null,
          isWorktree: false,
          hasUncommittedChanges: false,
          operation: { kind: "none" },
          originDefaultBranch: null,
        },
      });
      const failed = await createTargetThread(harness, {
        projectId: project.id,
        hostId: host.id,
      }).then(
        () => null,
        (error: unknown) => error,
      );
      expect(failed).toBeInstanceOf(ApiError);
      if (!(failed instanceof ApiError)) {
        throw new Error("expected provider selection to be rejected");
      }
      expect(failed.body.code).toBe("environment_provider_rejected");
      expect(failed.message).toContain("no usable git branch");
    });
  });

  it("resolves the model catalog through the selection's hostId for a host-scoped selection", async () => {
    await withTestHarness(async (harness) => {
      installTarget({
        provision: () => ({ action: "wait", reason: "Creating…" }),
      });
      const { host, project } = seedTargetFixture(
        harness,
        "host-target-scoped",
      );
      const created = await createTargetThread(harness, {
        projectId: project.id,
        hostId: host.id,
        model: undefined,
      });
      expect(getThread(harness.db, created.id)?.status).toBe("starting");
    });
  });
});

describe("provider validate at create time", () => {
  it("shares concurrent Git inspections for the same host and path", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-inspection-dedupe",
      });
      const inspect = vi.fn();
      registerTestHostRpcCapture(harness.deps, {
        hostId: host.id,
        sessionId: session.id,
        onInspectGitSource: inspect,
      });
      const args = { hostId: host.id, path: WORKSPACE_PATH };
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          resolveGitCheckoutAvailability(harness.deps, args),
        ),
      );
      expect(results).toHaveLength(6);
      expect(inspect).toHaveBeenCalledOnce();
      await resolveGitCheckoutAvailability(harness.deps, args);
      expect(inspect).toHaveBeenCalledTimes(2);
    });
  });

  it("rejects a missing implicit default before creating a thread", async () => {
    await withTestHarness(async (harness) => {
      installTargets([]);
      const { host, project } = seedTargetFixture(
        harness,
        "host-disabled-default",
      );
      seedPrimaryHost(harness.deps, host.id);
      const before = harness.db.$client
        .prepare("select count(*) as count from threads")
        .get();
      await expect(
        createThreadFromRequest(harness.deps, {
          environment: { type: "project-default" },
          input: textInput("test"),
          origin: "cli",
          projectId: project.id,
          providerId: "codex",
          model: "requested-model",
          startedOnBehalfOf: null,
        }),
      ).rejects.toThrow("default environment provider");
      expect(
        harness.db.$client
          .prepare("select count(*) as count from threads")
          .get(),
      ).toEqual(before);
    });
  });

  async function createFailure(
    harness: TestAppHarness,
    args: Parameters<typeof createTargetThread>[1],
  ): Promise<ApiError> {
    const failed = await createTargetThread(harness, args).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failed).toBeInstanceOf(ApiError);
    return failed as ApiError;
  }

  it("checks only the selected provider's availability before creating rows", async () => {
    await withTestHarness(async (harness) => {
      const availability = vi.fn(() => ({
        status: "setup-required" as const,
        message: "Add sandbox credentials",
      }));
      const validate = vi.fn(() => ({ action: "accept" as const }));
      installTarget({
        availability,
        validate,
        provision: () => ({ action: "wait", reason: "…" }),
      });
      const { host, project } = seedTargetFixture(
        harness,
        "host-target-availability-refuse",
      );
      const threadsBefore = harness.db.$client
        .prepare("select count(*) as count from threads")
        .get();
      const environmentsBefore = listEnvironments(harness.db, {}).length;

      const failed = await createFailure(harness, {
        projectId: project.id,
        hostId: host.id,
      });
      expect(failed.status).toBe(409);
      expect(failed.body.code).toBe("environment_provider_rejected");
      expect(failed.message).toBe("Add sandbox credentials");
      expect(availability).toHaveBeenCalledOnce();
      expect(availability).toHaveBeenCalledWith(
        expect.objectContaining({
          project: expect.objectContaining({ id: project.id }),
          host: expect.objectContaining({ id: host.id }),
        }),
      );
      expect(validate).not.toHaveBeenCalled();
      expect(
        harness.db.$client
          .prepare("select count(*) as count from threads")
          .get(),
      ).toEqual(threadsBefore);
      expect(listEnvironments(harness.db, {})).toHaveLength(environmentsBefore);
    });
  });

  it("reports availability hook failures as provider failures", async () => {
    await withTestHarness(async (harness) => {
      installTarget({
        availability: () => {
          throw new Error("credential service failed");
        },
        provision: () => ({ action: "wait", reason: "…" }),
      });
      const { project } = seedTargetFixture(
        harness,
        "host-target-availability-error",
      );
      const failed = await createFailure(harness, { projectId: project.id });
      expect(failed.status).toBe(502);
      expect(failed.body.code).toBe("environment_provider_failed");
      expect(failed.message).toContain(`Plugin "${PLUGIN_ID}"`);
      expect(failed.message).toContain("credential service failed");
    });
  });

  it("refuses the request with the provider's message before any thread or row exists", async () => {
    await withTestHarness(async (harness) => {
      const asks: TestEnvironmentProviderContext[] = [];
      installTarget({
        validate: () => ({
          action: "refuse",
          message: "No room left on this machine",
        }),
        provision: (context) => {
          asks.push(context);
          return { action: "wait", reason: "…" };
        },
      });
      const { host, project } = seedTargetFixture(
        harness,
        "host-target-validate-refuse",
      );
      const before = listEnvironments(harness.db, {}).length;

      const failed = await createFailure(harness, {
        projectId: project.id,
        hostId: host.id,
      });
      expect(failed.status).toBe(409);
      expect(failed.body.code).toBe("environment_provider_rejected");
      expect(failed.message).toBe("No room left on this machine");
      expect(listEnvironments(harness.db, {})).toHaveLength(before);
      expect(asks).toHaveLength(0);
      expect(scheduledEnvironmentProviderAskCount()).toBe(0);
    });
  });

  it("hands validate the parsed inputs and the machine's checkout, then proceeds on accept", async () => {
    await withTestHarness(async (harness) => {
      const seen: PluginEnvironmentProviderValidateContext[] = [];
      installTarget({
        requiresProjectCheckout: true,
        inputs: CONTAINER_INPUTS,
        validate: (context) => {
          seen.push(context);
          return seen.length === 1
            ? { action: "accept" }
            : { action: "refuse", message: "Validation ran after insertion" };
        },
        provision: () => ({ action: "wait", reason: "Creating…" }),
      });
      const { host, project } = seedTargetFixture(
        harness,
        "host-target-validate-accept",
      );
      const created = await createTargetThread(harness, {
        projectId: project.id,
        hostId: host.id,
        inputs: { image: "ubuntu" },
      });
      expect(getThread(harness.db, created.id)?.status).toBe("starting");
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({
        host: { id: host.id },
        project: { id: project.id },
        projectCheckout: { path: WORKSPACE_PATH },
        gitRemote: null,
        inputs: { image: "ubuntu", cpus: 2 },
      });
    });
  });

  it("fails the request with the plugin named when validate answers a shape core cannot read", async () => {
    await withTestHarness(async (harness) => {
      installTarget({
        validate: () =>
          ({ action: "maybe" }) as unknown as PluginEnvironmentValidateDecision,
        provision: () => ({ action: "wait", reason: "…" }),
      });
      const { project } = seedTargetFixture(
        harness,
        "host-target-validate-shape",
      );
      const failed = await createFailure(harness, { projectId: project.id });
      expect(failed.status).toBe(502);
      expect(failed.body.code).toBe("environment_provider_failed");
      expect(failed.message).toContain(`plugin "${PLUGIN_ID}"`);
      expect(failed.message).toContain('{ action: "accept" }');
    });
  });

  it("fails the request, not the server, when validate throws", async () => {
    await withTestHarness(async (harness) => {
      installTarget({
        validate: () => {
          throw new Error("validator exploded");
        },
        provision: () => ({ action: "wait", reason: "…" }),
      });
      const { project } = seedTargetFixture(
        harness,
        "host-target-validate-throw",
      );
      const failed = await createFailure(harness, { projectId: project.id });
      expect(failed.status).toBe(502);
      expect(failed.body.code).toBe("environment_provider_failed");
      expect(failed.message).toContain(`plugin "${PLUGIN_ID}"`);
      expect(failed.message).toContain("validator exploded");
    });
  });
});

describe("provider inputs are parsed at create time", () => {
  async function createFailure(
    harness: TestAppHarness,
    args: Parameters<typeof createTargetThread>[1],
  ): Promise<ApiError> {
    const failed = await createTargetThread(harness, args).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failed).toBeInstanceOf(ApiError);
    return failed as ApiError;
  }

  it("refuses malformed inputs with the provider and the issues named, before any row exists", async () => {
    await withTestHarness(async (harness) => {
      const asks: TestEnvironmentProviderContext[] = [];
      installTarget({
        inputs: CONTAINER_INPUTS,
        provision: (context) => {
          asks.push(context);
          return { action: "wait", reason: "…" };
        },
      });
      const { project } = seedTargetFixture(harness, "host-target-bad-inputs");
      const before = listEnvironments(harness.db, {}).length;

      const failed = await createFailure(harness, {
        projectId: project.id,
        inputs: { image: "", cpus: "many" },
      });
      expect(failed.status).toBe(400);
      expect(failed.body.code).toBe("invalid_request");
      expect(failed.message).toContain(`"${PROVIDER_ID}"`);
      expect(failed.message).toContain("image:");
      expect(failed.message).toContain("cpus:");
      expect(listEnvironments(harness.db, {})).toHaveLength(before);
      expect(asks).toHaveLength(0);
      expect(scheduledEnvironmentProviderAskCount()).toBe(0);
    });
  });

  it("refuses a provider with inputs when the request carries none", async () => {
    await withTestHarness(async (harness) => {
      installTarget({
        inputs: CONTAINER_INPUTS,
        provision: () => ({ action: "wait", reason: "…" }),
      });
      const { project } = seedTargetFixture(harness, "host-target-no-inputs");
      const failed = await createFailure(harness, { projectId: project.id });
      expect(failed.status).toBe(400);
      expect(failed.body.code).toBe("invalid_request");
      expect(failed.message).toContain("needs inputs");
    });
  });

  it("refuses inputs for a provider that declares none", async () => {
    await withTestHarness(async (harness) => {
      installTarget({ provision: () => ({ action: "wait", reason: "…" }) });
      const { project } = seedTargetFixture(
        harness,
        "host-target-unexpected-inputs",
      );
      const failed = await createFailure(harness, {
        projectId: project.id,
        inputs: { image: "img" },
      });
      expect(failed.status).toBe(400);
      expect(failed.body.code).toBe("invalid_request");
      expect(failed.message).toContain("takes no inputs");
    });
  });

  it("fails the request, not the server, when the schema throws", async () => {
    await withTestHarness(async (harness) => {
      installTarget({
        inputs: z.object({ image: z.string() }).transform(() => {
          throw new Error("registry unreachable");
        }),
        provision: () => ({ action: "wait", reason: "…" }),
      });
      const { project } = seedTargetFixture(harness, "host-target-throwing");
      const failed = await createFailure(harness, {
        projectId: project.id,
        inputs: { image: "img" },
      });
      expect(failed.status).toBe(502);
      expect(failed.body.code).toBe("environment_provider_failed");
      expect(failed.message).toContain(PLUGIN_ID);
      expect(failed.message).toContain("registry unreachable");
    });
  });

  it("lists each provider's requires and inputs as JSON Schema", async () => {
    await withTestHarness(async (harness) => {
      installTargets([
        {
          inputs: CONTAINER_INPUTS,
          provision: () => ({ action: "wait", reason: "…" }),
        },
        {
          id: "plain",
          provision: () => ({ action: "wait", reason: "…" }),
        },
      ]);
      const response = await harness.app.request(
        "/api/v1/system/environment-providers",
      );
      expect(response.status).toBe(200);
      const body = (await readJson(response)) as {
        providers: Array<{
          id: string;
          requires: Record<string, boolean>;
          inputs: JsonValue | null;
        }>;
      };
      expect(body.providers).toEqual([
        {
          id: PROVIDER_ID,
          displayName: "Fake container",
          icon: null,
          logoUrl: null,
          pluginId: PLUGIN_ID,
          requires: {
            projectCheckout: false,
            gitCheckout: false,
            gitRemote: false,
            projectless: false,
          },
          inputs: expect.objectContaining({
            type: "object",
            properties: expect.objectContaining({
              image: expect.objectContaining({ type: "string" }),
              cpus: expect.objectContaining({ type: "integer", default: 2 }),
            }),
            required: ["image"],
          }),
          acceptsEmptyInputs: false,
          machineAvailability: {},
          availability: null,
        },
        {
          id: "plain",
          displayName: "Fake container",
          icon: null,
          logoUrl: null,
          pluginId: PLUGIN_ID,
          requires: {
            projectCheckout: false,
            gitCheckout: false,
            gitRemote: false,
            projectless: false,
          },
          inputs: null,
          acceptsEmptyInputs: true,
          machineAvailability: {},
          availability: null,
        },
      ]);
    });
  });
});

describe("environment provider listing", () => {
  async function listProviders(harness: TestAppHarness, query: string) {
    const response = await harness.app.request(
      `/api/v1/system/environment-providers?${query}`,
    );
    return (await readJson(response)) as {
      providers: Array<{
        id: string;
        availability: unknown;
        machineAvailability: Record<string, unknown>;
      }>;
    };
  }

  it("filters project and projectless providers structurally and probes only the matches", async () => {
    await withTestHarness(async (harness) => {
      const availabilityChecks: string[] = [];
      installTargets([
        {
          id: "project-only",
          availability: () => {
            availabilityChecks.push("project-only");
            return { status: "available" };
          },
          provision: () => ({ action: "wait", reason: "…" }),
        },
        {
          id: "projectless-only",
          requiresProjectless: true,
          availability: () => {
            availabilityChecks.push("projectless-only");
            return { status: "available" };
          },
          provision: () => ({ action: "wait", reason: "…" }),
        },
      ]);
      const { project } = seedTargetFixture(
        harness,
        "host-provider-structural-filter",
      );
      ensurePersonalProject(harness.db);

      const projectBody = await listProviders(
        harness,
        `projectId=${project.id}`,
      );
      expect(projectBody.providers.map((provider) => provider.id)).toEqual([
        "project-only",
      ]);
      await vi.waitFor(() =>
        expect(availabilityChecks).toEqual(["project-only"]),
      );

      const projectlessBody = await listProviders(
        harness,
        `projectId=${PERSONAL_PROJECT_ID}`,
      );
      expect(projectlessBody.providers.map((provider) => provider.id)).toEqual([
        "projectless-only",
      ]);
      await vi.waitFor(() =>
        expect(availabilityChecks).toEqual([
          "project-only",
          "projectless-only",
        ]),
      );
    });
  });

  it("lists Project checkout and Worktree first, then providers by display name and id", async () => {
    await withTestHarness(async (harness) => {
      installTargets([
        { id: "zulu", provision: () => ({ action: "wait", reason: "…" }) },
        {
          id: "personal-workspace",
          provision: () => ({ action: "wait", reason: "…" }),
        },
        {
          id: "project-checkout",
          provision: () => ({ action: "wait", reason: "…" }),
        },
        { id: "alpha", provision: () => ({ action: "wait", reason: "…" }) },
        {
          id: "git-worktree",
          provision: () => ({ action: "wait", reason: "…" }),
        },
      ]);

      const response = await harness.app.request(
        "/api/v1/system/environment-providers",
      );
      const body = (await readJson(response)) as {
        providers: Array<{ id: string; machineAvailability: unknown }>;
      };
      expect(body.providers.map((provider) => provider.id)).toEqual([
        "project-checkout",
        "git-worktree",
        "alpha",
        "personal-workspace",
        "zulu",
      ]);
      expect(body.providers[0]?.machineAvailability).toEqual({});
    });
  });

  it("answers null first, then serves the background availability and notifies clients", async () => {
    await withTestHarness(async (harness) => {
      const availability = vi.fn(() => ({
        status: "setup-required" as const,
        message: "Add sandbox credentials",
      }));
      installTarget({
        availability,
        provision: () => ({ action: "wait", reason: "…" }),
      });
      const { host, project } = seedTargetFixture(
        harness,
        "host-provider-availability",
      );
      const notifySystem = vi.spyOn(harness.hub, "notifySystem");

      const first = await listProviders(harness, `projectId=${project.id}`);
      expect(first.providers[0]?.availability).toBeNull();
      expect(first.providers[0]?.machineAvailability).toEqual({
        [host.id]: null,
      });

      await vi.waitFor(() =>
        expect(notifySystem).toHaveBeenCalledWith([
          "environment-availability-changed",
        ]),
      );
      expect(availability).toHaveBeenCalledTimes(1);

      const scoped = await listProviders(
        harness,
        `projectId=${project.id}&hostId=${host.id}`,
      );
      expect(scoped.providers[0]?.availability).toEqual({
        status: "setup-required",
        message: "Add sandbox credentials",
      });
      expect(scoped.providers[0]?.machineAvailability).toEqual({
        [host.id]: {
          status: "setup-required",
          message: "Add sandbox credentials",
        },
      });
      await listProviders(harness, `projectId=${project.id}`);
      expect(availability).toHaveBeenCalledTimes(1);
      expect(
        notifySystem.mock.calls.filter(([changes]) =>
          changes.includes("environment-availability-changed"),
        ),
      ).toHaveLength(1);
    });
  });

  it("checks availability afresh for every thread creation", async () => {
    await withTestHarness(async (harness) => {
      let checks = 0;
      installTarget({
        availability: () => {
          checks += 1;
          return {
            status: "setup-required",
            message: "Add sandbox credentials",
          };
        },
        provision: () => ({ action: "wait", reason: "…" }),
      });
      const { project } = seedTargetFixture(
        harness,
        "host-provider-availability-fresh",
      );
      await createTargetThread(harness, { projectId: project.id }).catch(
        () => undefined,
      );
      await createTargetThread(harness, { projectId: project.id }).catch(
        () => undefined,
      );
      expect(checks).toBe(2);
    });
  });

  it.each(["gitRemote", "host"])(
    "omits providers with unmet %s requirements without checking availability",
    async (requirement) => {
      await withTestHarness(async (harness) => {
        const availability = vi.fn(() => ({
          status: "setup-required" as const,
          message: "Configure credentials",
        }));
        installTarget({
          requiresGitRemote: requirement === "gitRemote",
          availability,
          provision: () => ({ action: "wait", reason: "…" }),
        });
        const { host, project, session } = seedTargetFixture(
          harness,
          "host-filter-requirements",
        );
        registerTestHostRpcCapture(harness, {
          hostId: host.id,
          sessionId: session.id,
          gitSourceInspectionResult: {
            checkout: { kind: "unknown", reason: "not a git repository" },
            defaultBranch: null,
            defaultBranchRelation: null,
            isWorktree: false,
            hasUncommittedChanges: false,
            operation: { kind: "none" },
            originDefaultBranch: null,
          },
        });
        const hostId = requirement === "host" ? "missing-host" : host.id;
        const body = await readJson(
          await harness.app.request(
            `/api/v1/system/environment-providers?projectId=${project.id}&hostId=${hostId}`,
          ),
        );
        expect(body).toEqual({ providers: [] });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(availability).not.toHaveBeenCalled();
      });
    },
  );

  it("inspects Git in the background for a git-checkout provider and reports a missing branch", async () => {
    await withTestHarness(async (harness) => {
      const availability = vi.fn(() => ({
        status: "available" as const,
      }));
      installTarget({
        requiresGitCheckout: true,
        availability,
        provision: () => ({ action: "wait", reason: "…" }),
      });
      const { host, project, session } = seedTargetFixture(
        harness,
        "host-filter-git-checkout",
      );
      const inspect = vi.fn();
      registerTestHostRpcCapture(harness, {
        hostId: host.id,
        sessionId: session.id,
        onInspectGitSource: inspect,
        gitSourceInspectionResult: {
          checkout: { kind: "unknown", reason: "not a git repository" },
          defaultBranch: null,
          defaultBranchRelation: null,
          isWorktree: false,
          hasUncommittedChanges: false,
          operation: { kind: "none" },
          originDefaultBranch: null,
        },
      });
      const first = await listProviders(
        harness,
        `projectId=${project.id}&hostId=${host.id}`,
      );
      expect(first.providers.map((provider) => provider.id)).toEqual([
        PROVIDER_ID,
      ]);
      expect(first.providers[0]?.availability).toBeNull();

      await vi.waitFor(async () => {
        const later = await listProviders(
          harness,
          `projectId=${project.id}&hostId=${host.id}`,
        );
        expect(later.providers[0]?.availability).toEqual({
          status: "unavailable",
          message: "This project checkout has no usable git branch.",
        });
      });
      expect(inspect).toHaveBeenCalledTimes(1);
      expect(availability).not.toHaveBeenCalled();
    });
  });

  it("does not probe a disconnected machine", async () => {
    await withTestHarness(async (harness) => {
      const availability = vi.fn(() => ({ status: "available" as const }));
      installTarget({
        availability,
        provision: () => ({ action: "wait", reason: "…" }),
      });
      const host = seedHost(harness.deps, { id: "host-offline" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: WORKSPACE_PATH,
      });

      const body = await listProviders(
        harness,
        `projectId=${project.id}&hostId=${host.id}`,
      );
      expect(body.providers[0]?.machineAvailability).toEqual({
        [host.id]: null,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(availability).not.toHaveBeenCalled();
    });
  });

  it("probes again after a plugin recheck invalidates the cache", async () => {
    await withTestHarness(async (harness) => {
      const availability = vi.fn(() => ({ status: "available" as const }));
      installTarget({
        availability,
        provision: () => ({ action: "wait", reason: "…" }),
      });
      const { host, project } = seedTargetFixture(harness, "host-recheck");
      const path = `projectId=${project.id}&hostId=${host.id}`;

      await listProviders(harness, path);
      await vi.waitFor(async () => {
        const later = await listProviders(harness, path);
        expect(later.providers[0]?.availability).toEqual({
          status: "available",
        });
      });
      expect(availability).toHaveBeenCalledTimes(1);

      invalidateEnvironmentProviderMachineAvailability();
      const afterInvalidate = await listProviders(harness, path);
      expect(afterInvalidate.providers[0]?.availability).toBeNull();
      await vi.waitFor(() => expect(availability).toHaveBeenCalledTimes(2));
    });
  });

  it("recomputes structural eligibility after a checkout is added", async () => {
    await withTestHarness(async (harness) => {
      let checks = 0;
      installTarget({
        requiresProjectCheckout: true,
        availability: () => {
          checks += 1;
          return { status: "available" };
        },
        provision: () => ({ action: "wait", reason: "…" }),
      });
      const { host: sourceHost } = seedHostSession(harness.deps, {
        id: "host-source",
      });
      const { host: targetHost } = seedHostSession(harness.deps, {
        id: "host-target",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: sourceHost.id,
      });
      const path = `projectId=${project.id}&hostId=${targetHost.id}`;

      const before = await listProviders(harness, path);
      expect(before.providers).toEqual([]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(checks).toBe(0);

      createProjectSource(harness.db, harness.hub, {
        projectId: project.id,
        type: "local_path",
        hostId: targetHost.id,
        path: "/tmp/target-checkout",
      });

      const after = await listProviders(harness, path);
      expect(after.providers[0]?.availability).toBeNull();
      await vi.waitFor(() => expect(checks).toBe(1));
    });
  });

  it("reports a throwing availability hook as unavailable without failing the listing", async () => {
    await withTestHarness(async (harness) => {
      const availability = vi.fn(() => {
        throw new Error("credential service failed");
      });
      installTarget({
        availability,
        provision: () => ({ action: "wait", reason: "…" }),
      });
      const { host, project } = seedTargetFixture(
        harness,
        "host-provider-availability-error",
      );

      const first = await listProviders(harness, `projectId=${project.id}`);
      expect(first.providers[0]?.availability).toBeNull();
      await vi.waitFor(async () => {
        const later = await listProviders(
          harness,
          `projectId=${project.id}&hostId=${host.id}`,
        );
        expect(later.providers[0]?.availability).toEqual({
          status: "unavailable",
          message:
            'Plugin "sandbox" could not determine availability: credential service failed',
        });
      });
      expect(availability).toHaveBeenCalledTimes(1);
    });
  });
});
