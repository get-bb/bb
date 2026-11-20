import { environments, getEnvironment, getThread } from "@bb/db";
import { listEvents } from "@bb/db/testing";
import { validatePluginEnvironmentProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CHECKOUT_BUSY_MESSAGE } from "../../src/services/environments/path-admission.js";
import { invokePluginInline } from "../../src/services/plugins/plugin-hook-registry.js";
import {
  setPluginEnvironmentProviderBridge,
  type PluginEnvironmentProviderRecord,
} from "../../src/services/plugins/plugin-environment-provider-registry.js";
import { attemptDispatch } from "../../src/services/threads/dispatch-attempt.js";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import {
  listQueuedCommands,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const PLUGIN = "local-plugin";
const LOCAL = "local-checkout";
const STRAY = "stray-checkout";
const LEGACY = "legacy-checkout";
const SETUPPER = "setup-checkout";
const CHECKOUT = "/tmp/locate-checkout";

const inputsSchema = z
  .object({ branch: z.object({ kind: z.literal("new") }).optional() })
  .strict();

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function installLocalProviders(
  args: {
    switchGate?: Promise<void>;
    failSwitch?: boolean;
  } = {},
) {
  const creates: string[] = [];
  const local: PluginEnvironmentProviderRecord = {
    pluginId: PLUGIN,
    provider: validatePluginEnvironmentProviderDeclaration({
      apiVersion: 2,
      id: LOCAL,
      displayName: "Local",
      description: "Work in the project checkout.",
      icon: "Folder",
      requires: { projectCheckout: true },
      inputs: inputsSchema,
      policy: { retireGraceMs: null },
      locate: ({ inputs }) => ({
        path: CHECKOUT,
        reuse: inputsSchema.parse(inputs).branch === undefined,
      }),
      async create(context) {
        const branch = inputsSchema.parse(context.inputs).branch !== undefined;
        creates.push(branch ? "switch" : "attach");
        if (branch) {
          await args.switchGate;
          if (args.failSwitch === true)
            return { status: "failed", message: "checkout -b failed" };
        }
        return {
          status: "created",
          path: CHECKOUT,
          ownsPath: false,
          ...(branch ? { resource: { branch: await context.branchName() } } : {}),
        };
      },
      async remove() {
        return { status: "removed" };
      },
    }),
  };
  const stray: PluginEnvironmentProviderRecord = {
    pluginId: PLUGIN,
    provider: validatePluginEnvironmentProviderDeclaration({
      apiVersion: 2,
      id: STRAY,
      displayName: "Stray",
      description: "Returns a path it did not declare.",
      icon: "Folder",
      requires: { projectCheckout: true },
      async create() {
        return { status: "created", path: CHECKOUT, ownsPath: false };
      },
      async remove() {
        return { status: "removed" };
      },
    }),
  };
  const legacy: PluginEnvironmentProviderRecord = {
    pluginId: PLUGIN,
    provider: validatePluginEnvironmentProviderDeclaration({
      id: LEGACY,
      displayName: "Legacy",
      description: "A version-1 provider that shares the checkout.",
      icon: "Folder",
      requires: { projectCheckout: true },
      policy: { retireGraceMs: null },
      async create(context) {
        creates.push("legacy");
        while (!(await context.experimental_claimPath(CHECKOUT)))
          await new Promise((resolve) => setTimeout(resolve, 10));
        return { status: "created", path: CHECKOUT, ownsPath: false };
      },
      async remove() {
        return { status: "removed" };
      },
    }),
  };
  const setupper: PluginEnvironmentProviderRecord = {
    pluginId: PLUGIN,
    provider: validatePluginEnvironmentProviderDeclaration({
      apiVersion: 2,
      id: SETUPPER,
      displayName: "Setupper",
      description: "Asks for setup on the located path.",
      icon: "Folder",
      requires: { projectCheckout: true },
      locate: () => ({ path: CHECKOUT, reuse: false }),
      async create(context) {
        await context.setup(CHECKOUT);
        return { status: "created", path: CHECKOUT, ownsPath: true };
      },
      async remove() {
        return { status: "removed" };
      },
    }),
  };
  const records = [local, stray, legacy, setupper];
  setPluginEnvironmentProviderBridge({
    listEnvironmentProviders: () => records,
    getEnvironmentProvider: (id) =>
      records.find((record) => record.provider.id === id),
    invokeProvider: (_pluginId, _label, run) => invokePluginInline(run),
    decisionTimeoutMs: 10_000,
  });
  return { creates };
}

function seed(harness: TestAppHarness) {
  const { host } = seedHostSession(harness.deps, { id: "host_locate" });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: CHECKOUT,
  });
  return { host, project };
}

