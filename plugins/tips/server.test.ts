import {
  createFakePluginHost,
  makeQueueEntry,
  makeThreadResponse,
  makeTurnFailedEvent,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  tipListEntrySchema,
  tipViewSchema,
  type TipClient,
} from "./contract.js";
import plugin from "./server.js";

const WEB_MAC: TipClient = { surface: "web", os: "macos" };

const setResultSchema = z.object({ tips: z.array(tipViewSchema) });
const listResultSchema = z.object({
  enabled: z.boolean(),
  hiddenToday: z.boolean(),
  tips: z.array(tipListEntrySchema),
});

const DAY_MS = 86_400_000;

function listEntry(createdAt: number) {
  return {
    ...makeThreadResponse({ createdAt }),
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 0,
      activeGoalCount: 0,
    },
    queuedWork: "none" as const,
    pinSortKey: null,
    hasPendingInteraction: false,
    environmentHostId: null,
    environmentName: null,
    environmentBranchName: null,
    environmentPath: null,
    environmentProviderId: null,
    environmentIsWorktree: null,
    environmentWorkspaceDisplayKind: "other" as const,
  };
}

interface Fixture {
  version?: string;
  threadAges?: number[];
  threadCount?: number;
  finishedThreadCount?: number;
  plugins?: Record<string, boolean>;
  settings?: Record<string, boolean>;
}

async function setup(fixture: Fixture = {}) {
  const fake = createFakePluginHost({
    pluginId: "bb--tips",
    ...(fixture.settings === undefined ? {} : { settings: fixture.settings }),
    sdk: {
      system: {
        version: async () => ({ currentVersion: fixture.version ?? "1.0.0" }),
      },
      threads: {
        count: async (args) => {
          return {
            total:
              args?.status === "idle"
                ? (fixture.finishedThreadCount ?? 0)
                : (fixture.threadCount ?? 0),
          };
        },
        list: async (args) =>
          args?.hasParent === true ||
          args?.originPluginId !== undefined ||
          args?.projectId !== undefined
            ? []
            : (fixture.threadAges ?? []).map((age) =>
                listEntry(Date.now() - age * DAY_MS),
              ),
      },
      providers: { catalog: async () => [] },
      plugins: {
        list: async () => ({
          plugins: Object.entries(fixture.plugins ?? {}).map(
            ([id, enabled]) => ({ id, enabled }),
          ),
        }),
      },
    },
  });
  await plugin(fake.bb);
  const { harness } = fake;
  return {
    ...fake,
    async current(projectId: string | null = null, visit = true) {
      return setResultSchema
        .parse(
          await harness.behavior.callRpc("current", {
            client: WEB_MAC,
            projectId,
            visit,
          }),
        )
        .tips.map((tip) => tip.id);
    },
    async listAll() {
      return listResultSchema.parse(
        await harness.behavior.callRpc("list", { client: WEB_MAC, all: true }),
      );
    },
  };
}

const NEW_USER = { threadCount: 1, finishedThreadCount: 1 };
const REGULAR = { threadCount: 10, finishedThreadCount: 3 };
const NEW_USER_SET = ["child-threads", "phone", "build-plugin"];

describe("tips plugin registration", () => {
  it("declares a Show tips switch and the bb tips command", async () => {
    const { harness } = await setup();
    expect(harness.registrations.settingsDescriptors.enabled).toMatchObject({
      type: "boolean",
    });
    expect(
      harness.registrations.settingsDescriptors.enabled,
    ).not.toHaveProperty("default");
    expect(harness.registrations.cli?.name).toBe("tips");
    expect(
      harness.registrations.cli?.commands.map((command) => command.name),
    ).toEqual(expect.arrayContaining(["list", "hide", "dismiss", "reset"]));
    expect(harness.registrations.rpcMethods).toEqual(
      expect.arrayContaining([
        "current",
        "hide",
        "setEnabled",
        "dismiss",
        "act",
        "list",
        "reset",
      ]),
    );
  });
});

