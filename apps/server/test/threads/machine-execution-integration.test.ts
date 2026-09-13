import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExecutionIntegrationFixture } from "../helpers/execution-integration-fixture.js";
import { afterEach, beforeEach, expect, it } from "vitest";
import { getHost, getThread, threadExecutionOwners } from "@bb/db";
import { z } from "zod";
import {
  hostExecutionIntegrationSettingsSchema,
  threadQueuedMessageListResponseSchema,
} from "@bb/server-contract";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import {
  buildExecutionOptions,
  buildThreadStartCommand,
} from "../../src/services/threads/thread-commands.js";
import { callHostOnlineRpc } from "../../src/services/hosts/online-rpc.js";
import {
  listQueuedCommands,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../helpers/test-app.js";

let fixtureFiles: Awaited<ReturnType<typeof createExecutionIntegrationFixture>>;
let harness: TestAppHarness;
beforeEach(async () => {
  harness = await createTestAppHarness();
  fixtureFiles = await createExecutionIntegrationFixture();
});
afterEach(async () => {
  await harness.cleanup();
  await fixtureFiles.cleanup();
});

async function setup() {
  const plugin = await harness.pluginService.installPath(fixtureFiles.root);
  expect(plugin.status, plugin.statusDetail ?? "").toBe("running");
  const { host } = seedHostSession(harness.deps, {
    id: "host-integration-remote",
  });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: harness.config.dataDir,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: harness.config.dataDir,
  });
  return { host, project, environment, plugin };
}

async function bind(
  hostId: string,
  integrationId: string | null = "scripted-execution",
) {
  const response = await harness.app.request(
    `/api/v1/hosts/${hostId}/execution-integration`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ integrationId }),
    },
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return hostExecutionIntegrationSettingsSchema.parse(await response.json());
}

async function create(
  fixture: Awaited<ReturnType<typeof setup>>,
  providerId = "codex",
  reuse = false,
  deferred = false,
) {
  return createThreadFromRequest(harness.deps, {
    environment: reuse
      ? { type: "reuse", environmentId: fixture.environment.id }
      : {
          type: "host",
          hostId: fixture.host.id,
          workspace: { type: "unmanaged", path: harness.config.dataDir },
        },
    ...(deferred ? { sendAt: Date.now() + 3600_000 } : {}),
    input: textInput("Prove which bridge owns this launch"),
    model: "test-provider-default",
    reasoningLevel: "medium",
    permissionMode: "full",
    origin: "app",
    projectId: fixture.project.id,
    providerId,
    startedOnBehalfOf: null,
  });
}

async function startCommand(threadId: string) {
  const start = await waitForQueuedCommand(
    harness,
    ({ command }) =>
      command.type === "thread.start" && command.threadId === threadId,
  );
  if (start.command.type !== "thread.start")
    throw new Error("Expected a start command");
  return start.command;
}

it("keeps ordinary machine execution when an external integration is merely installed", async () => {
  const fixture = await setup();
  const thread = await create(fixture);
  expect(await startCommand(thread.id)).toMatchObject({
    providerId: "codex",
    bridgeLaunch: { pluginId: "provider-codex" },
  });
});

it.each([false, true])(
  "routes explicit machine and environment targets without changing harness/model (reuse=%s)",
  async (reuse) => {
    const fixture = await setup();
    await bind(fixture.host.id);
    const thread = await create(fixture, "codex", reuse);
    expect(await startCommand(thread.id)).toMatchObject({
      providerId: "codex",
      bridgeLaunch: {
        pluginId: fixture.plugin.id,
        executionIntegrationId: "scripted-execution",
        capabilities: { supportsServiceTier: false },
      },
      options: {
        model: "test-provider-default",
        providerOptions: { harness: "codex", executionOwner: "integration" },
      },
    });
    expect(harness.db.select().from(threadExecutionOwners).all()).toMatchObject(
      [
        {
          threadId: thread.id,
          hostId: fixture.host.id,
          integrationId: "scripted-execution",
          pluginId: fixture.plugin.id,
        },
      ],
    );
  },
);

