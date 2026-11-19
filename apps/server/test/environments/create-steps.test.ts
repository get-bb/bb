import {
  environmentHookOperations,
  environments,
  getEnvironment,
  getThread,
  insertHeldEnvironment,
  threads,
} from "@bb/db";
import type {
  PluginEnvironmentProviderCreateContext,
  PluginEnvironmentProviderCreateResult,
  PluginEnvironmentProviderInputsSchema,
  PluginEnvironmentProviderRemoveContext,
} from "@get-bb/plugin-sdk/environment-provider";
import type { PluginEnvironmentProviderRequirements } from "@get-bb/plugin-sdk";
import { validatePluginEnvironmentProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import { listEvents } from "@bb/db/testing";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { advanceEnvironmentProvisioning } from "../../src/services/environments/environment-engine.js";
import { resolveHeldEnvironmentOperationContext } from "../../src/services/environments/environment-creation.js";
import { getEnvironmentProvider } from "../../src/services/plugins/plugin-environment-provider-registry.js";
import { startThreadTitleGeneration } from "../../src/services/threads/thread-metadata-inference.js";
import { requestThreadStopForCurrentState } from "../../src/services/threads/thread-lifecycle.js";
import { invokePluginInline } from "../../src/services/plugins/plugin-hook-registry.js";
import { setPluginEnvironmentProviderBridge } from "../../src/services/plugins/plugin-environment-provider-registry.js";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import { registerFakeAiService } from "../helpers/ai-services.js";
import {
  listQueuedCommands,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
  type QueuedCommand,
} from "../helpers/commands.js";
import { holdEnvironmentHooks } from "../helpers/held-environment-hooks.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const PLUGIN = "steps-plugin";
const PROVIDER = "steps-worktree";
const CHECKOUT = "/tmp/steps-project";

type StepsContext = PluginEnvironmentProviderCreateContext<
  PluginEnvironmentProviderRequirements,
  PluginEnvironmentProviderInputsSchema,
  2
>;

function installStepsProvider(
  create: (context: StepsContext) => Promise<PluginEnvironmentProviderCreateResult>,
  options: {
    locate?: NonNullable<
      ReturnType<typeof validatePluginEnvironmentProviderDeclaration>["locate"]
    >;
  } = {},
) {
  const log: string[] = [];
  const removals: PluginEnvironmentProviderRemoveContext[] = [];
  const record = {
    pluginId: PLUGIN,
    provider: validatePluginEnvironmentProviderDeclaration({
      apiVersion: 2,
      id: PROVIDER,
      displayName: "Steps worktree",
      description: "Prepare a workspace.",
      icon: "Folder",
      requires: { projectCheckout: true },
      ...(options.locate === undefined ? {} : { locate: options.locate }),
      async create(context) {
        log.push("create:start");
        const result = await create(context);
        log.push(`create:${result.status}`);
        return result;
      },
      async remove(context) {
        removals.push(context);
        return { status: "removed" };
      },
    }),
  };
  setPluginEnvironmentProviderBridge({
    listEnvironmentProviders: () => [record],
    getEnvironmentProvider: (id) => (id === PROVIDER ? record : undefined),
    invokeProvider: (_pluginId, _label, run) => invokePluginInline(run),
    decisionTimeoutMs: 10_000,
  });
  return { log, removals };
}

function pendingTitle(harness: TestAppHarness) {
  let resolveTitle: (title: string) => void = () => {
    throw new Error("Title generation was not started");
  };
  let started = false;
  registerFakeAiService(harness.deps.aiServices, {
    id: "codex",
    pluginId: "provider-codex",
    builtin: true,
    complete: () =>
      new Promise<string>((resolve) => {
        started = true;
        resolveTitle = resolve;
      }),
  });
  return {
    started: () => started,
    resolve: (title: string) => resolveTitle(title),
  };
}

function seed(harness: TestAppHarness) {
  const { host, session } = seedHostSession(harness.deps, {
    id: "host_steps",
  });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: CHECKOUT,
  });
  const hooks = holdEnvironmentHooks(harness, {
    hostId: host.id,
    sessionId: session.id,
  });
  return { host, project, hooks };
}

function startThread(
  harness: TestAppHarness,
  args: { hostId: string; projectId: string },
) {
  return createThreadFromRequest(harness.deps, {
    startedOnBehalfOf: null,
    environment: {
      type: "provider",
      environmentProviderId: PROVIDER,
      machine: { type: "existing", hostId: args.hostId },
      inputs: null,
    },
    input: textInput("Please make the create steps primitives work"),
    origin: "cli",
    projectId: args.projectId,
    providerId: "codex",
  });
}

