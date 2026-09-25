import { setTimeout as delay } from "node:timers/promises";
import {
  environments,
  getEnvironment,
  getPreparingEnvironment,
  getThread,
} from "@bb/db";
import { validatePluginEnvironmentProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import type {
  PluginEnvironmentProviderCreateContext,
  PluginEnvironmentProviderCreateResult,
  PluginEnvironmentProviderRemoveResult,
} from "@get-bb/plugin-sdk/environment-provider";
import { createDeferredPromise } from "@bb/test-helpers";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/errors.js";
import {
  cancelAbandonedEnvironmentPreparations,
  sweepProviderLifecycles,
} from "../../src/services/environments/environment-engine.js";
import { assertEnvironmentPathAvailable } from "../../src/services/environments/path-admission.js";
import {
  setPluginEnvironmentProviderBridge,
  type PluginEnvironmentProviderRecord,
} from "../../src/services/plugins/plugin-environment-provider-registry.js";
import { invokePluginInline } from "../../src/services/plugins/plugin-hook-registry.js";
import { runStartupRecoverySweep } from "../../src/services/system/periodic-sweeps.js";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import { failThreadProvisioning } from "../../src/services/threads/thread-provisioning-environment.js";
import { clearAllThreadProvisionSchedules } from "../../src/services/threads/thread-startup-store.js";
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

  it("recovers claims that failed provisionings already left behind", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-claim-stuck",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: SHARED_PATH,
      });
      installClaimingProvider(async () => ({
        status: "failed",
        message: "unused",
      }));
      const errored = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: null,
        status: "error",
        environmentProviderId: PROVIDER_ID,
        environmentProviderPluginId: PLUGIN_ID,
        isGitRepo: false,
      });
      holdPath(harness, {
        environmentId: errored.id,
        ownerThreadId: seedThread(harness.deps, {
          projectId: project.id,
          status: "error",
        }).id,
      });
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
      harness.db
        .update(environments)
        .set({
          ownerThreadId: seedThread(harness.deps, {
            projectId: project.id,
            status: "error",
          }).id,
        })
        .where(eq(environments.id, shared.id))
        .run();
      expect(
        pathAvailableTo(harness, { hostId: host.id, threadId: sender.id }),
      ).toBe(false);

      await cancelAbandonedEnvironmentPreparations(harness.deps);

      expect(getEnvironment(harness.db, errored.id)).toMatchObject({
        claimPath: null,
        teardownStatus: "removed",
      });
      expect(getEnvironment(harness.db, shared.id)).toMatchObject({
        ownerThreadId: null,
        status: "ready",
        path: SHARED_PATH,
      });
      expect(
        pathAvailableTo(harness, { hostId: host.id, threadId: sender.id }),
      ).toBe(true);
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

      await cancelAbandonedEnvironmentPreparations(harness.deps);

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

  it("finishes startup recovery once the environment provider registers", async () => {
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

      expect(getEnvironment(harness.db, stuck.id)).toMatchObject({
        claimPath: SHARED_PATH,
        teardownStatus: "running",
      });

      const remove = vi.fn(async () => ({ status: "removed" as const }));
      installClaimingProvider(
        async () => ({ status: "failed", message: "unused" }),
        remove,
      );
      await sweepProviderLifecycles(harness.deps);

      expect(remove).toHaveBeenCalledOnce();
      expect(getEnvironment(harness.db, stuck.id)).toMatchObject({
        claimPath: null,
        teardownStatus: "removed",
      });
    });
  });
});
