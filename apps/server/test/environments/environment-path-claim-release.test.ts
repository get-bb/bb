import { setTimeout as delay } from "node:timers/promises";
import {
  environments,
  getEnvironment,
  getPreparingEnvironment,
  getThread,
  listEnvironments,
  listEvents,
} from "@bb/db";
import { validatePluginEnvironmentProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import type {
  PluginEnvironmentProviderCreateContext,
  PluginEnvironmentProviderCreateResult,
  PluginEnvironmentProviderRemoveResult,
} from "@get-bb/plugin-sdk/environment-provider";
import { createDeferredPromise } from "@bb/test-helpers";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { z } from "zod";
import { ApiError } from "../../src/errors.js";
import { sweepProviderLifecycles } from "../../src/services/environments/environment-engine.js";
import { DEFAULT_ENVIRONMENT_PROVIDER_ID } from "../../src/services/environments/environment-provider-ids.js";
import {
  assertEnvironmentPathAvailable,
  CHECKOUT_BUSY_MESSAGE,
  PATH_CLAIM_SETTLE_TIMEOUT_MS,
} from "../../src/services/environments/path-admission.js";
import {
  setPluginEnvironmentProviderBridge,
  type PluginEnvironmentProviderRecord,
} from "../../src/services/plugins/plugin-environment-provider-registry.js";
import { invokePluginInline } from "../../src/services/plugins/plugin-hook-registry.js";
import { runStartupRecoverySweep } from "../../src/services/system/periodic-sweeps.js";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import { failThreadProvisioning } from "../../src/services/threads/thread-provisioning-environment.js";
import { clearAllThreadProvisionSchedules } from "../../src/services/threads/thread-startup-store.js";
import {
  listQueuedCommands,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { checkoutProviderInputsSchema } from "../helpers/environment-provider.js";
import { advanceUntilSettled } from "../helpers/fake-timers.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const PLUGIN_ID = "claim-release";
const PROVIDER_ID = "shared-checkout";
const SHARED_PATH = "/tmp/environment-path-claim-release";

function installClaimingProvider(
  create: (
    context: PluginEnvironmentProviderCreateContext,
  ) => Promise<PluginEnvironmentProviderCreateResult>,
  remove: () => Promise<PluginEnvironmentProviderRemoveResult> = async () => ({
    status: "removed",
  }),
): void {
  const records: PluginEnvironmentProviderRecord[] = [
    {
      pluginId: PLUGIN_ID,
      provider: validatePluginEnvironmentProviderDeclaration({
        id: PROVIDER_ID,
        displayName: "Shared checkout",
        description: "Claims a shared workspace path.",
        icon: "Folder",
        requires: {
          projectCheckout: false,
          gitCheckout: false,
          gitRemote: false,
          projectless: false,
        },
        create,
        remove,
      }),
    },
  ];
  setPluginEnvironmentProviderBridge({
    listEnvironmentCompositions: () => [],
    listEnvironmentProviders: () => records,
    getEnvironmentProvider: (id) =>
      records.find((record) => record.provider.id === id),
    invokeProvider: (_pluginId, _label, run) => invokePluginInline(run),
    decisionTimeoutMs: 10_000,
  });
}

function startThread(
  harness: TestAppHarness,
  args: { projectId: string; hostId: string; prompt: string },
) {
  return createThreadFromRequest(harness.deps, {
    environment: {
      type: "provider",
      environmentProviderId: PROVIDER_ID,
      machine: { type: "existing", hostId: args.hostId },
      inputs: null,
    },
    input: textInput(args.prompt),
    origin: "app",
    projectId: args.projectId,
    providerId: "codex",
    model: "requested-model",
    startedOnBehalfOf: null,
  });
}

afterEach(() => {
  clearAllThreadProvisionSchedules();
  setPluginEnvironmentProviderBridge(undefined);
});

function holdPath(
  harness: TestAppHarness,
  args: { environmentId: string; ownerThreadId: string },
): void {
  harness.db
    .update(environments)
    .set({ ownerThreadId: args.ownerThreadId, claimPath: SHARED_PATH })
    .where(eq(environments.id, args.environmentId))
    .run();
}

function pathAvailableTo(
  harness: TestAppHarness,
  args: { hostId: string; threadId: string },
): boolean {
  try {
    assertEnvironmentPathAvailable(harness.deps, {
      hostId: args.hostId,
      path: SHARED_PATH,
      threadId: args.threadId,
    });
    return true;
  } catch (error) {
    if (error instanceof ApiError) return false;
    throw error;
  }
}

describe("environment path claim release", () => {
  it("hands the claimed path to a racing thread once the first claimer fails", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host-claim-race" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: SHARED_PATH,
      });

      const gate = createDeferredPromise<void>();
      const claimed = createDeferredPromise<string>();
      let firstClaimer: string | null = null;
      let blockedAttempts = 0;

      installClaimingProvider(async (context) => {
        let held = await context.experimental_claimPath(SHARED_PATH);
        for (let attempt = 0; !held && attempt < 600; attempt += 1) {
          blockedAttempts += 1;
          await delay(10);
          held = await context.experimental_claimPath(SHARED_PATH);
        }
        if (!held)
          return { status: "failed", message: "workspace stayed claimed" };
        if (firstClaimer === null) {
          firstClaimer = context.thread.id;
          claimed.resolve(context.thread.id);
          await gate.promise;
          return { status: "failed", message: "attach failed" };
        }
        return { status: "created", path: SHARED_PATH, ownsPath: false };
      });

      const first = await startThread(harness, {
        projectId: project.id,
        hostId: host.id,
        prompt: "claim the workspace",
      });
      await claimed.promise;
      const failing = getPreparingEnvironment(harness.db, first.id);
      expect(failing).toMatchObject({ claimPath: SHARED_PATH });

      const second = await startThread(harness, {
        projectId: project.id,
        hostId: host.id,
        prompt: "wait for the workspace",
      });
      await vi.waitFor(() => {
        expect(blockedAttempts).toBeGreaterThan(0);
      });
      const waiting = getPreparingEnvironment(harness.db, second.id);
      expect(waiting).not.toBeNull();

      gate.resolve();

      await vi.waitFor(
        () => {
          expect(getThread(harness.db, first.id)?.status).toBe("error");
          expect(getEnvironment(harness.db, failing!.id)).toMatchObject({
            claimPath: null,
            teardownStatus: "removed",
          });
          expect(getEnvironment(harness.db, waiting!.id)?.path).toBe(
            SHARED_PATH,
          );
        },
        { timeout: 5000 },
      );
    });
  });

  it("releases a shared checkout when the thread adopting it fails", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-claim-shared",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: SHARED_PATH,
      });
      installClaimingProvider(async () => ({
        status: "failed",
        message: "unused",
      }));
      const shared = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: SHARED_PATH,
        status: "ready",
        environmentProviderId: PROVIDER_ID,
        environmentProviderPluginId: PLUGIN_ID,
      });
      const sender = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: shared.id,
        status: "idle",
      });
      const adopter = seedThread(harness.deps, {
        projectId: project.id,
        status: "starting",
      });
      holdPath(harness, {
        environmentId: shared.id,
        ownerThreadId: adopter.id,
      });
      expect(
        pathAvailableTo(harness, { hostId: host.id, threadId: sender.id }),
      ).toBe(false);

      failThreadProvisioning(harness.deps, {
        thread: adopter,
        environmentId: null,
        detail: "attach failed",
      });

      await vi.waitFor(() => {
        expect(getEnvironment(harness.db, shared.id)).toMatchObject({
          ownerThreadId: null,
          claimPath: null,
          teardownStatus: null,
          status: "ready",
          path: SHARED_PATH,
        });
      });
      expect(
        pathAvailableTo(harness, { hostId: host.id, threadId: sender.id }),
      ).toBe(true);
    });
  });

  it.each(["error", "starting", "stopping"] as const)(
    "checks explicit environment reuse when the preparation owner is %s",
    async (status) => {
      await withTestHarness(async (harness) => {
        const { host } = seedHostSession(harness.deps, {
          id: `host-reuse-${status}`,
        });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
          path: SHARED_PATH,
        });
        const shared = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
          path: SHARED_PATH,
          status: "ready",
          environmentProviderId: PROVIDER_ID,
          environmentProviderPluginId: PLUGIN_ID,
        });
        const owner = seedThread(harness.deps, {
          projectId: project.id,
          status,
        });
        holdPath(harness, {
          environmentId: shared.id,
          ownerThreadId: owner.id,
        });
        installClaimingProvider(async () => ({
          status: "failed",
          message: "unused",
        }));
        const request = createThreadFromRequest(harness.deps, {
          environment: { type: "reuse", environmentId: shared.id },
          input: textInput("reuse the workspace"),
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          model: "requested-model",
          startedOnBehalfOf: null,
        });
        if (status === "error") {
          const thread = await request;
          expect(thread.environmentId).toBe(shared.id);
          expect(getEnvironment(harness.db, shared.id)).toMatchObject({
            ownerThreadId: null,
            claimPath: null,
            status: "ready",
            teardownStatus: null,
          });
        } else {
          await expect(request).rejects.toMatchObject({
            status: 409,
            body: { code: "workspace_busy" },
          });
          expect(getEnvironment(harness.db, shared.id)).toMatchObject({
            ownerThreadId: owner.id,
            claimPath: SHARED_PATH,
            teardownStatus: null,
          });
        }
      });
    },
  );

  it("repairs a stale shared claim when a provider requests the path", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-claim-provider",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: SHARED_PATH,
      });
      const shared = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: SHARED_PATH,
        status: "ready",
        environmentProviderId: PROVIDER_ID,
        environmentProviderPluginId: PLUGIN_ID,
      });
      const owner = seedThread(harness.deps, {
        projectId: project.id,
        status: "error",
      });
      holdPath(harness, { environmentId: shared.id, ownerThreadId: owner.id });
      const claimed = createDeferredPromise<boolean>();
      installClaimingProvider(async (context) => {
        claimed.resolve(await context.experimental_claimPath(SHARED_PATH));
        return { status: "created", path: SHARED_PATH, ownsPath: false };
      });
      const thread = await startThread(harness, {
        projectId: project.id,
        hostId: host.id,
        prompt: "reuse abandoned checkout",
      });
      expect(await claimed.promise).toBe(true);
      await vi.waitFor(() =>
        expect(getThread(harness.db, thread.id)?.environmentId).toBe(shared.id),
      );
    });
  });

  it("keeps a claim held by a thread whose provisioning is still running", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host-claim-live" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: SHARED_PATH,
      });

      const gate = createDeferredPromise<void>();
      const claimed = createDeferredPromise<string>();
      installClaimingProvider(async (context) => {
        const held = await context.experimental_claimPath(SHARED_PATH);
        if (!held) return { status: "failed", message: "claim refused" };
        claimed.resolve(context.thread.id);
        await gate.promise;
        return { status: "created", path: SHARED_PATH, ownsPath: false };
      });

      const thread = await startThread(harness, {
        projectId: project.id,
        hostId: host.id,
        prompt: "hold the workspace",
      });
      await claimed.promise;
      const preparing = getPreparingEnvironment(harness.db, thread.id);

      expect(
        pathAvailableTo(harness, { hostId: host.id, threadId: "other-thread" }),
      ).toBe(false);

      expect(getEnvironment(harness.db, preparing!.id)).toMatchObject({
        claimPath: SHARED_PATH,
        ownerThreadId: thread.id,
        teardownStatus: null,
      });

      gate.resolve();
      await vi.waitFor(() => {
        expect(getEnvironment(harness.db, preparing!.id)?.path).toBe(
          SHARED_PATH,
        );
      });
    });
  });

  it("defers abandoned resource cleanup until admission and retains the claim until removal completes", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-claim-startup",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: SHARED_PATH,
      });
      const stuck = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: null,
        status: "error",
        environmentProviderId: PROVIDER_ID,
        environmentProviderPluginId: PLUGIN_ID,
        isGitRepo: false,
      });
      holdPath(harness, {
        environmentId: stuck.id,
        ownerThreadId: seedThread(harness.deps, {
          projectId: project.id,
          status: "error",
        }).id,
      });

      await runStartupRecoverySweep(harness.deps);
      expect(getEnvironment(harness.db, stuck.id)?.teardownStatus).toBeNull();
      expect(
        pathAvailableTo(harness, { hostId: host.id, threadId: "other-thread" }),
      ).toBe(false);

      expect(getEnvironment(harness.db, stuck.id)).toMatchObject({
        claimPath: SHARED_PATH,
        teardownStatus: "running",
      });

      const gate = createDeferredPromise<void>();
      const remove = vi.fn(async () => {
        await gate.promise;
        return { status: "removed" as const };
      });
      installClaimingProvider(
        async () => ({ status: "failed", message: "unused" }),
        remove,
      );
      const cleanup = sweepProviderLifecycles(harness.deps);
      await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce());
      expect(
        pathAvailableTo(harness, { hostId: host.id, threadId: "other-thread" }),
      ).toBe(false);
      gate.resolve();
      await cleanup;
      expect(
        pathAvailableTo(harness, { hostId: host.id, threadId: "other-thread" }),
      ).toBe(true);

      expect(remove).toHaveBeenCalledOnce();
      expect(getEnvironment(harness.db, stuck.id)).toMatchObject({
        claimPath: null,
        teardownStatus: "removed",
      });
    });
  });
});