describe("current tips", () => {
  it("shows nothing before the first finished thread", async () => {
    const host = await setup();
    expect(await host.current()).toEqual([]);
  });

  it("shows three tips after the first finished thread and keeps them through the visit", async () => {
    const host = await setup(NEW_USER);
    expect(await host.current()).toEqual(NEW_USER_SET);
    expect(await host.current()).toEqual(NEW_USER_SET);
    const list = await host.listAll();
    for (const id of NEW_USER_SET) {
      expect(list.tips.find((entry) => entry.id === id)).toMatchObject({
        status: "in-feed",
        shownCount: 1,
      });
    }
  });

  it("brings Account Pooler in ahead of other unranked tips after a rate limit", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.UTC(2026, 9, 5, 12));
      const host = await setup({
        ...NEW_USER,
        plugins: { "account-pool": false },
      });
      await host.harness.behavior.emitThreadEvent(
        "turn.failed",
        makeTurnFailedEvent({
          errorInfo: {
            category: "rate-limit",
            providerCode: null,
            httpStatusCode: 429,
          },
        }),
      );
      expect(await host.current()).toEqual(NEW_USER_SET);
      vi.setSystemTime(Date.UTC(2026, 9, 5, 12, 11));
      expect((await host.current())[0]).toBe("account-pool");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores turn failures that are not rate limits", async () => {
    const host = await setup({
      ...NEW_USER,
      plugins: { "account-pool": false },
    });
    await host.harness.behavior.emitThreadEvent(
      "turn.failed",
      makeTurnFailedEvent(),
    );
    expect(await host.current()).toEqual(NEW_USER_SET);
  });

  it("offers child threads only in projects that have none yet", async () => {
    const childThreadCreated = {
      thread: makeThreadResponse({ parentThreadId: "thread-parent" }),
    };
    const fresh = await setup(NEW_USER);
    await fresh.harness.behavior.emitThreadEvent(
      "thread.created",
      childThreadCreated,
    );
    expect(await fresh.current("proj_new")).toContain("child-threads");
    const host = await setup(NEW_USER);
    await host.harness.behavior.emitThreadEvent(
      "thread.created",
      childThreadCreated,
    );
    expect(await host.current()).not.toContain("child-threads");
    const list = await host.listAll();
    expect(
      list.tips.find((entry) => entry.id === "child-threads")?.status,
    ).toBe("not-applicable");
  });

  it("retires queue-or-steer once a follow-up is queued behind a running turn", async () => {
    const host = await setup(REGULAR);
    await host.harness.behavior.emitThreadEvent("message.queued", {
      entry: makeQueueEntry({ waitingOn: null }),
    });
    const list = await host.listAll();
    expect(
      list.tips.find((entry) => entry.id === "queue-or-steer"),
    ).toMatchObject({ status: "retired", retiredReason: "used" });
  });

  it("does not count a plugin-held or scheduled row as a queued follow-up", async () => {
    const host = await setup(REGULAR);
    await host.harness.behavior.emitThreadEvent("message.queued", {
      entry: makeQueueEntry(),
    });
    await host.harness.behavior.emitThreadEvent("message.queued", {
      entry: makeQueueEntry({ waitingOn: null, sendAt: 1 }),
    });
    const list = await host.listAll();
    expect(
      list.tips.find((entry) => entry.id === "queue-or-steer")?.status,
    ).not.toBe("retired");
  });

  it("stays hidden and records nothing while tips are turned off", async () => {
    const host = await setup({ ...NEW_USER, settings: { enabled: false } });
    expect(await host.current()).toEqual([]);
    expect(await host.bb.storage.kv.get("state")).toBeUndefined();
  });
});