function attachCommand(harness: TestAppHarness, environmentId: string) {
  return waitForQueuedCommand(
    harness,
    ({ command }) =>
      command.type === "environment.attach" &&
      command.environmentId === environmentId,
    5_000,
  );
}

function attachOf(queued: QueuedCommand) {
  if (queued.command.type !== "environment.attach")
    throw new Error("Expected an attach command");
  return queued.command;
}

async function reportAttach(
  harness: TestAppHarness,
  queued: QueuedCommand,
  branchName: string | null,
) {
  await reportQueuedCommandSuccess(harness, queued, {
    path: attachOf(queued).path,
    isGitRepo: true,
    isWorktree: true,
    branchName,
    defaultBranch: "main",
    transcript: [],
  });
}

function setupRows(harness: TestAppHarness) {
  return harness.db
    .select()
    .from(environmentHookOperations)
    .where(eq(environmentHookOperations.kind, "setup"))
    .all();
}

function pendingAttaches(harness: TestAppHarness) {
  return listQueuedCommands(harness, "environment.attach");
}

function threadStarts(harness: TestAppHarness, threadId: string) {
  return listQueuedCommands(harness, "thread.start").filter(
    (command) => command.type === "thread.start" && command.threadId === threadId,
  );
}

async function preparingEnvironmentId(
  harness: TestAppHarness,
  threadId: string,
): Promise<string> {
  await expect
    .poll(
      () =>
        harness.db
          .select()
          .from(environments)
          .where(eq(environments.ownerThreadId, threadId))
          .get()?.id,
    )
    .toBeDefined();
  return harness.db
    .select()
    .from(environments)
    .where(eq(environments.ownerThreadId, threadId))
    .get()!.id;
}

describe("KT1: setup is a durable request inside create", () => {
  it("runs setup on the attach operation while create waits for the title, and starts the thread only after create returns", async () => {
    await withTestHarness(async (harness) => {
      const title = pendingTitle(harness);
      const { log } = installStepsProvider(async (context) => {
        const path = `/tmp/steps/${context.pathKey}`;
        await context.setup(path);
        log.push("setup:requested");
        const branch = await context.branchName();
        log.push(`named:${branch}`);
        return {
          status: "created",
          path,
          ownsPath: true,
          mergeBaseBranch: "origin/main",
          resource: { branch },
        };
      });
      const { host, project, hooks } = seed(harness);
      const thread = await startThread(harness, {
        hostId: host.id,
        projectId: project.id,
      });
      const environmentId = await preparingEnvironmentId(harness, thread.id);
      const path = `/tmp/steps/${thread.id}`;

      await expect.poll(() => hooks.runs.length).toBe(1);
      expect(hooks.runs[0]).toMatchObject({
        kind: "setup",
        operationId: `environment:${environmentId}:${thread.id}:setup`,
        path,
        resumeOnly: false,
      });
      expect(title.started()).toBe(true);
      expect(getThread(harness.db, thread.id)).toMatchObject({
        title: null,
        environmentId,
      });
      expect(getEnvironment(harness.db, environmentId)).toMatchObject({
        status: "provisioning",
        createPending: true,
        path,
      });

      hooks.finish();
      await expect
        .poll(() => setupRows(harness)[0]?.finishedAt)
        .toEqual(expect.any(Number));
      expect(getEnvironment(harness.db, environmentId)).toMatchObject({
        status: "provisioning",
        createPending: true,
      });
      expect(pendingAttaches(harness)).toEqual([]);
      expect(threadStarts(harness, thread.id)).toEqual([]);

      title.resolve("Create steps primitives");
      const branch = `bb/create-steps-primitives-${thread.id}`;
      const inspect = await attachCommand(harness, environmentId);
      expect(attachOf(inspect).initiator).toMatchObject({ threadId: thread.id });
      expect(hooks.runs).toHaveLength(1);
      expect(log).toEqual([
        "create:start",
        "setup:requested",
        `named:${branch}`,
        "create:created",
      ]);
      expect(threadStarts(harness, thread.id)).toEqual([]);
      await reportAttach(harness, inspect, branch);

      await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
        5_000,
      );
      expect(getEnvironment(harness.db, environmentId)).toMatchObject({
        status: "ready",
        createPending: false,
        branchName: branch,
        resource: { branch },
        providerOwnsPath: true,
      });
      expect(setupRows(harness)).toEqual([
        expect.objectContaining({
          id: `environment:${environmentId}:${thread.id}:setup`,
          finishedAt: expect.any(Number),
          error: null,
        }),
      ]);
    });
  });

  it("fails the thread with the setup message through the attach operation", async () => {
    await withTestHarness(async (harness) => {
      const title = pendingTitle(harness);
      installStepsProvider(async (context) => {
        const path = `/tmp/steps/${context.pathKey}`;
        await context.setup(path);
        return {
          status: "created",
          path,
          ownsPath: true,
          resource: { branch: await context.branchName() },
        };
      });
      const { host, project, hooks } = seed(harness);
      const thread = await startThread(harness, {
        hostId: host.id,
        projectId: project.id,
      });
      const environmentId = await preparingEnvironmentId(harness, thread.id);
      await expect.poll(() => hooks.runs.length).toBe(1);
      hooks.fail("setup script exited 3");
      await expect
        .poll(() => getThread(harness.db, thread.id)?.status)
        .toBe("error");
      expect(
        listEvents(harness.db, { threadId: thread.id })
          .filter((event) => event.type === "system/error")
          .map((event) => JSON.stringify(event.data)),
      ).toEqual([expect.stringContaining("setup script exited 3")]);
      title.resolve("Too late");
      await expect
        .poll(() => getEnvironment(harness.db, environmentId)?.createPending)
        .toBe(false);
      expect(getEnvironment(harness.db, environmentId)).toMatchObject({
        status: "error",
        resource: { branch: `bb/too-late-${thread.id}` },
      });
      expect(threadStarts(harness, thread.id)).toEqual([]);
    });
  });
});

