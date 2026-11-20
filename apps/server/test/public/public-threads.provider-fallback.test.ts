import {
  getAppSettings,
  getProjectExecutionDefaults,
  setAppSettings,
} from "@bb/db";
import { threadSchema } from "@bb/domain";
import type { ProviderUsage } from "@bb/host-daemon-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { availableModelFixture } from "../helpers/available-models.js";
import { waitForQueuedCommand } from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import { seedModelCatalog } from "../helpers/provider-model-catalogs.js";
import {
  seedEnvironment,
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const usageMock = vi.hoisted(() => {
  const state: { usageByProvider: Record<string, unknown>; calls: number } = {
    usageByProvider: {},
    calls: 0,
  };
  return state;
});

vi.mock("../../src/services/system/usage-limits.js", () => ({
  getProviderUsageLimits: async (
    _deps: unknown,
    query: { providerId?: string },
  ) => {
    usageMock.calls += 1;
    const providerId = query.providerId ?? "";
    const result = usageMock.usageByProvider[providerId];
    if (result instanceof Error) throw result;
    return result === undefined ? {} : { [providerId]: result };
  },
}));

beforeEach(() => {
  usageMock.usageByProvider = {};
  usageMock.calls = 0;
});

const RESETS_LATER = new Date(Date.now() + 3 * 60 * 60_000).toISOString();

function usage(
  windows: Array<{ label: string; usedPercent: number; model?: string }>,
): ProviderUsage {
  return {
    status: "ok",
    accountEmail: null,
    planLabel: null,
    windows: windows.map((window) => ({ ...window, resetsAt: RESETS_LATER })),
  };
}

const CLAUDE_OUT = usage([{ label: "Weekly limit", usedPercent: 100 }]);
const CODEX_OK = usage([{ label: "Weekly limit", usedPercent: 20 }]);

interface FallbackSetup {
  fallbackProviderId?: string | null;
  usageByProvider: Record<string, ProviderUsage | Error>;
}

async function setUp(harness: TestAppHarness, setup: FallbackSetup) {
  const { host } = seedHostSession(harness.deps, {
    id: "host-fallback",
  });
  seedPrimaryHost(harness.deps, host.id);
  await seedModelCatalog(harness, {
    hostId: host.id,
    providerId: "claude-code",
    models: [
      availableModelFixture({ model: "claude-opus-5-5", isDefault: true }),
      availableModelFixture({ model: "claude-fable-5-2" }),
    ],
  });
  await seedModelCatalog(harness, {
    hostId: host.id,
    providerId: "codex",
    models: [availableModelFixture({ model: "gpt-6.1-sol", isDefault: true })],
  });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: "/tmp/provider-fallback",
  });
  seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: "/tmp/provider-fallback",
  });
  setAppSettings(harness.db, {
    ...getAppSettings(harness.db),
    defaultProviderId: "claude-code",
    fallbackProviderId:
      setup.fallbackProviderId === undefined
        ? "codex"
        : setup.fallbackProviderId,
  });
  usageMock.usageByProvider = setup.usageByProvider;
  const create = async (body: Record<string, unknown> = {}) => {
    const response = await harness.app.request("/api/v1/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        origin: "app",
        projectId: project.id,
        input: [{ type: "text", text: "Fix the flaky test" }],
        environment: {
          type: "host",
          hostId: host.id,
          workspace: { type: "unmanaged", path: null },
        },
        ...body,
      }),
    });
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(
      201,
    );
    const thread = threadSchema.parse(await readJson(response));
    const start = await waitForQueuedCommand(
      harness,
      ({ command }) =>
        command.type === "thread.start" && command.threadId === thread.id,
    );
    return { thread, start: start.command };
  };
  const usageCalls = () => usageMock.calls;
  return { project, create, usageCalls };
}

describe("provider fallback for new threads", () => {
  it("starts a default thread on the fallback when the default is out of usage", async () => {
    await withTestHarness(async (harness) => {
      const { project, create } = await setUp(harness, {
        usageByProvider: { "claude-code": CLAUDE_OUT, codex: CODEX_OK },
      });
      const { thread, start } = await create();
      expect(thread.providerId).toBe("codex");
      expect(start).toMatchObject({ options: { model: "gpt-6.1-sol" } });
      expect(
        getProjectExecutionDefaults(harness.db, { projectId: project.id }),
      ).toBeNull();
    });
  });

  it("replaces a remembered client choice and drops its model", async () => {
    await withTestHarness(async (harness) => {
      const { create } = await setUp(harness, {
        usageByProvider: { "claude-code": CLAUDE_OUT, codex: CODEX_OK },
      });
      const { thread, start } = await create({
        providerId: "claude-code",
        model: "claude-opus-5-5",
        executionInputSources: {
          providerId: "client-preference",
          model: "client-preference",
        },
      });
      expect(thread.providerId).toBe("codex");
      expect(start).toMatchObject({ options: { model: "gpt-6.1-sol" } });
    });
  });

  it.each([
    ["an explicit provider", { providerId: "claude-code" }],
    [
      "an explicit model",
      {
        providerId: "claude-code",
        model: "claude-opus-5-5",
        executionInputSources: {
          providerId: "client-preference",
          model: "explicit",
        },
      },
    ],
  ])("keeps %s", async (_, body) => {
    await withTestHarness(async (harness) => {
      const { create } = await setUp(harness, {
        usageByProvider: { "claude-code": CLAUDE_OUT, codex: CODEX_OK },
      });
      expect((await create(body)).thread.providerId).toBe("claude-code");
    });
  });

  it.each<[string, Record<string, ProviderUsage | Error>]>([
    [
      "the fallback is out of usage too",
      { "claude-code": CLAUDE_OUT, codex: CLAUDE_OUT },
    ],
    [
      "only another model's window is full",
      {
        "claude-code": usage([
          { label: "Fable", model: "fable", usedPercent: 100 },
          { label: "Weekly limit", usedPercent: 50 },
        ]),
        codex: CODEX_OK,
      },
    ],
    [
      "the usage read fails",
      { "claude-code": new Error("bridge crashed"), codex: CODEX_OK },
    ],
  ])("stays on the default when %s", async (_, usageByProvider) => {
    await withTestHarness(async (harness) => {
      const { create } = await setUp(harness, { usageByProvider });
      expect((await create()).thread.providerId).toBe("claude-code");
    });
  });

  it("falls back when the full window is for the thread's model", async () => {
    await withTestHarness(async (harness) => {
      const { create } = await setUp(harness, {
        usageByProvider: {
          "claude-code": usage([
            { label: "Fable", model: "fable", usedPercent: 100 },
          ]),
          codex: CODEX_OK,
        },
      });
      const { thread } = await create({
        providerId: "claude-code",
        model: "claude-fable-5-2",
        executionInputSources: {
          providerId: "client-preference",
          model: "client-preference",
        },
      });
      expect(thread.providerId).toBe("codex");
    });
  });

  it("reads no usage when no fallback is set", async () => {
    await withTestHarness(async (harness) => {
      const { create, usageCalls } = await setUp(harness, {
        fallbackProviderId: null,
        usageByProvider: { "claude-code": CLAUDE_OUT },
      });
      expect((await create()).thread.providerId).toBe("claude-code");
      expect(usageCalls()).toBe(0);
    });
  });
});
