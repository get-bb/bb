import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
  type FakePluginHost,
} from "@get-bb/plugin-sdk/testing";
import {
  createAutomation,
  createManualRun,
  getRunningAutomationRun,
  migrations,
} from "./data.js";
import { prepareAutomationRun } from "./preparation.js";
import { executeAgentRun } from "./run.js";
import type { AutomationExecution } from "./rpc-types.js";

type AgentExecution = Extract<AutomationExecution, { mode: "agent" }>;
const NOW = Date.parse("2026-05-12T05:30:00Z");
const hosts: FakePluginHost[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(hosts.splice(0).map((host) => host.harness.dispose()));
});

function execution(overrides: Partial<AgentExecution> = {}): AgentExecution {
  return {
    mode: "agent",
    networkAccess: false,
    prompt: "Continue only if work remains unfinished; otherwise stop.",
    providerId: "codex",
    model: "fixture-model",
    reasoningLevel: "medium",
    permissionMode: "accept-edits",
    environment: { type: "project-default" },
    ...overrides,
  };
}

function candidate(id: string, overrides = {}) {
  return {
    ...makeThreadResponse({
      id,
      projectId: "project-fixture",
      environmentId: "environment-original",
      providerId: "codex",
      updatedAt: NOW,
    }),
    hasPendingInteraction: false,
    queuedWork: "none",
    ...overrides,
  };
}

function request(
  initiator: "user" | "agent" | "system",
  createdAt = NOW,
  seq = 1,
) {
  return {
    type: "client/turn/requested",
    createdAt,
    seq,
    data: { initiator },
  };
}

function hostForPreparation(
  options: {
    candidates?: ReturnType<typeof candidate>[];
    events?: Record<string, ReturnType<typeof request>[]>;
    github?: {
      status: string;
      reason?: string;
      repo?: string;
      branch?: string;
      commit?: string;
      checks?: { name: string; status: string; url: string }[];
    };
    githubError?: Error;
  } = {},
) {
  const host = createFakePluginHost({
    pluginId: "automations",
    sdk: {
      threads: {
        list: async () => options.candidates ?? [],
        events: {
          list: async ({ threadId }) => options.events?.[threadId] ?? [],
        },
        spawn: async () => makeThreadResponse({ id: "thread-restricted-job" }),
        get: async () => {
          throw new Error("The original session must not be resumed");
        },
        send: async () => {
          throw new Error("The original session must not receive job input");
        },
      },
      plugins: {
        list: async () => ({
          plugins: [{ id: "github-fixture", source: "builtin:github" }],
        }),
        callRpc: async ({ outputSchema }) => {
          if (options.githubError) throw options.githubError;
          return outputSchema.parse(
            options.github ?? {
              status: "unavailable",
              reason: "not-signed-in",
            },
          );
        },
      },
    },
  });
  hosts.push(host);
  return host;
}

async function dispatch(host: FakePluginHost, agentExecution: AgentExecution) {
  const db = host.bb.storage.database();
  host.bb.storage.migrate(db, migrations);
  const automation = createAutomation(db, {
    id: "automation-fixture",
    projectId: "project-fixture",
    name: "Weeknight work",
    enabled: true,
    trigger: { triggerType: "schedule", cron: "0 22 * * 1-5", timezone: "UTC" },
    runMode: "agent",
    execution: agentExecution,
    origin: "app",
    createdByThreadId: null,
    nextRunAt: NOW,
  });
  const { run } = createManualRun(db, {
    automationId: automation.id,
    runMode: "agent",
    now: NOW,
  });
  const onFailure = vi.fn();
  await executeAgentRun(host.bb, db, {
    automation,
    run,
    execution: agentExecution,
    onFailure,
  });
  return { db, automation, run, onFailure };
}