const CHECKOUT_PATH = "/tmp/environment-path-settle-checkout";

interface CheckoutCreateHolds {
  beforeClaim?: Promise<void>;
  afterClaim?: Promise<void>;
}

function installCheckoutProvider(
  args: {
    holds?: CheckoutCreateHolds[];
    onClaimed?: (index: number) => void;
  } = {},
): { claimedBy(index: number): Promise<string> } {
  const holds = args.holds ?? [];
  const claims = holds.map(() => createDeferredPromise<string>());
  let createCount = 0;
  const records: PluginEnvironmentProviderRecord[] = [
    {
      pluginId: "environment-project-checkout",
      provider: validatePluginEnvironmentProviderDeclaration({
        id: DEFAULT_ENVIRONMENT_PROVIDER_ID.projectCheckout,
        displayName: "Checkout",
        description: "Work in a project checkout on this machine.",
        icon: "Folder",
        requires: { projectCheckout: true },
        inputs: checkoutProviderInputsSchema,
        experimental_existingPath: (inputs) => {
          const parsed = checkoutProviderInputsSchema.parse(inputs);
          return parsed.branch === undefined ? (parsed.path ?? null) : null;
        },
        create: async (context) => {
          const path =
            checkoutProviderInputsSchema.parse(context.inputs).path ??
            CHECKOUT_PATH;
          const index = createCount;
          createCount += 1;
          await holds[index]?.beforeClaim;
          while (!(await context.experimental_claimPath(path))) {
            context.signal.throwIfAborted();
            await delay(10);
          }
          claims[index]?.resolve(context.thread.id);
          args.onClaimed?.(index);
          await holds[index]?.afterClaim;
          return {
            status: "created",
            path,
            ownsPath: false,
            ...(index === 0 ? {} : { mergeBaseBranch: `base-${index}` }),
          };
        },
        remove: async () => ({ status: "removed" }),
      }),
    },
  ];
  setPluginEnvironmentProviderBridge({
    listEnvironmentCompositions: () => [],
    listEnvironmentProviders: () => records,
    getEnvironmentProvider: (id) =>
      records.find((record) => record.provider.id === id),
    invokeProvider: (_pluginId, _label, run) => invokePluginInline(run),
    decisionTimeoutMs: 10_000,
  });
  return {
    claimedBy: (index) => {
      const claim = claims[index];
      if (claim === undefined) throw new Error(`No held claim ${index}`);
      return claim.promise;
    },
  };
}