describe("KT1: a held environment that requests setup", () => {
  it("drops its path claim once create returns, so a thread can take it over", async () => {
    await withTestHarness(async (harness) => {
      installStepsProvider(async (context) => {
        const path = `/tmp/steps/${context.pathKey}`;
        await context.setup(path);
        return {
          status: "created",
          path,
          ownsPath: true,
          resource: { branch: await context.branchName() },
        };
      });
      const { project, hooks } = seed(harness);
      const response = await harness.app.request("/api/v1/environments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          provider: { id: PROVIDER },
          heldBy: "user",
        }),
      });
      expect(response.status).toBe(201);
      const { id } = (await response.json()) as { id: string };
      await expect.poll(() => hooks.runs.length).toBe(1);
      await expect
        .poll(() => getEnvironment(harness.db, id)?.createPending)
        .toBe(false);
      hooks.finish();
      await reportAttach(harness, await attachCommand(harness, id), `bb/${id}`);
      await expect
        .poll(() => getEnvironment(harness.db, id)?.status)
        .toBe("ready");
      expect(pendingAttaches(harness)).toEqual([]);
      expect(getEnvironment(harness.db, id)).toMatchObject({
        claimPath: null,
        createPending: false,
        heldBy: "user",
      });
    });
  });
});

describe("KT1: restart after setup finished, before create returned", () => {
  function heldProvisioning(
    harness: TestAppHarness,
    args: { hostId: string; projectId: string; finishedAt: number | null },
  ) {
    const row = insertHeldEnvironment(harness.db, {
      projectId: args.projectId,
      hostId: args.hostId,
      name: null,
      heldBy: "user",
      environmentProviderId: PROVIDER,
      environmentProviderPluginId: PLUGIN,
      environmentProviderSelection: {
        machine: { type: "existing", hostId: args.hostId },
        inputs: null,
      },
      environmentProviderInstanceKey: (id) => id,
      attempt: 1,
      status: "provisioning",
      createPending: true,
      statusMessage: "Preparing",
      providerOwnsPath: true,
    });
    const path = `/tmp/steps/${row.id}`;
    harness.db
      .update(environments)
      .set({ path })
      .where(eq(environments.id, row.id))
      .run();
    const id = `environment:${row.id}:${row.id}:setup`;
    harness.db
      .insert(environmentHookOperations)
      .values({
        id,
        operationId: id,
        hostId: args.hostId,
        path,
        kind: "setup",
        startedAt: 1,
        finishedAt: args.finishedAt,
      })
      .run();
    return row;
  }

  const rerunCreate = (calls: string[]) => async (context: StepsContext) => {
    const path = `/tmp/steps/${context.pathKey}`;
    await context.setup(path);
    calls.push(path);
    return {
      status: "created" as const,
      path,
      ownsPath: true,
      resource: { branch: await context.branchName() },
    };
  };

  it("re-runs create without running setup again", async () => {
    await withTestHarness(async (harness) => {
      const calls: string[] = [];
      installStepsProvider(rerunCreate(calls));
      const { host, project, hooks } = seed(harness);
      const row = heldProvisioning(harness, {
        hostId: host.id,
        projectId: project.id,
        finishedAt: 2,
      });
      await advanceEnvironmentProvisioning(harness.deps, {
        environmentId: row.id,
      });
      const inspect = await attachCommand(harness, row.id);
      expect(hooks.runs).toEqual([]);
      await reportAttach(harness, inspect, `bb/${row.id}`);
      await expect
        .poll(() => getEnvironment(harness.db, row.id)?.status)
        .toBe("ready");
      expect(calls).toEqual([`/tmp/steps/${row.id}`]);
      expect(getEnvironment(harness.db, row.id)).toMatchObject({
        createPending: false,
        resource: { branch: `bb/${row.id}` },
      });
      expect(pendingAttaches(harness)).toEqual([]);
      expect(setupRows(harness)).toEqual([
        expect.objectContaining({ startedAt: 1, finishedAt: 2 }),
      ]);
    });
  });

  it("treats an unfinished setup as an unknown outcome", async () => {
    await withTestHarness(async (harness) => {
      installStepsProvider(rerunCreate([]));
      const { host, project } = seed(harness);
      const row = heldProvisioning(harness, {
        hostId: host.id,
        projectId: project.id,
        finishedAt: null,
      });
      await advanceEnvironmentProvisioning(harness.deps, {
        environmentId: row.id,
      });
      await expect
        .poll(() => getEnvironment(harness.db, row.id)?.status)
        .toBe("error");
      expect(pendingAttaches(harness)).toEqual([]);
    });
  });
});