it("retains the binding while the plugin is disabled and refuses alternate providers", async () => {
  const fixture = await setup();
  await bind(fixture.host.id);
  await harness.pluginService.setEnabled(fixture.plugin.id, false);
  const response = await harness.app.request(
    `/api/v1/hosts/${fixture.host.id}/execution-integration`,
  );
  expect(
    hostExecutionIntegrationSettingsSchema.parse(await response.json())
      .required,
  ).toMatchObject({ id: "scripted-execution", available: false });
  for (const providerId of ["codex", "pi", "claude-code"])
    await expect(create(fixture, providerId)).rejects.toMatchObject({
      body: { code: "execution_integration_unavailable" },
    });
  expect(listQueuedCommands(harness, "thread.start")).toEqual([]);
  expect(getHost(harness.db, fixture.host.id)?.executionIntegration?.id).toBe(
    "scripted-execution",
  );
});

it("refuses an unsupported harness and a broken integration without a native launch", async () => {
  const fixture = await setup();
  await bind(fixture.host.id);
  await expect(create(fixture, "claude-code")).rejects.toMatchObject({
    body: { code: "execution_integration_unsupported_provider" },
  });
  await harness.pluginService.updateSettings(fixture.plugin.id, {
    unavailable: true,
  });
  const broken = await create(fixture);
  await expect
    .poll(() => getThread(harness.db, broken.id)?.status)
    .toBe("error");
  expect(listQueuedCommands(harness, "thread.start")).toEqual([]);
});

it("rejects a prepared native command when the machine changes before transport", async () => {
  const fixture = await setup();
  const thread = await create(fixture);
  const command = await startCommand(thread.id);
  await bind(fixture.host.id);
  await expect(
    callHostOnlineRpc(harness.deps, {
      hostId: fixture.host.id,
      command,
      timeoutMs: 100,
    }),
  ).rejects.toMatchObject({ body: { code: "execution_integration_changed" } });
  expect(listQueuedCommands(harness, "thread.start")).toHaveLength(1);
});

it("keeps session ownership when switching a machine back to ordinary execution", async () => {
  const fixture = await setup();
  await bind(fixture.host.id);
  const thread = await create(fixture);
  const command = await startCommand(thread.id);
  seedThreadRuntimeState(harness.deps, {
    threadId: thread.id,
    environmentId: fixture.environment.id,
    providerThreadId: "external-session",
  });
  await bind(fixture.host.id, null);
  await expect(
    buildThreadStartCommand(harness.deps, {
      environment: fixture.environment,
      execution: await buildExecutionOptions(
        harness.deps,
        {},
        { threadId: thread.id },
      ),
      fork: null,
      permissionEscalation: "ask",
      input: command.input,
      projectId: fixture.project.id,
      providerId: "codex",
      requestId: command.requestId,
      syncGeneratedTitle: false,
      thread: getThread(harness.db, thread.id)!,
    }),
  ).rejects.toMatchObject({
    body: { code: "execution_session_owner_conflict" },
  });
});

it("rejects unknown integration settings atomically", async () => {
  const fixture = await setup();
  await bind(fixture.host.id);
  const response = await harness.app.request(
    `/api/v1/hosts/${fixture.host.id}/execution-integration`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ integrationId: "missing" }),
    },
  );
  expect(response.status).toBe(409);
  expect(z.object({ code: z.string() }).parse(await response.json()).code).toBe(
    "execution_integration_unavailable",
  );
  expect(getHost(harness.db, fixture.host.id)?.executionIntegration?.id).toBe(
    "scripted-execution",
  );
});

it("denies machine credentials permission to change the required integration", async () => {
  const fixture = await setup();
  const response = await harness.app.request(
    `/api/v1/hosts/${fixture.host.id}/execution-integration`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-bb-gate-auth": "machine",
      },
      body: JSON.stringify({ integrationId: "scripted-execution" }),
    },
  );
  expect(response.status).toBe(403);
  expect(getHost(harness.db, fixture.host.id)?.executionIntegration).toBeNull();
});