function createCheckoutThread(
  harness: TestAppHarness,
  args: { projectId: string; hostId: string; prompt: string },
) {
  return createThreadFromRequest(harness.deps, {
    environment: {
      type: "host",
      hostId: args.hostId,
      workspace: { type: "unmanaged", path: CHECKOUT_PATH },
    },
    input: textInput(args.prompt),
    origin: "app",
    projectId: args.projectId,
    providerId: "codex",
    startedOnBehalfOf: null,
  });
}

async function finishWorkspaceSetup(
  harness: TestAppHarness,
  threadId: string,
): Promise<void> {
  const queued = await waitForQueuedCommand(
    harness,
    ({ command }) =>
      command.type === "environment.attach" &&
      command.initiator?.threadId === threadId,
    5_000,
  );
  if (queued.command.type !== "environment.attach")
    throw new Error("Expected environment.attach command");
  await reportQueuedCommandSuccess(harness, queued, {
    path: queued.command.path,
    isGitRepo: true,
    isWorktree: false,
    branchName: "main",
    defaultBranch: "main",
    transcript: [],
  });
}

async function waitForThreadStarts(
  harness: TestAppHarness,
  threadIds: string[],
): Promise<void> {
  for (const threadId of threadIds)
    await waitForQueuedCommand(
      harness,
      ({ command }) =>
        command.type === "thread.start" && command.threadId === threadId,
      5_000,
    );
}