describe("review fixes", () => {
  function heldRow(
    harness: TestAppHarness,
    args: {
      hostId: string;
      projectId: string;
      status: "creating" | "provisioning";
      machine:
        | { type: "existing"; hostId: string }
        | { type: "new"; machineProviderId: string; inputs: null };
    },
  ) {
    const row = insertHeldEnvironment(harness.db, {
      projectId: args.projectId,
      hostId: args.hostId,
      name: null,
      heldBy: "user",
      environmentProviderId: PROVIDER,
      environmentProviderPluginId: PLUGIN,
      environmentProviderSelection: { machine: args.machine, inputs: null },
      environmentProviderInstanceKey: (id) => id,
      attempt: 1,
      status: args.status,
      createPending: true,
      statusMessage: "Preparing",
      providerOwnsPath: args.status === "provisioning",
    });
    harness.db
      .update(environments)
      .set({ claimPath: `/tmp/steps/${row.id}`, ...(args.status === "provisioning" ? { path: `/tmp/steps/${row.id}` } : {}) })
      .where(eq(environments.id, row.id))
      .run();
    return row;
  }

  it("fails a resumed create whose context can no longer be built, instead of looping", async () => {
    await withTestHarness(async (harness) => {
      installStepsProvider(async () => ({ status: "failed", message: "unused" }));
      const { host, project } = seed(harness);
      const row = heldRow(harness, {
        hostId: host.id,
        projectId: project.id,
        status: "provisioning",
        machine: { type: "new", machineProviderId: "gone", inputs: null },
      });
      await advanceEnvironmentProvisioning(harness.deps, {
        environmentId: row.id,
      });
      await expect
        .poll(() => getEnvironment(harness.db, row.id))
        .toMatchObject({
          status: "error",
          createPending: false,
          claimPath: null,
          statusMessage: "The environment has no machine to be created on",
        });
    });
  });

  it("fails a create whose provider throws while locating", async () => {
    await withTestHarness(async (harness) => {
      installStepsProvider(
        async () => ({ status: "created", path: "/tmp/never", ownsPath: true }),
        {
          locate: () => {
            throw new Error("locate exploded");
          },
        },
      );
      const { host, project } = seed(harness);
      const row = heldRow(harness, {
        hostId: host.id,
        projectId: project.id,
        status: "creating",
        machine: { type: "existing", hostId: host.id },
      });
      await advanceEnvironmentProvisioning(harness.deps, {
        environmentId: row.id,
      });
      await expect
        .poll(() => getEnvironment(harness.db, row.id))
        .toMatchObject({
          status: "error",
          createPending: false,
          claimPath: null,
        });
      expect(getEnvironment(harness.db, row.id)?.statusMessage).toContain(
        "locate exploded",
      );
    });
  });

  it("lets a thread join a held environment while its setup runs inside a pending create", async () => {
    await withTestHarness(async (harness) => {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      installStepsProvider(async (context) => {
        const path = `/tmp/steps/${context.pathKey}`;
        await context.setup(path);
        await gate;
        return { status: "created", path, ownsPath: true };
      });
      const { host, project, hooks } = seed(harness);
      const response = await harness.app.request("/api/v1/environments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          provider: { id: PROVIDER },
          heldBy: "user",
        }),
      });
      const { id } = (await response.json()) as { id: string };
      await expect.poll(() => hooks.runs.length).toBe(1);
      const thread = await createThreadFromRequest(harness.deps, {
        startedOnBehalfOf: null,
        environment: { type: "reuse", environmentId: id },
        input: textInput("join while setup runs"),
        origin: "cli",
        projectId: project.id,
        providerId: "codex",
      });
      expect(thread.environmentId).toBe(id);
      hooks.finish();
      release();
      await reportAttach(harness, await attachCommand(harness, id), `bb/${id}`);
      await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
        5_000,
      );
      void host;
    });
  });

  it("releases a failed held create's path claim", async () => {
    await withTestHarness(async (harness) => {
      installStepsProvider(async () => ({
        status: "failed",
        message: "could not make it",
      }));
      const { host, project } = seed(harness);
      const row = heldRow(harness, {
        hostId: host.id,
        projectId: project.id,
        status: "creating",
        machine: { type: "existing", hostId: host.id },
      });
      await advanceEnvironmentProvisioning(harness.deps, {
        environmentId: row.id,
      });
      await expect
        .poll(() => getEnvironment(harness.db, row.id))
        .toMatchObject({
          status: "error",
          statusMessage: "could not make it",
          claimPath: null,
        });
    });
  });

  it("cancels a pending create when its thread stops after setup", async () => {
    await withTestHarness(async (harness) => {
      pendingTitle(harness);
      const aborted: string[] = [];
      const { removals } = installStepsProvider(async (context) => {
        const path = `/tmp/steps/${context.pathKey}`;
        await context.setup(path);
        context.signal.addEventListener("abort", () => aborted.push(path));
        await context.branchName();
        return { status: "created", path, ownsPath: true };
      });
      const { host, project, hooks } = seed(harness);
      const thread = await startThread(harness, {
        hostId: host.id,
        projectId: project.id,
      });
      const environmentId = await preparingEnvironmentId(harness, thread.id);
      await expect.poll(() => hooks.runs.length).toBe(1);
      await expect
        .poll(() => getThread(harness.db, thread.id)?.environmentId)
        .toBe(environmentId);
      requestThreadStopForCurrentState(
        harness.deps,
        getThread(harness.db, thread.id)!,
      );
      await expect.poll(() => aborted).toEqual([`/tmp/steps/${thread.id}`]);
      hooks.fail("Environment hook cancelled");
      await expect.poll(() => hooks.runs.map((run) => run.kind)).toEqual([
        "setup",
        "teardown",
      ]);
      hooks.finish();
      await expect
        .poll(() => getEnvironment(harness.db, environmentId)?.teardownStatus)
        .toBe("removed");
      expect(removals.map((removal) => removal.path)).toEqual([
        `/tmp/steps/${thread.id}`,
      ]);
    });
  });

  it("names a resumed thread-less create after its thread's settled title, and keeps that name", async () => {
    await withTestHarness(async (harness) => {
      const title = pendingTitle(harness);
      installStepsProvider(async () => ({ status: "failed", message: "unused" }));
      const { host, project } = seed(harness);
      const row = heldRow(harness, {
        hostId: host.id,
        projectId: project.id,
        status: "creating",
        machine: { type: "existing", hostId: host.id },
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        status: "starting",
      });
      harness.db
        .update(threads)
        .set({ title: null })
        .where(eq(threads.id, thread.id))
        .run();
      startThreadTitleGeneration(harness.deps, {
        input: textInput("Please give this held environment a proper title"),
        threadId: thread.id,
      });
      await expect.poll(() => title.started()).toBe(true);
      const record = getEnvironmentProvider(PROVIDER);
      if (record === undefined) throw new Error("Missing provider");
      const context = resolveHeldEnvironmentOperationContext(
        harness.deps,
        row,
        record,
        { id: thread.id },
      );
      let named = false;
      const first = context.branchName().then((name) => {
        named = true;
        return name;
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(named).toBe(false);
      title.resolve("Held title");
      expect(await first).toBe(`bb/held-title-${thread.id}`);
      harness.db
        .update(threads)
        .set({ title: "Renamed later" })
        .where(eq(threads.id, thread.id))
        .run();
      expect(await context.branchName()).toBe(`bb/held-title-${thread.id}`);
    });
  });
});