it("persists the binding and session owner through server recreation with a disposable SQLite file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bb-execution-persistence-"));
  const databasePath = join(directory, "test.db");
  await harness.cleanup();
  try {
    harness = await createTestAppHarness({ databasePath });
    const fixture = await setup();
    await bind(fixture.host.id);
    const thread = await create(fixture);
    await startCommand(thread.id);
    await harness.cleanup();
    harness.db.$client.close();
    harness = await createTestAppHarness({ databasePath });
    const setting = await harness.app.request(
      `/api/v1/hosts/${fixture.host.id}/execution-integration`,
    );
    expect(
      hostExecutionIntegrationSettingsSchema.parse(await setting.json())
        .required,
    ).toMatchObject({ id: "scripted-execution", available: false });
    expect(harness.db.select().from(threadExecutionOwners).all()).toMatchObject(
      [{ threadId: thread.id, integrationId: "scripted-execution" }],
    );
    await harness.pluginService.installPath(fixtureFiles.root);
    const restored = await harness.app.request(
      `/api/v1/hosts/${fixture.host.id}/execution-integration`,
    );
    expect(
      hostExecutionIntegrationSettingsSchema.parse(await restored.json())
        .required,
    ).toMatchObject({ id: "scripted-execution", available: true });
  } finally {
    await harness.cleanup();
    harness.db.$client.close();
    await rm(directory, { recursive: true, force: true });
    harness = await createTestAppHarness();
  }
});

it("enforces the required integration on explicit Send now and retry", async () => {
  const fixture = await setup();
  await bind(fixture.host.id);
  const thread = await create(fixture, "codex", false, true);
  const response = await harness.app.request(
    `/api/v1/threads/${thread.id}/queued-messages`,
  );
  const [queued] = threadQueuedMessageListResponseSchema.parse(
    await response.json(),
  );
  expect(queued).toBeDefined();
  await harness.pluginService.setEnabled(fixture.plugin.id, false);
  const sendNow = await harness.app.request(
    `/api/v1/threads/${thread.id}/queued-messages/${queued!.id}/send`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "auto" }),
    },
  );
  expect(sendNow.status).toBe(409);
  expect(listQueuedCommands(harness, "thread.start")).toEqual([]);
  await harness.pluginService.setEnabled(fixture.plugin.id, true);
  const retry = await harness.app.request(
    `/api/v1/threads/${thread.id}/queued-messages/${queued!.id}/send`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "auto" }),
    },
  );
  expect(retry.status, await retry.clone().text()).toBe(200);
  expect(await startCommand(thread.id)).toMatchObject({
    bridgeLaunch: {
      pluginId: fixture.plugin.id,
      executionIntegrationId: "scripted-execution",
    },
  });
});

it("only offers compatible integrations and blocks a binding whose machine support changes", async () => {
  const fixture = await setup();
  const original =
    harness.deps.providerRegistry.getExecutionIntegration("scripted-execution");
  if (original === null) throw new Error("Missing integration fixture");
  const first = harness.deps.providerRegistry.registerExecutionIntegration({
    ...original,
    id: "restricted-execution",
    hostIds: [fixture.host.id],
  });
  await bind(fixture.host.id, "restricted-execution");
  first.dispose();
  const replacement =
    harness.deps.providerRegistry.registerExecutionIntegration({
      ...original,
      id: "restricted-execution",
      hostIds: ["another-machine"],
    });
  try {
    const response = await harness.app.request(
      `/api/v1/hosts/${fixture.host.id}/execution-integration`,
    );
    const settings = hostExecutionIntegrationSettingsSchema.parse(
      await response.json(),
    );
    expect(settings.required).toMatchObject({
      id: "restricted-execution",
      available: false,
    });
    expect(
      settings.integrations.some(
        (integration) => integration.id === "restricted-execution",
      ),
    ).toBe(false);
    await expect(create(fixture)).rejects.toMatchObject({
      body: { code: "execution_integration_incompatible_machine" },
    });
    expect(listQueuedCommands(harness, "thread.start")).toEqual([]);
  } finally {
    replacement.dispose();
  }
});