function workspacePathSteps(harness: TestAppHarness, threadId: string) {
  return listEvents(harness.db, { threadId })
    .filter((event) => event.type === "system/thread-provisioning")
    .flatMap(
      (event) =>
        z
          .object({
            entries: z.array(z.object({ key: z.string().optional() })),
          })
          .parse(JSON.parse(event.data)).entries,
    )
    .filter((entry) => entry.key === "workspace-path").length;
}

function errorEvents(harness: TestAppHarness, threadIds: string[]) {
  return threadIds.flatMap((threadId) =>
    listEvents(harness.db, { threadId })
      .filter((event) => event.type === "system/error")
      .map((event) => event.data),
  );
}

async function holdSecondCreateOnTheClaim(
  harness: TestAppHarness,
  args: {
    projectId: string;
    hostId: string;
    finishFirstSetupBeforeTheClaim: boolean;
  },
) {
  const firstHold = createDeferredPromise<void>();
  const secondStart = createDeferredPromise<void>();
  const secondHold = createDeferredPromise<void>();
  const provider = installCheckoutProvider({
    holds: [
      { afterClaim: firstHold.promise },
      {
        ...(args.finishFirstSetupBeforeTheClaim
          ? { beforeClaim: secondStart.promise }
          : {}),
        afterClaim: secondHold.promise,
      },
    ],
  });
  const target = { projectId: args.projectId, hostId: args.hostId };
  const first = await createCheckoutThread(harness, {
    ...target,
    prompt: "first checkout",
  });
  expect(await provider.claimedBy(0)).toBe(first.id);
  const second = await createCheckoutThread(harness, {
    ...target,
    prompt: "second checkout",
  });
  firstHold.resolve();
  if (args.finishFirstSetupBeforeTheClaim) {
    await finishWorkspaceSetup(harness, first.id);
    await waitForThreadStarts(harness, [first.id]);
    secondStart.resolve();
  }
  expect(await provider.claimedBy(1)).toBe(second.id);
  const shared = getThread(harness.db, first.id)!.environmentId!;
  expect(getEnvironment(harness.db, shared)).toMatchObject({
    path: CHECKOUT_PATH,
    claimPath: null,
    ownerThreadId: null,
  });
  expect(getPreparingEnvironment(harness.db, second.id)).toMatchObject({
    claimPath: CHECKOUT_PATH,
    path: null,
  });
  return { first, second, shared, releaseSecond: () => secondHold.resolve() };
}