describe("default for new and existing users", () => {
  it("turns tips on for a new install and records that choice in the setting", async () => {
    const host = await setup({ ...NEW_USER, threadAges: [2] });
    expect(await host.current()).toEqual(NEW_USER_SET);
    expect((await host.listAll()).enabled).toBe(true);
  });

  it("keeps tips off for an existing install and says how to turn them on", async () => {
    const host = await setup({ ...NEW_USER, threadAges: [40, 3] });
    expect(await host.current()).toEqual([]);
    expect((await host.listAll()).enabled).toBe(false);
    const result = await host.harness.behavior.runCli([]);
    expect(result.stdout).toContain("Tips are off.");
    expect(result.stdout).toContain(
      "bb plugin config bb--tips set enabled true",
    );
  });

  it("lets an explicit setting win over the classification", async () => {
    const host = await setup({
      ...NEW_USER,
      threadAges: [40],
      settings: { enabled: true },
    });
    expect(await host.current()).toEqual(NEW_USER_SET);
  });

  it("decides once and does not flip when threads later age past the window", async () => {
    const fixture: Fixture = { ...NEW_USER, threadAges: [1] };
    const host = await setup(fixture);
    expect(await host.current()).toEqual(NEW_USER_SET);
    await host.harness.behavior.setSettings({ enabled: null });
    fixture.threadAges = [90];
    expect(await host.current()).toEqual(NEW_USER_SET);
    expect((await host.listAll()).enabled).toBe(true);
  });
});

describe("hiding and turning off", () => {
  it("hides tips for today and brings them back on undo", async () => {
    const host = await setup(NEW_USER);
    await host.current();
    await host.harness.behavior.callRpc("hide", { hidden: true });
    expect(await host.current()).toEqual([]);
    expect((await host.listAll()).hiddenToday).toBe(true);
    await host.harness.behavior.callRpc("hide", { hidden: false });
    expect(await host.current()).toEqual(NEW_USER_SET);
  });

  it("turns tips off and on through the Show tips setting", async () => {
    const host = await setup(NEW_USER);
    await host.harness.behavior.callRpc("setEnabled", { enabled: false });
    expect(await host.current()).toEqual([]);
    expect((await host.listAll()).enabled).toBe(false);
    await host.harness.behavior.callRpc("setEnabled", { enabled: true });
    expect(await host.current()).toEqual(NEW_USER_SET);
  });
});