function sharedRow(
  harness: TestAppHarness,
  args: { hostId: string; projectId: string },
) {
  return seedEnvironment(harness.deps, {
    hostId: args.hostId,
    projectId: args.projectId,
    path: CHECKOUT,
    environmentProviderId: LOCAL,
    environmentProviderPluginId: PLUGIN,
    environmentProviderSelection: {
      machine: { type: "existing", hostId: args.hostId },
      inputs: {},
    },
    branchName: "main",
  });
}

function startThread(
  harness: TestAppHarness,
  args: {
    hostId: string;
    projectId: string;
    provider?: string;
    inputs?: z.input<typeof inputsSchema>;
  },
) {
  return createThreadFromRequest(harness.deps, {
    startedOnBehalfOf: null,
    environment: {
      type: "provider",
      environmentProviderId: args.provider ?? LOCAL,
      machine: { type: "existing", hostId: args.hostId },
      inputs:
        args.provider === undefined || args.provider === LOCAL
          ? (args.inputs ?? {})
          : null,
    },
    input: textInput("work in the shared checkout"),
    origin: "cli",
    projectId: args.projectId,
    providerId: "codex",
    title: "Switch branch",
  });
}

function answerAttaches(harness: TestAppHarness) {
  let running = true;
  const loop = (async () => {
    while (running) {
      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "environment.attach",
        200,
      ).catch(() => null);
      if (queued === null || queued.command.type !== "environment.attach")
        continue;
      await reportQueuedCommandSuccess(harness, queued, {
        path: queued.command.path,
        isGitRepo: true,
        isWorktree: false,
        branchName: "main",
        defaultBranch: "main",
        transcript: [],
      });
    }
  })();
  return async () => {
    running = false;
    await loop;
  };
}

function liveRowsAt(harness: TestAppHarness, path: string) {
  return harness.db
    .select()
    .from(environments)
    .where(and(eq(environments.path, path), ne(environments.status, "destroyed")))
    .all();
}

function errorDetail(harness: TestAppHarness, threadId: string): string {
  return listEvents(harness.db, { threadId })
    .filter((event) => event.type === "system/error")
    .map((event) => JSON.stringify(event.data))
    .join("\n");
}