describe("creates racing on a new checkout path", () => {
  it("makes a create wait for another still preparing the same path, then joins its environment", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-checkout-settle-create",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: CHECKOUT_PATH,
      });
      const { first, second, shared, releaseSecond } =
        await holdSecondCreateOnTheClaim(harness, {
          projectId: project.id,
          hostId: host.id,
          finishFirstSetupBeforeTheClaim: true,
        });

      const third = createCheckoutThread(harness, {
        projectId: project.id,
        hostId: host.id,
        prompt: "third checkout",
      });
      const outcome = third.then(
        () => "created",
        () => "failed",
      );
      await delay(50);
      expect(await Promise.race([outcome, Promise.resolve("pending")])).toBe(
        "pending",
      );

      releaseSecond();
      const created = await third;
      expect(created.environmentId).toBe(shared);
      const threadIds = [first.id, second.id, created.id];
      await waitForThreadStarts(harness, threadIds);
      for (const threadId of threadIds)
        expect(getThread(harness.db, threadId)?.environmentId).toBe(shared);
      expect(errorEvents(harness, threadIds)).toEqual([]);
      expect(
        listEnvironments(harness.db, { projectId: project.id }).filter(
          (row) => row.status !== "destroyed",
        ),
      ).toHaveLength(1);
    });
  });

  it("makes a thread finishing setup wait for another create still preparing its path", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-checkout-settle-setup",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: CHECKOUT_PATH,
      });
      const { first, second, shared, releaseSecond } =
        await holdSecondCreateOnTheClaim(harness, {
          projectId: project.id,
          hostId: host.id,
          finishFirstSetupBeforeTheClaim: false,
        });

      await finishWorkspaceSetup(harness, first.id);
      await delay(50);
      expect(getThread(harness.db, first.id)?.status).toBe("starting");

      releaseSecond();
      const threadIds = [first.id, second.id];
      await waitForThreadStarts(harness, threadIds);
      expect(getThread(harness.db, second.id)?.environmentId).toBe(shared);
      expect(errorEvents(harness, threadIds)).toEqual([]);
    });
  });

  it.each([
    ["after the adopting create attaches", false],
    ["while the adopting create is binding the environment", true],
  ])(
    "lets a create join a workspace setup that is still running when it finishes %s",
    async (_label, finishWhileBinding) => {
      await withTestHarness(async (harness) => {
        const { host } = seedHostSession(harness.deps, {
          id: `host-checkout-join-setup-${String(finishWhileBinding)}`,
        });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
          path: CHECKOUT_PATH,
        });
        const firstHold = createDeferredPromise<void>();
        const secondStart = createDeferredPromise<void>();
        let finishOnNextNotification: (() => void) | null = null;
        const finished = createDeferredPromise<void>();
        let finishFirstSetup: () => Promise<Response> = () => {
          throw new Error("The first setup was not queued");
        };
        const provider = installCheckoutProvider({
          holds: [
            { afterClaim: firstHold.promise },
            { beforeClaim: secondStart.promise },
          ],
          onClaimed: (index) => {
            if (index === 1 && finishWhileBinding)
              finishOnNextNotification = () => {
                void finishFirstSetup().then(() => finished.resolve());
              };
          },
        });
        const target = { projectId: project.id, hostId: host.id };
        const first = await createCheckoutThread(harness, {
          ...target,
          prompt: "first checkout",
        });
        expect(await provider.claimedBy(0)).toBe(first.id);
        const second = await createCheckoutThread(harness, {
          ...target,
          prompt: "second checkout",
        });
        const notifyEnvironment = harness.hub.notifyEnvironment.bind(
          harness.hub,
        );
        const notified = vi
          .spyOn(harness.hub, "notifyEnvironment")
          .mockImplementation((environmentId, changes) => {
            notifyEnvironment(environmentId, changes);
            const finish = finishOnNextNotification;
            finishOnNextNotification = null;
            finish?.();
          });
        onTestFinished(() => notified.mockRestore());
        firstHold.resolve();
        const firstSetup = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "environment.attach" &&
            command.initiator?.threadId === first.id,
          5_000,
        );
        if (firstSetup.command.type !== "environment.attach")
          throw new Error("Expected environment.attach command");
        const shared = firstSetup.command.environmentId;
        finishFirstSetup = () =>
          reportQueuedCommandSuccess(harness, firstSetup, {
            path: CHECKOUT_PATH,
            isGitRepo: true,
            isWorktree: false,
            branchName: "main",
            defaultBranch: "main",
            transcript: [],
          });
        secondStart.resolve();
        expect(await provider.claimedBy(1)).toBe(second.id);
        await vi.waitFor(
          () =>
            expect(getThread(harness.db, second.id)?.environmentId).toBe(
              shared,
            ),
          { timeout: 5_000 },
        );
        if (finishWhileBinding) await finished.promise;
        else await finishFirstSetup();

        const threadIds = [first.id, second.id];
        await waitForThreadStarts(harness, threadIds);
        expect(
          listQueuedCommands(harness, "environment.attach"),
          "setup ran again",
        ).toEqual([]);
        expect(getEnvironment(harness.db, shared)).toMatchObject({
          status: "ready",
          ownerThreadId: null,
          claimPath: null,
        });
        expect(
          threadIds.map((threadId) => workspacePathSteps(harness, threadId)),
        ).toEqual([0, 1]);
        expect(errorEvents(harness, threadIds)).toEqual([]);
      });
    },
  );

  it("gives up waiting with the busy error once the settle bound passes", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-checkout-settle-timeout",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: CHECKOUT_PATH,
      });
      const shared = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: CHECKOUT_PATH,
        status: "ready",
        environmentProviderId: DEFAULT_ENVIRONMENT_PROVIDER_ID.projectCheckout,
        environmentProviderPluginId: "environment-project-checkout",
      });
      const starting = seedThread(harness.deps, {
        projectId: project.id,
        status: "starting",
      });
      harness.db
        .update(environments)
        .set({ ownerThreadId: starting.id, claimPath: CHECKOUT_PATH })
        .where(eq(environments.id, shared.id))
        .run();
      installCheckoutProvider();
      const subscribe = vi.spyOn(harness.hub, "onChangedMessage");
      onTestFinished(() => subscribe.mockRestore());

      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      try {
        const outcome = createCheckoutThread(harness, {
          projectId: project.id,
          hostId: host.id,
          prompt: "wait for the checkout",
        }).then(
          () => null,
          (error: unknown) => error,
        );
        await vi.waitFor(() => expect(subscribe).toHaveBeenCalled());
        await vi.advanceTimersByTimeAsync(PATH_CLAIM_SETTLE_TIMEOUT_MS - 1_000);
        expect(await Promise.race([outcome, Promise.resolve("pending")])).toBe(
          "pending",
        );
        expect(await advanceUntilSettled(outcome, 1_000)).toMatchObject({
          status: 409,
          body: { code: "workspace_busy", message: CHECKOUT_BUSY_MESSAGE },
        });
      } finally {
        vi.useRealTimers();
      }
      expect(getEnvironment(harness.db, shared.id)).toMatchObject({
        ownerThreadId: starting.id,
        claimPath: CHECKOUT_PATH,
      });
    });
  });
});