describe("dismissing and acting", () => {
  it("dismisses a tip for good and adds another at the top", async () => {
    const host = await setup(NEW_USER);
    expect(await host.current()).toEqual(NEW_USER_SET);
    await host.harness.behavior.callRpc("dismiss", { id: "child-threads" });
    const refilled = await host.current();
    expect(refilled).toHaveLength(3);
    expect(refilled).not.toContain("child-threads");
    expect(refilled).toEqual(["set-up-for-me", "phone", "build-plugin"]);
    expect(host.harness.realtimeSignals).toContainEqual({
      channel: "tips-changed",
      payload: {},
    });
    const list = await host.listAll();
    expect(
      list.tips.find((entry) => entry.id === "child-threads"),
    ).toMatchObject({
      status: "dismissed",
      dismissed: true,
    });
  });

  it("keeps a clicked tip through the visit and replaces it on the next one", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.UTC(2026, 9, 5, 12));
      const host = await setup(NEW_USER);
      expect(await host.current()).toEqual(NEW_USER_SET);
      await host.harness.behavior.callRpc("act", { id: "child-threads" });
      expect(await host.current(null, false)).toEqual(NEW_USER_SET);
      const list = await host.listAll();
      expect(
        list.tips.find((entry) => entry.id === "child-threads"),
      ).toMatchObject({ status: "in-feed", acted: true, retiredReason: null });
      vi.setSystemTime(Date.UTC(2026, 9, 5, 12, 11));
      const next = await host.current();
      expect(next).toHaveLength(3);
      expect(next).not.toContain("child-threads");
      expect(next).toEqual(["set-up-for-me", "phone", "build-plugin"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("inserts one new tip at the top on a later visit", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.UTC(2026, 9, 5, 12));
      const host = await setup(NEW_USER);
      expect(await host.current()).toEqual(NEW_USER_SET);
      vi.setSystemTime(Date.UTC(2026, 9, 5, 12, 5));
      expect(await host.current()).toEqual(NEW_USER_SET);
      vi.setSystemTime(Date.UTC(2026, 9, 5, 12, 20));
      const next = await host.current();
      expect(next).toEqual(["set-up-for-me", "child-threads", "phone"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects an unknown tip id over RPC", async () => {
    const host = await setup(NEW_USER);
    await expect(
      host.harness.behavior.callRpc("dismiss", { id: "nope" }),
    ).rejects.toThrow("Unknown tip: nope");
  });
});

describe("bb tips", () => {
  it("lists eligible tips and marks the three in the feed", async () => {
    const host = await setup(NEW_USER);
    await host.current();
    const result = await host.harness.behavior.runCli([]);
    expect(result.exitCode).toBe(0);
    for (const id of NEW_USER_SET) {
      expect(result.stdout).toContain(`${id} (in the feed)`);
    }
    expect(result.stdout).toContain("set-up-for-me\n");
    expect(result.stdout).not.toContain("account-pool");
  });

  it("prints JSON with every tip and its status when asked", async () => {
    const host = await setup(NEW_USER);
    const result = await host.harness.behavior.runCli(["--all", "--json"]);
    expect(result.exitCode).toBe(0);
    const view = listResultSchema.parse(JSON.parse(result.stdout));
    expect(view.enabled).toBe(true);
    expect(view.hiddenToday).toBe(false);
    expect(view.tips.find((entry) => entry.id === "account-pool")?.status).toBe(
      "not-applicable",
    );
    expect(
      view.tips.find((entry) => entry.id === "child-threads")?.status,
    ).toBe("eligible");
  });

  it("hides tips for today and undoes it", async () => {
    const host = await setup(NEW_USER);
    const hidden = await host.harness.behavior.runCli(["hide"]);
    expect(hidden).toMatchObject({
      exitCode: 0,
      stdout: "Tips hidden for today.",
    });
    expect(await host.current()).toEqual([]);
    expect((await host.harness.behavior.runCli([])).stdout).toContain(
      "Tips are hidden for today.",
    );
    const shown = await host.harness.behavior.runCli(["hide", "--undo"]);
    expect(shown.stdout).toBe("Tips are showing again.");
    expect(await host.current()).toEqual(NEW_USER_SET);
  });

  it("dismisses a tip by id and refuses unknown ids", async () => {
    const host = await setup(NEW_USER);
    const dismissed = await host.harness.behavior.runCli([
      "dismiss",
      "child-threads",
    ]);
    expect(dismissed).toMatchObject({
      exitCode: 0,
      stdout: "Dismissed child-threads.",
    });
    expect((await host.harness.behavior.runCli(["list"])).stdout).not.toContain(
      "child-threads",
    );
    const unknown = await host.harness.behavior.runCli(["dismiss", "nope"]);
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toContain("Unknown tip: nope");
  });

  it("resets dismissed tips so they can show again", async () => {
    const host = await setup(NEW_USER);
    await host.current();
    await host.harness.behavior.runCli(["dismiss", "child-threads"]);
    expect(await host.current()).not.toContain("child-threads");
    const reset = await host.harness.behavior.runCli(["reset"]);
    expect(reset).toMatchObject({ exitCode: 0, stdout: "Tips reset." });
    expect(await host.current()).toEqual(NEW_USER_SET);
  });

  it("says when tips are turned off", async () => {
    const host = await setup({ ...NEW_USER, settings: { enabled: false } });
    const result = await host.harness.behavior.runCli([]);
    expect(result.stdout).toContain("Tips are off.");
  });
});