describe("KT2: locate()", () => {
  it("lets two Local threads share one row", async () => {
    await withTestHarness(async (harness) => {
      const { creates } = installLocalProviders();
      const { host, project } = seed(harness);
      const stop = answerAttaches(harness);
      try {
        const [first, second] = await Promise.all([
          startThread(harness, { hostId: host.id, projectId: project.id }),
          startThread(harness, { hostId: host.id, projectId: project.id }),
        ]);
        await expect
          .poll(() =>
            [first, second].map(
              (thread) => getThread(harness.db, thread.id)?.environmentId ?? null,
            ),
          )
          .toEqual([expect.any(String), expect.any(String)]);
        const ids = [first, second].map(
          (thread) => getThread(harness.db, thread.id)?.environmentId,
        );
        expect(ids[0]).toBe(ids[1]);
        expect(liveRowsAt(harness, CHECKOUT).map((row) => row.id)).toEqual([
          ids[0],
        ]);
        expect(creates).toEqual(["attach"]);
        for (const thread of [first, second])
          await waitForQueuedCommand(
            harness,
            ({ command }) =>
              command.type === "thread.start" && command.threadId === thread.id,
            5_000,
          );
      } finally {
        await stop();
      }
    });
  });

  it("folds a branch switch into the shared row, which stays ready throughout", async () => {
    await withTestHarness(async (harness) => {
      const gate = deferred();
      installLocalProviders({ switchGate: gate.promise });
      const { host, project } = seed(harness);
      const shared = sharedRow(harness, {
        hostId: host.id,
        projectId: project.id,
      });
      const stop = answerAttaches(harness);
      try {
        const statuses = new Set<string>();
        const sample = setInterval(() => {
          const status = getEnvironment(harness.db, shared.id)?.status;
          if (status !== undefined) statuses.add(status);
        }, 5);
        const thread = await startThread(harness, {
          hostId: host.id,
          projectId: project.id,
          inputs: { branch: { kind: "new" } },
        });
        await expect
          .poll(() => harness.db.select().from(environments).all().length)
          .toBe(2);
        gate.resolve();
        await expect
          .poll(() => getThread(harness.db, thread.id)?.environmentId)
          .toBe(shared.id);
        await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "thread.start" && command.threadId === thread.id,
          5_000,
        );
        clearInterval(sample);
        expect([...statuses]).toEqual(["ready"]);
        expect(getEnvironment(harness.db, shared.id)).toMatchObject({
          status: "ready",
          ownerThreadId: null,
          resource: null,
        });
        expect(liveRowsAt(harness, CHECKOUT).map((row) => row.id)).toEqual([
          shared.id,
        ]);
      } finally {
        await stop();
      }
    });
  });

  it("leaves the shared row ready and fails only the new thread when the switch fails", async () => {
    await withTestHarness(async (harness) => {
      installLocalProviders({ failSwitch: true });
      const { host, project } = seed(harness);
      const shared = sharedRow(harness, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = await startThread(harness, {
        hostId: host.id,
        projectId: project.id,
        inputs: { branch: { kind: "new" } },
      });
      await expect
        .poll(() => getThread(harness.db, thread.id)?.status)
        .toBe("error");
      expect(errorDetail(harness, thread.id)).toContain("checkout -b failed");
      expect(getEnvironment(harness.db, shared.id)).toMatchObject({
        status: "ready",
        ownerThreadId: null,
        attempt: shared.attempt,
        resource: null,
      });
    });
  });

  it("refuses a create that returns another environment's path it did not declare", async () => {
    await withTestHarness(async (harness) => {
      installLocalProviders();
      const { host, project } = seed(harness);
      const shared = sharedRow(harness, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = await startThread(harness, {
        hostId: host.id,
        projectId: project.id,
        provider: STRAY,
      });
      await expect
        .poll(() => getThread(harness.db, thread.id)?.status)
        .toBe("error");
      expect(errorDetail(harness, thread.id)).toContain(
        `Workspace ${CHECKOUT} already belongs to environment ${shared.id}`,
      );
      expect(getEnvironment(harness.db, shared.id)).toMatchObject({
        status: "ready",
        ownerThreadId: null,
      });
    });
  });

  it("holds a second branch switch behind the first one's claim, then refuses it while the first thread works there", async () => {
    await withTestHarness(async (harness) => {
      const gate = deferred();
      const { creates } = installLocalProviders({ switchGate: gate.promise });
      const { host, project } = seed(harness);
      const shared = sharedRow(harness, {
        hostId: host.id,
        projectId: project.id,
      });
      const stop = answerAttaches(harness);
      try {
        const first = await startThread(harness, {
          hostId: host.id,
          projectId: project.id,
          inputs: { branch: { kind: "new" } },
        });
        await expect.poll(() => creates).toEqual(["switch"]);
        const second = await startThread(harness, {
          hostId: host.id,
          projectId: project.id,
          inputs: { branch: { kind: "new" } },
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(creates).toEqual(["switch"]);
        expect(getThread(harness.db, second.id)?.status).toBe("starting");
        gate.resolve();
        await expect
          .poll(() => getThread(harness.db, second.id)?.status)
          .toBe("error");
        expect(errorDetail(harness, second.id)).toContain(CHECKOUT_BUSY_MESSAGE);
        expect(creates).toEqual(["switch"]);
        expect(getThread(harness.db, first.id)?.environmentId).toBe(shared.id);
        expect(getEnvironment(harness.db, shared.id)?.status).toBe("ready");
      } finally {
        await stop();
      }
    });
  });

  it("folds a version-1 provider's concurrent creates on one path into one environment, as before", async () => {
    await withTestHarness(async (harness) => {
      const { creates } = installLocalProviders();
      const { host, project } = seed(harness);
      const stop = answerAttaches(harness);
      try {
        const [first, second] = await Promise.all([
          startThread(harness, {
            hostId: host.id,
            projectId: project.id,
            provider: LEGACY,
          }),
          startThread(harness, {
            hostId: host.id,
            projectId: project.id,
            provider: LEGACY,
          }),
        ]);
        for (const thread of [first, second])
          await waitForQueuedCommand(
            harness,
            ({ command }) =>
              command.type === "thread.start" && command.threadId === thread.id,
            5_000,
          );
        expect(getThread(harness.db, first.id)?.environmentId).toBe(
          getThread(harness.db, second.id)?.environmentId,
        );
        expect(liveRowsAt(harness, CHECKOUT)).toHaveLength(1);
        expect(creates).toEqual(["legacy", "legacy"]);
        expect(errorDetail(harness, second.id)).toBe("");
      } finally {
        await stop();
      }
    });
  });

  it("refuses setup on a located environment's path before binding anything", async () => {
    await withTestHarness(async (harness) => {
      installLocalProviders();
      const { host, project } = seed(harness);
      const shared = sharedRow(harness, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = await startThread(harness, {
        hostId: host.id,
        projectId: project.id,
        provider: SETUPPER,
      });
      await expect
        .poll(() => getThread(harness.db, thread.id)?.status)
        .toBe("error");
      expect(errorDetail(harness, thread.id)).toContain(
        `belongs to environment ${shared.id}`,
      );
      expect(getEnvironment(harness.db, shared.id)).toMatchObject({
        status: "ready",
        ownerThreadId: null,
        attempt: shared.attempt,
        providerOwnsPath: false,
        claimPath: null,
      });
      expect(getThread(harness.db, thread.id)?.environmentId).not.toBe(
        shared.id,
      );
    });
  });

  it("still refuses a branch switch while another thread uses the checkout", async () => {
    await withTestHarness(async (harness) => {
      installLocalProviders();
      const { host, project } = seed(harness);
      const shared = sharedRow(harness, {
        hostId: host.id,
        projectId: project.id,
      });
      seedThread(harness.deps, {
        projectId: project.id,
        environmentId: shared.id,
        status: "idle",
      });
      const thread = await startThread(harness, {
        hostId: host.id,
        projectId: project.id,
        inputs: { branch: { kind: "new" } },
      });
      await expect
        .poll(() => getThread(harness.db, thread.id)?.status)
        .toBe("error");
      expect(errorDetail(harness, thread.id)).toContain(CHECKOUT_BUSY_MESSAGE);
      expect(getEnvironment(harness.db, shared.id)?.status).toBe("ready");
      expect(listQueuedCommands(harness, "thread.start")).toEqual([]);
    });
  });
  it("refuses a retried branch switch while another thread uses the checkout", async () => {
    await withTestHarness(async (harness) => {
      const options = { failSwitch: true };
      const { creates } = installLocalProviders(options);
      const { host, project } = seed(harness);
      const shared = sharedRow(harness, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = await startThread(harness, {
        hostId: host.id,
        projectId: project.id,
        inputs: { branch: { kind: "new" } },
      });
      await expect
        .poll(() => getThread(harness.db, thread.id)?.status)
        .toBe("error");
      seedThread(harness.deps, {
        projectId: project.id,
        environmentId: shared.id,
        status: "active",
      });
      options.failSwitch = false;
      const failed = getThread(harness.db, thread.id);
      if (failed === null) throw new Error("Missing thread");
      await attemptDispatch(harness.deps, {
        systemNotice: null,
        thread: failed,
        payload: { input: textInput("Retry the switch"), mode: "start" },
        source: { kind: "inline" },
        queuePayload: { kind: "inline" },
        pluginSubmission: null,
        origin: null,
        originPluginId: null,
        startedOnBehalfOf: null,
        trigger: "user",
      });
      await expect
        .poll(() => errorDetail(harness, thread.id))
        .toContain(CHECKOUT_BUSY_MESSAGE);
      expect(creates).toEqual(["switch"]);
      expect(getThread(harness.db, thread.id)?.environmentId).not.toBe(
        shared.id,
      );
      expect(getEnvironment(harness.db, shared.id)?.status).toBe("ready");
    });
  });
});
