import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrations, type Db } from "./data.js";
import { TARGET_THREAD_OPTIONS_MESSAGE } from "./agent-options.js";
import type { AgentEnvironment } from "./rpc-types.js";
import { createScriptRunScope } from "./script-runner.js";
import { createAutomationService } from "./service.js";

const dataDirs: string[] = [];

afterEach(async () => {
  for (const dir of dataDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function createTestDb(): Db {
  const db = new Database(":memory:");
  for (const migration of migrations) db.exec(migration);
  return db;
}

async function createHarness() {
  const pluginDataDir = await mkdtemp(join(tmpdir(), "bb-auto-env-"));
  dataDirs.push(pluginDataDir);
  const providersList = vi.fn(async (_routing?: unknown) =>
    ["claude-code", "codex"].map((id) => ({
      id,
      available: true,
      capabilities: { permissionModes: ["accept-edits", "auto", "full"] },
    })),
  );
  const providersModels = vi.fn(async (_args?: unknown) => ({
    providers: [],
    permissionCeiling: "full" as const,
    models: [
      {
        id: "claude-opus-5-5",
        model: "claude-opus-5-5",
        displayName: "Opus 5.5",
        description: "",
        supportedReasoningEfforts: [],
        defaultReasoningEffort: "high",
        sessionOptions: [
          {
            id: "web-search",
            label: "Web search",
            type: "boolean" as const,
            value: false,
          },
          {
            id: "mode",
            label: "Mode",
            type: "select" as const,
            value: "agent",
            values: [
              { id: "agent", label: "Agent" },
              { id: "plan", label: "Plan" },
            ],
          },
        ],
        isDefault: true,
      },
    ],
    selectedOnlyModels: [],
    modelLoadError: null,
  }));
  const spawn = vi.fn(async (_request: unknown) => ({
    id: "thr_run",
    archivedAt: null,
    deletedAt: null,
    status: "starting",
  }));
  const bb = {
    sdk: {
      system: { config: async () => ({ primaryHostId: "host_server" }) },
      projects: {
        get: async ({ projectId }: { projectId: string }) => ({
          id: projectId,
          kind: "standard" as const,
          name: "Kops",
          gitRemoteUrl: "https://example.test/kops.git",
          createdAt: 1,
          updatedAt: 1,
          sources: [],
          defaultEnvironment: null,
          defaultEnvironmentProblem: null,
        }),
        list: async () => [],
      },
      providers: {
        list: providersList as never,
        models: providersModels as never,
      },
      environments: {
        listProviders: async () =>
          [
            { id: "git-worktree", machineProviderId: null },
            { id: "berth", machineProviderId: "berth" },
          ] as never,
      },
      threads: {
        get: async () => {
          throw new Error("not expected");
        },
        send: async () => {
          throw new Error("not expected");
        },
        spawn: spawn as never,
      },
    },
    realtime: { publish: () => undefined },
    log: {
      debug: () => undefined,
      error: () => undefined,
      info: () => undefined,
      warn: () => undefined,
    },
  };
  const service = createAutomationService({
    bb,
    db: createTestDb(),
    pluginDataDir,
    serverUrl: "http://127.0.0.1:38886",
    scriptRuns: createScriptRunScope(),
  });
  return { service, providersList, providersModels, spawn };
}

function agentAutomation(
  environment: AgentEnvironment,
  sessionOptions?: Record<string, string | boolean>,
) {
  return {
    projectId: "proj_kops",
    name: "Triage sweep",
    enabled: true,
    trigger: { triggerType: "once" as const, runAt: Date.now() + 3_600_000 },
    execution: {
      mode: "agent" as const,
      prompt: "Triage the new issues",
      providerId: "claude-code",
      model: "claude-opus-5-5",
      reasoningLevel: "high",
      permissionMode: "auto" as const,
      environment,
      ...(sessionOptions === undefined ? {} : { sessionOptions }),
    },
    origin: "human" as const,
  };
}

const BERTH_FROM_DEV: AgentEnvironment = {
  type: "provider",
  environmentProviderId: "berth",
  inputs: { branch: { kind: "new", baseBranch: "dev" } },
};

describe("an automation's own environment", () => {
  it("hands the composer's environment and agent options to each run's thread", async () => {
    const { service, spawn } = await createHarness();
    const created = await service.create(
      agentAutomation(BERTH_FROM_DEV, { "web-search": true }),
    );
    expect(created.execution).toMatchObject({
      environment: BERTH_FROM_DEV,
      sessionOptions: { "web-search": true },
    });

    await service.run({ projectId: "proj_kops", automationId: created.id });

    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    expect(spawn.mock.calls[0]?.[0]).toMatchObject({
      projectId: "proj_kops",
      environment: BERTH_FROM_DEV,
      sessionOptions: { "web-search": true },
      providerId: "claude-code",
      model: "claude-opus-5-5",
    });
  });

  it("checks permission modes on the machine the environment names", async () => {
    const { service, providersList } = await createHarness();
    await service.create(
      agentAutomation({
        type: "provider",
        environmentProviderId: "git-worktree",
        machine: { type: "existing", hostId: "host_david" },
        inputs: { branch: { kind: "named", name: "dev" } },
      }),
    );
    expect(providersList).toHaveBeenLastCalledWith({ hostId: "host_david" });
  });

  it("replaces the environment and clears agent options on update", async () => {
    const { service, spawn } = await createHarness();
    const created = await service.create(
      agentAutomation(BERTH_FROM_DEV, { "web-search": true }),
    );

    const updated = await service.update({
      projectId: "proj_kops",
      automationId: created.id,
      agent: {
        sessionOptions: null,
        target: { type: "environment", environment: { type: "project-default" } },
      },
    });
    expect(updated.execution).toMatchObject({
      environment: { type: "project-default" },
    });
    expect(updated.execution).not.toHaveProperty("sessionOptions");

    await service.run({ projectId: "proj_kops", automationId: created.id });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    const request = spawn.mock.calls[0]?.[0];
    expect(request).toMatchObject({ environment: { type: "project-default" } });
    expect(request).not.toHaveProperty("sessionOptions");
  });

  it.each([
    [
      { "web-search": "yes" },
      "Opus 5.5 does not accept web-search=yes. Accepted values: true, false.",
    ],
    [{ mode: "auto" }, "Opus 5.5 does not accept mode=auto. Accepted values: agent, plan."],
    [{ turbo: true }, "Opus 5.5 has no agent option turbo. Its options: web-search, mode."],
  ])(
    "refuses agent options %j the model cannot take",
    async (sessionOptions, message) => {
      const { service, providersModels } = await createHarness();

      await expect(
        service.create(agentAutomation(BERTH_FROM_DEV, sessionOptions)),
      ).rejects.toThrow(message);
      expect(providersModels).toHaveBeenLastCalledWith({
        providerId: "claude-code",
      });
      expect(service.list({ projectId: "proj_kops" })).toHaveLength(0);
    },
  );

  it("refuses agent options for runs that re-prompt an existing thread", async () => {
    const { service } = await createHarness();
    const created = await service.create(agentAutomation(BERTH_FROM_DEV));

    await expect(
      service.update({
        projectId: "proj_kops",
        automationId: created.id,
        agent: {
          sessionOptions: { "web-search": true },
          target: { type: "target-thread", threadId: "thr_existing" },
        },
      }),
    ).rejects.toThrow(TARGET_THREAD_OPTIONS_MESSAGE);
  });

  it.each([
    [
      "the provider changes",
      { providerId: "codex", model: "gpt-5.6-codex" },
    ],
    [
      "runs move to an existing thread",
      { target: { type: "target-thread" as const, threadId: "thr_existing" } },
    ],
  ])("drops agent options when %s", async (_change, agent) => {
    const { service } = await createHarness();
    const created = await service.create(
      agentAutomation(BERTH_FROM_DEV, { "web-search": true }),
    );

    const updated = await service.update({
      projectId: "proj_kops",
      automationId: created.id,
      agent,
    });

    expect(updated.execution).not.toHaveProperty("sessionOptions");
  });

  it.each([
    [
      "a provider that is not installed",
      { type: "provider" as const, environmentProviderId: "modal-sandbox", inputs: null },
      "The modal-sandbox environment provider is not installed.",
    ],
    [
      "a plain provider without a machine",
      { type: "provider" as const, environmentProviderId: "git-worktree", inputs: null },
      "The git-worktree environment provider needs a machine: an existing one, or a new one from a machine provider.",
    ],
    [
      "a composition pinned to an existing machine",
      {
        type: "provider" as const,
        environmentProviderId: "berth",
        machine: { type: "existing" as const, hostId: "host_david" },
        inputs: null,
      },
      "The berth environment provider creates its own new berth machine for each run, so it takes no other machine.",
    ],
  ])("refuses %s, which every run would fail on", async (_case, environment, message) => {
    const { service } = await createHarness();

    await expect(service.create(agentAutomation(environment))).rejects.toThrow(
      message,
    );
    expect(service.list({ projectId: "proj_kops" })).toHaveLength(0);
  });
});
