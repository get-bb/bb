import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
  PluginContextStaleError,
  type FakePluginHost,
} from "@bb/plugin-sdk/testing";
import plugin from "./server.js";
import {
  automationListResponseSchema,
  automationsOverviewResponseSchema,
  automationResponseSchema,
  automationRunListResponseSchema,
  automationRunRpcResponseSchema,
} from "./rpc-types.js";

const PROJECT_ID = "proj_test";
const MISSING_PROJECT_ID = "proj_missing";
const DELETED_PROJECT_ID = "proj_deleted";
const THREAD_ID = "thr_target";
const SECTION_ID = "sec_reviews";

const rpcMethods = [
  "automations_overview",
  "automations_list",
  "automations_get",
  "automations_create",
  "automations_update",
  "automations_delete",
  "automations_pause",
  "automations_resume",
  "automations_run",
  "automations_runs",
].sort();

function project(projectId = PROJECT_ID) {
  return { id: projectId, name: "Test Project", deletedAt: null };
}

async function bootAutomationsPlugin(
  supportedPermissionModes: Array<"accept-edits" | "auto" | "full"> = [
    "accept-edits",
    "auto",
    "full",
  ],
): Promise<FakePluginHost> {
  const host = createFakePluginHost({
    pluginId: "automations",
    sdk: {
      projects: {
        async get({ projectId }) {
          if (projectId === PROJECT_ID) return project(projectId);
          throw new Error("Project not found");
        },
        async list() {
          return [project()];
        },
      },
      threadSections: {
        async list() {
          return [
            {
              id: SECTION_ID,
              name: "Reviews",
              createdAt: 1,
              updatedAt: 1,
            },
          ];
        },
      },
      hosts: {
        async list() {
          return [{ id: "host_test", status: "connected" }];
        },
      },
      providers: {
        async list() {
          return [
            {
              id: "codex",
              capabilities: { supportedPermissionModes },
            },
          ] as never;
        },
      },
      threads: {
        async get({ threadId }) {
          return {
            id: threadId,
            archivedAt: null,
            deletedAt: null,
            sectionId: threadId === THREAD_ID ? SECTION_ID : null,
            status: "idle",
          };
        },
        async send() {
          return { ok: true };
        },
        async spawn() {
          return {
            id: "thr_spawned",
            archivedAt: null,
            deletedAt: null,
            status: "idle",
          };
        },
      },
    },
  });
  // The in-repo testing subpath and bundled plugin SDK entry currently expose
  // equivalent runtime APIs through distinct type declarations.
  await plugin(host.bb as unknown as Parameters<typeof plugin>[0]);
  return host;
}

function agentExecution(targetThreadId?: string) {
  return {
    mode: "agent",
    prompt: "summarize the inbox",
    providerId: "codex",
    model: "gpt-5",
    permissionMode: "accept-edits",
    environment: { type: "project-default" },
    ...(targetThreadId ? { targetThreadId } : {}),
  };
}

function oneShotTrigger() {
  return { triggerType: "once", runAt: Date.now() + 60_000 };
}

async function createAgentAutomation(
  harness: FakePluginHost["harness"],
  options: {
    name?: string;
    trigger?:
      | ReturnType<typeof oneShotTrigger>
      | { triggerType: "schedule"; cron: string; timezone: string };
    targetThreadId?: string;
  } = {},
) {
  return automationResponseSchema.parse(
    await harness.callRpc("automations_create", {
      projectId: PROJECT_ID,
      name: options.name ?? "Agent automation",
      enabled: true,
      trigger: options.trigger ?? oneShotTrigger(),
      execution: agentExecution(options.targetThreadId),
      origin: "human",
    }),
  );
}

function signalKinds(host: FakePluginHost) {
  return host.harness.realtimeSignals
    .filter((signal) => signal.channel === "automations")
    .map((signal) => signal.payload)
    .filter(
      (payload): payload is { projectId: string; kind: string } =>
        typeof payload === "object" &&
        payload !== null &&
        "projectId" in payload &&
        "kind" in payload,
    )
    .map((payload) => payload.kind);
}