describe("network-disabled automation dispatch", () => {
  it.each(["codex", "claude-code"])(
    "seeds the %s session restriction in the spawn request",
    async (providerId) => {
      const host = hostForPreparation();
      const { db, automation, run, onFailure } = await dispatch(
        host,
        execution({ providerId }),
      );

      expect(onFailure).not.toHaveBeenCalled();
      expect(host.harness.sdk.callsTo("threads.spawn")).toEqual([
        [
          expect.objectContaining({
            providerId,
            permissionMode: "accept-edits",
            pluginMetadata: {
              networkAccess: false,
              automationId: automation.id,
              runId: run.id,
            },
          }),
        ],
      ]);
      expect(getRunningAutomationRun(db, automation.id)?.threadId).toBe(
        "thread-restricted-job",
      );
    },
  );

  it.each(["codex", "claude-code"])(
    "rejects %s target-session reuse before any SDK dispatch",
    async (providerId) => {
      const host = hostForPreparation();
      const { onFailure } = await dispatch(
        host,
        execution({ providerId, targetThreadId: "original-thread" }),
      );

      expect(onFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Network-disabled jobs must use their own session",
        }),
      );
      expect(host.harness.sdk.calls).toEqual([]);
    },
  );

  it("forks the person's conversation into a restricted session in the same workspace", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const host = hostForPreparation({
      candidates: [candidate("original-thread")],
      events: { "original-thread": [request("user")] },
    });
    const { automation, run, onFailure } = await dispatch(
      host,
      execution({
        preparation: {
          kind: "unfinished-thread",
          timezone: "America/Los_Angeles",
        },
      }),
    );

    expect(onFailure).not.toHaveBeenCalled();
    expect(host.harness.sdk.callsTo("threads.spawn")).toEqual([
      [
        expect.objectContaining({
          sourceThreadId: "original-thread",
          originKind: "fork",
          environment: { type: "reuse", environmentId: "environment-original" },
          permissionMode: "accept-edits",
          pluginMetadata: {
            networkAccess: false,
            automationId: automation.id,
            runId: run.id,
          },
          prompt: expect.stringContaining(
            "Continue only if work remains unfinished",
          ),
        }),
      ],
    ]);
    expect(host.harness.sdk.callsTo("threads.get")).toEqual([]);
    expect(host.harness.sdk.callsTo("threads.send")).toEqual([]);
  });

  it("reads main's CI before spawning and supplies the recorded commit as untrusted evidence", async () => {
    const host = hostForPreparation({
      github: {
        status: "available",
        repo: "owner/repository",
        branch: "main",
        commit: "abc123",
        checks: [
          {
            name: "Unit tests",
            status: "failure",
            url: "https://github.com/owner/repository/actions/runs/1",
          },
        ],
      },
    });
    const { onFailure } = await dispatch(
      host,
      execution({ preparation: { kind: "main-branch-checks" } }),
    );

    expect(onFailure).not.toHaveBeenCalled();
    expect(host.harness.sdk.calls.map((call) => call.path)).toEqual([
      "plugins.list",
      "plugins.callRpc",
      "threads.spawn",
    ]);
    expect(host.harness.sdk.callsTo("plugins.callRpc")[0]?.[0]).toMatchObject({
      method: "mainBranchChecks",
      input: { projectId: "project-fixture" },
    });
    expect(host.harness.sdk.callsTo("threads.spawn")[0]?.[0]).toMatchObject({
      prompt: expect.stringContaining('"commit":"abc123"'),
    });
    expect(host.harness.sdk.callsTo("threads.spawn")[0]?.[0]).toMatchObject({
      prompt: expect.stringContaining("untrusted data"),
    });
  });

  it.each(["signed-out", "read-error"])(
    "falls back to local tests when CI is %s",
    async (reason) => {
      const host = hostForPreparation(
        reason === "read-error"
          ? { githubError: new Error("read failed") }
          : {},
      );
      const { onFailure } = await dispatch(
        host,
        execution({ preparation: { kind: "main-branch-checks" } }),
      );

      expect(onFailure).not.toHaveBeenCalled();
      expect(host.harness.sdk.callsTo("threads.spawn")[0]?.[0]).toMatchObject({
        prompt: expect.stringContaining(
          "Run local tests only; do not try to sign in or access the network.",
        ),
        pluginMetadata: expect.objectContaining({ networkAccess: false }),
      });
    },
  );
});

describe("unfinished work selection", () => {
  it("ignores recent metadata or agent activity without a person working that local day", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const host = hostForPreparation({
      candidates: [
        candidate("metadata-only"),
        candidate("agent-only"),
        candidate("previous-day"),
        candidate("worked-on"),
      ],
      events: {
        "agent-only": [request("agent")],
        "previous-day": [request("user", Date.parse("2026-05-11T06:30:00Z"))],
        "worked-on": [request("user", Date.parse("2026-05-11T23:30:00Z"))],
      },
    });
    const prepared = await prepareAutomationRun(
      host.bb.sdk,
      "project-fixture",
      execution({
        preparation: {
          kind: "unfinished-thread",
          timezone: "America/Los_Angeles",
        },
      }),
    );

    expect(prepared?.sourceThreadId).toBe("worked-on");
    expect(host.harness.sdk.callsTo("threads.events.list")).toHaveLength(4);
  });

  it("reads older pages of today's requests and ignores automatic retries", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const host = hostForPreparation({ candidates: [candidate("worked-on")] });
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      ...request("user", NOW, 200 - index),
      data: { initiator: "user", retryOfRequestId: "creq_23456789ab" },
    }));
    let page = 0;
    host.harness.sdk.stub("threads.events.list", () =>
      ++page === 1 ? firstPage : [request("user", NOW, 100)],
    );

    const prepared = await prepareAutomationRun(
      host.bb.sdk,
      "project-fixture",
      execution({
        preparation: { kind: "unfinished-thread", timezone: "UTC" },
      }),
    );

    expect(prepared?.sourceThreadId).toBe("worked-on");
    expect(
      host.harness.sdk.callsTo("threads.events.list")[1]?.[0],
    ).toMatchObject({ beforeSeq: "101" });
  });

  it("skips a night with no available human-started work", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const host = hostForPreparation({
      candidates: [
        candidate("active-thread", { status: "active" }),
        candidate("pending-approval", { hasPendingInteraction: true }),
      ],
    });
    const { db, automation, onFailure } = await dispatch(
      host,
      execution({
        preparation: { kind: "unfinished-thread", timezone: "UTC" },
      }),
    );

    expect(onFailure).not.toHaveBeenCalled();
    expect(getRunningAutomationRun(db, automation.id)).toBeNull();
    expect(host.harness.sdk.callsTo("threads.spawn")).toEqual([]);
    expect(host.harness.sdk.callsTo("threads.events.list")).toEqual([]);
  });
});