describe("automations server plugin harness", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("boots through server.ts and registers rpc, cli, thread events, and sweep service", async () => {
    const { harness } = await bootAutomationsPlugin();

    expect([...harness.registrations.rpcMethods].sort()).toEqual(rpcMethods);
    expect(harness.registrations.cli?.name).toBe("automation");
    expect(
      harness.registrations.services.map((service) => service.name),
    ).toEqual(["automation-sweep"]);
    expect(harness.registrations.threadEventHandlers).toMatchObject({
      "thread.idle": 1,
      "thread.failed": 1,
      "thread.deleted": 1,
    });
    expect(harness.registrations.settingsDescriptors).toEqual({});

    await harness.dispose();
  });

  it("round-trips create, list, get, and delete over RPC and rejects unavailable projects", async () => {
    const host = await bootAutomationsPlugin();
    const { harness } = host;

    const created = await createAgentAutomation(harness, {
      name: "RPC agent",
      targetThreadId: THREAD_ID,
    });
    const listed = automationListResponseSchema.parse(
      await harness.callRpc("automations_list", { projectId: PROJECT_ID }),
    );
    expect(listed.map((automation) => automation.id)).toContain(created.id);
    const overview = automationsOverviewResponseSchema.parse(
      await harness.callRpc("automations_overview"),
    );
    expect(overview.automations).toContainEqual(
      expect.objectContaining({
        automation: expect.objectContaining({ id: created.id }),
        project: { id: PROJECT_ID, name: "Test Project" },
      }),
    );

    const found = automationResponseSchema.parse(
      await harness.callRpc("automations_get", {
        projectId: PROJECT_ID,
        automationId: created.id,
      }),
    );
    expect(found).toMatchObject({
      id: created.id,
      name: "RPC agent",
      execution: expect.objectContaining({ mode: "agent" }),
    });

    await expect(
      harness.callRpc("automations_create", {
        projectId: MISSING_PROJECT_ID,
        name: "Missing project",
        enabled: true,
        trigger: oneShotTrigger(),
        execution: agentExecution(),
        origin: "human",
      }),
    ).rejects.toThrow(`Project ${MISSING_PROJECT_ID} is not available`);

    await expect(
      harness.callRpc("automations_create", {
        projectId: DELETED_PROJECT_ID,
        name: "Deleted project",
        enabled: true,
        trigger: oneShotTrigger(),
        execution: agentExecution(),
        origin: "human",
      }),
    ).rejects.toThrow(`Project ${DELETED_PROJECT_ID} is not available`);

    await expect(
      harness.callRpc("automations_delete", {
        projectId: PROJECT_ID,
        automationId: created.id,
      }),
    ).resolves.toEqual({ ok: true });
    expect(
      automationListResponseSchema.parse(
        await harness.callRpc("automations_list", { projectId: PROJECT_ID }),
      ),
    ).toHaveLength(0);
    expect(signalKinds(host)).toContain("automations-changed");

    await harness.dispose();
  });

  it("creates a script automation through CLI and lists it through both CLI and RPC", async () => {
    const { harness } = await bootAutomationsPlugin();
    const runAt = new Date(Date.now() + 60_000).toISOString();

    const createdResult = await harness.runCli([
      "create",
      "--project",
      PROJECT_ID,
      "--name",
      "CLI script",
      "--at",
      runAt,
      "--script",
      "echo ok",
      "--interpreter",
      "bash",
      "--json",
    ]);
    expect(createdResult.exitCode).toBe(0);
    const created = automationResponseSchema.parse(
      JSON.parse(createdResult.stdout ?? ""),
    );
    expect(created).toMatchObject({
      name: "CLI script",
      execution: expect.objectContaining({ mode: "script" }),
    });

    const cliList = await harness.runCli([
      "list",
      "--project",
      PROJECT_ID,
      "--json",
    ]);
    expect(cliList.exitCode).toBe(0);
    expect(
      automationListResponseSchema
        .parse(JSON.parse(cliList.stdout ?? ""))
        .map((automation) => automation.id),
    ).toEqual([created.id]);
    expect(
      automationListResponseSchema.parse(
        await harness.callRpc("automations_list", { projectId: PROJECT_ID }),
      )[0]?.id,
    ).toBe(created.id);
    const editable = automationResponseSchema.parse(
      await harness.callRpc("automations_get", {
        projectId: PROJECT_ID,
        automationId: created.id,
      }),
    );
    expect(editable.execution).toMatchObject({
      mode: "script",
      script: "echo ok",
    });
    expect(editable.execution).not.toHaveProperty("scriptFile");

    const agentUpdateResult = await harness.runCli([
      "update",
      created.id,
      "--project",
      PROJECT_ID,
      "--prompt",
      "triage the inbox",
      "--provider",
      "codex",
      "--model",
      "gpt-5",
      "--permission-mode",
      "accept-edits",
      "--target-thread",
      THREAD_ID,
      "--json",
    ]);
    expect(agentUpdateResult.exitCode).toBe(0);
    const agentUpdated = automationResponseSchema.parse(
      JSON.parse(agentUpdateResult.stdout ?? ""),
    );
    expect(agentUpdated.execution).toEqual({
      mode: "agent",
      prompt: "triage the inbox",
      providerId: "codex",
      model: "gpt-5",
      permissionMode: "accept-edits",
      environment: { type: "project-default" },
      targetThreadId: THREAD_ID,
    });

    const scriptUpdateResult = await harness.runCli([
      "update",
      created.id,
      "--project",
      PROJECT_ID,
      "--script",
      "echo updated",
      "--interpreter",
      "bash",
      "--timeout",
      "12000",
      "--env-json",
      '{"CHANNEL":"qa"}',
      "--json",
    ]);
    expect(scriptUpdateResult.exitCode).toBe(0);
    const scriptUpdated = automationResponseSchema.parse(
      JSON.parse(scriptUpdateResult.stdout ?? ""),
    );
    expect(scriptUpdated.execution).toEqual({
      mode: "script",
      scriptFile: "script.sh",
      interpreter: "bash",
      timeoutMs: 12_000,
      env: { CHANNEL: "qa" },
    });
    const updatedEditable = automationResponseSchema.parse(
      await harness.callRpc("automations_get", {
        projectId: PROJECT_ID,
        automationId: created.id,
      }),
    );
    expect(updatedEditable.execution).toEqual({
      mode: "script",
      script: "echo updated",
      interpreter: "bash",
      timeoutMs: 12_000,
      env: { CHANNEL: "qa" },
    });

    const errorResult = await harness.runCli([
      "create",
      "--project",
      PROJECT_ID,
    ]);
    expect(errorResult.exitCode).toBe(1);
    expect(errorResult.stderr).toContain("Provide an execution mode");

    await harness.dispose();
  });

  it.each([
    {
      supported: ["accept-edits", "auto", "full"] as const,
      expected: "auto",
    },
    {
      supported: ["accept-edits", "full"] as const,
      expected: "full",
    },
  ])(
    "defaults agent automations to $expected for provider capabilities",
    async ({ supported, expected }) => {
      const { harness } = await bootAutomationsPlugin([...supported]);
      const result = await harness.runCli([
        "create",
        "--project",
        PROJECT_ID,
        "--name",
        `CLI agent ${expected}`,
        "--at",
        new Date(Date.now() + 60_000).toISOString(),
        "--prompt",
        "Summarize the inbox",
        "--provider",
        "codex",
        "--model",
        "gpt-5",
        "--json",
      ]);

      expect(result.exitCode).toBe(0);
      const automation = automationResponseSchema.parse(
        JSON.parse(result.stdout ?? ""),
      );
      expect(automation.execution).toMatchObject({
        mode: "agent",
        permissionMode: expected,
      });
      await harness.dispose();
    },
  );

  it("rejects an explicit mode the automation provider does not support", async () => {
    const { harness } = await bootAutomationsPlugin(["accept-edits", "full"]);
    const result = await harness.runCli([
      "create",
      "--project",
      PROJECT_ID,
      "--name",
      "Unsupported auto",
      "--at",
      new Date(Date.now() + 60_000).toISOString(),
      "--prompt",
      "Summarize the inbox",
      "--provider",
      "codex",
      "--model",
      "gpt-5",
      "--permission-mode",
      "auto",
    ]);

    expect(result).toMatchObject({ exitCode: 1 });
    expect(result.stderr).toContain(
      "Permission mode auto is not supported by provider codex",
    );
    await harness.dispose();
  });

  it("dedupes manual runs through RPC idempotency keys", async () => {
    const { harness } = await bootAutomationsPlugin();
    const automation = await createAgentAutomation(harness);

    const first = automationRunRpcResponseSchema.parse(
      await harness.callRpc("automations_run", {
        projectId: PROJECT_ID,
        automationId: automation.id,
        idempotencyKey: "same-key",
      }),
    );
    const second = automationRunRpcResponseSchema.parse(
      await harness.callRpc("automations_run", {
        projectId: PROJECT_ID,
        automationId: automation.id,
        idempotencyKey: "same-key",
      }),
    );
    expect(second.run.id).toBe(first.run.id);
    expect(
      automationRunListResponseSchema.parse(
        await harness.callRpc("automations_runs", {
          projectId: PROJECT_ID,
          automationId: automation.id,
        }),
      ).runs,
    ).toHaveLength(1);

    await harness.dispose();
  });

  it("dispatches a due agent automation from one sweep tick and closes it from thread.idle", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const host = await bootAutomationsPlugin();
    const { harness } = host;
    const automation = await createAgentAutomation(harness, {
      name: "Sweep",
      trigger: { triggerType: "schedule", cron: "* * * * *", timezone: "UTC" },
    });

    vi.setSystemTime(new Date("2026-01-01T00:01:05.000Z"));
    const service = harness.runService("automation-sweep");
    service.controller.abort();
    await service.done;

    expect(harness.sdk.callsTo("threads.spawn")).toHaveLength(1);
    expect(harness.sdk.callsTo("threads.spawn")[0]?.[0]).toMatchObject({
      projectId: PROJECT_ID,
      title: "Sweep",
      origin: "plugin",
      originPluginId: "automations",
    });
    const runningRuns = automationRunListResponseSchema.parse(
      await harness.callRpc("automations_runs", {
        projectId: PROJECT_ID,
        automationId: automation.id,
      }),
    ).runs;
    expect(runningRuns).toHaveLength(1);
    expect(runningRuns[0]).toMatchObject({
      automationId: automation.id,
      status: "running",
      threadId: "thr_spawned",
      trigger: "schedule",
    });

    await harness.emitThreadEvent("thread.idle", {
      thread: makeThreadResponse({ id: "thr_spawned", projectId: PROJECT_ID }),
      lastAssistantText: null,
    });
    const closedRuns = automationRunListResponseSchema.parse(
      await harness.callRpc("automations_runs", {
        projectId: PROJECT_ID,
        automationId: automation.id,
      }),
    ).runs;
    expect(closedRuns[0]).toMatchObject({
      status: "succeeded",
      threadId: "thr_spawned",
    });
    expect(signalKinds(host)).toEqual(
      expect.arrayContaining([
        "automations-changed",
        "automation-runs-changed",
      ]),
    );

    await harness.dispose();
  });

  it("disables automations targeting a deleted thread", async () => {
    const { harness } = await bootAutomationsPlugin();
    const automation = await createAgentAutomation(harness, {
      name: "Thread target",
      targetThreadId: THREAD_ID,
    });

    await harness.emitThreadEvent("thread.deleted", {
      thread: makeThreadResponse({
        id: THREAD_ID,
        projectId: PROJECT_ID,
        deletedAt: Date.now(),
      }),
    });

    const disabled = automationResponseSchema.parse(
      await harness.callRpc("automations_get", {
        projectId: PROJECT_ID,
        automationId: automation.id,
      }),
    );
    expect(disabled).toMatchObject({
      enabled: false,
      nextRunAt: null,
      lastError: "target thread deleted",
    });

    await harness.dispose();
  });

  it("dispose aborts the sweep service and poisons stale bb handles", async () => {
    const { bb, harness } = await bootAutomationsPlugin();
    const service = harness.runService("automation-sweep");

    await harness.dispose();
    await service.done;
    await expect(bb.storage.kv.get("after-dispose")).rejects.toThrow(
      PluginContextStaleError,
    );
  });
});
