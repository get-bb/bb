import type {
  BbPluginApi,
  PluginThreadEventPayloads,
} from "@get-bb/plugin-sdk";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import {
  notificationsHintEligibilitySchema,
  notificationsHintStateSchema,
} from "./contract.js";
import { createPushNotificationsPlugin } from "./server.js";

type ThreadEvent = Awaited<
  ReturnType<BbPluginApi["sdk"]["threads"]["events"]["list"]>
>[number];
type PendingInteraction =
  PluginThreadEventPayloads["interaction.pending"]["interaction"];

const STARTED_AT = 100_000;
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1_000;

function turnStarted(createdAt = STARTED_AT): ThreadEvent {
  return {
    id: "event-1",
    threadId: "thread-1",
    seq: 1,
    createdAt,
    type: "turn/started",
    scope: { kind: "turn", turnId: "turn-1" },
    data: { providerThreadId: "provider-thread-1" },
  };
}

function pendingQuestion(): PendingInteraction {
  return {
    id: "interaction-1",
    threadId: "thread-1",
    status: "pending",
    statusReason: null,
    createdAt: STARTED_AT,
    expiresAt: null,
    resolvedAt: null,
    turnId: "turn-1",
    providerId: "codex",
    providerThreadId: "provider-thread-1",
    providerRequestId: "request-1",
    origin: {
      kind: "provider",
      providerId: "codex",
      providerThreadId: "provider-thread-1",
      providerRequestId: "request-1",
    },
    payload: {
      kind: "user_question",
      questions: [
        {
          id: "question-1",
          prompt: "Secret question",
          multiSelect: false,
          allowFreeText: true,
        },
      ],
    },
    resolution: null,
  };
}

async function setup() {
  const interactions: PendingInteraction[] = [];
  const data = {
    now: STARTED_AT,
    thread: makeThreadResponse({ id: "thread-1", status: "active" }),
    events: [turnStarted()],
    interactions,
  };
  const record = vi.fn(async () => ({ ok: true as const }));
  const listEvents = vi.fn(async () => data.events);
  let fake = createFakePluginHost({
    pluginId: "push-notifications",
    sdk: {
      threads: {
        get: async () => data.thread,
        events: { list: listEvents },
        interactions: { list: async () => data.interactions },
      },
      system: { experimental_recordTelemetryEvent: record },
    },
  });
  const factory = createPushNotificationsPlugin({ now: () => data.now });
  await factory(fake.bb);
  async function eligible(channel: "web" | "desktop" = "web") {
    return notificationsHintEligibilitySchema.parse(
      await fake.harness.behavior.callRpc("notificationsHint.eligibility", {
        threadId: data.thread.id,
        channel,
      }),
    );
  }
  async function action(method: "shown" | "accept" | "dismiss", id: string) {
    return notificationsHintStateSchema.parse(
      await fake.harness.behavior.callRpc(`notificationsHint.${method}`, {
        id,
      }),
    );
  }
  async function suggestion() {
    data.now = STARTED_AT + 60_001;
    const result = await eligible();
    if (!result.suggestion) throw new Error("Expected an eligible Hint");
    return result.suggestion.id;
  }
  return {
    ...fake,
    get harness() {
      return fake.harness;
    },
    async reload() {
      fake = await fake.harness.lifecycle.reload(factory);
    },
    data,
    factory,
    eligible,
    action,
    suggestion,
    record,
    listEvents,
  };
}

describe("notification Hint lifecycle", () => {
  it("requires a sent thread and measures the running turn using persisted events", async () => {
    const host = await setup();
    try {
      host.data.thread.status = "pending";
      host.data.now = STARTED_AT + 100_000;
      expect(await host.eligible()).toEqual({
        suggestion: null,
        nextCheckAt: null,
      });
      expect(host.listEvents).not.toHaveBeenCalled();
      host.data.thread.status = "active";
      host.data.events = [];
      expect(await host.eligible()).toEqual({
        suggestion: null,
        nextCheckAt: null,
      });
      host.data.events = [turnStarted()];
      host.data.now = STARTED_AT + 60_000;
      expect(await host.eligible()).toEqual({
        suggestion: null,
        nextCheckAt: STARTED_AT + 60_001,
      });
      host.data.now += 1;
      const result = await host.eligible();
      expect(result.suggestion?.id).toMatch(/^[a-f0-9-]{36}$/);
      expect(host.listEvents).toHaveBeenLastCalledWith({
        threadId: "thread-1",
        types: [
          "client/thread/start",
          "client/turn/start",
          "turn/started",
          "turn/completed",
          "system/thread/interrupted",
        ],
        order: "desc",
        limit: "2",
      });
      expect(host.record).not.toHaveBeenCalled();
    } finally {
      await host.harness.lifecycle.dispose();
    }
  });

  it("does not reuse a completed turn's elapsed time or show on suppressed channels and threads", async () => {
    const host = await setup();
    try {
      host.data.now = STARTED_AT + 100_000;
      host.data.events = [
        {
          ...turnStarted(),
          type: "turn/completed",
          data: { providerThreadId: "provider-thread-1", status: "completed" },
        },
      ];
      expect((await host.eligible()).suggestion).toBeNull();
      host.data.events = [turnStarted()];
      host.data.thread.status = "idle";
      expect((await host.eligible()).suggestion).toBeNull();
      host.data.thread.status = "active";
      await host.harness.behavior.setSettings({
        webEnabled: false,
        desktopEnabled: false,
      });
      expect((await host.eligible("web")).suggestion).toBeNull();
      expect((await host.eligible("desktop")).suggestion).toBeNull();
      await host.harness.behavior.setSettings({ webEnabled: true });
      host.data.thread.archivedAt = host.data.now;
      expect((await host.eligible()).suggestion).toBeNull();
      host.data.thread.archivedAt = null;
      host.data.thread.visibility = "hidden";
      expect((await host.eligible()).suggestion).toBeNull();
    } finally {
      await host.harness.lifecycle.dispose();
    }
  });

  it("offers immediately for a pending interaction only after a turn was sent", async () => {
    const host = await setup();
    try {
      host.data.interactions = [pendingQuestion()];
      host.data.events = [];
      expect((await host.eligible()).suggestion).toBeNull();
      host.data.events = [turnStarted()];
      const first = await host.eligible();
      expect(first.suggestion).not.toBeNull();
      host.data.thread.status = "idle";
      host.data.interactions = [];
      expect(await host.eligible()).toEqual(first);
      await host.reload();
      expect(await host.eligible()).toEqual(first);
    } finally {
      await host.harness.lifecycle.dispose();
    }
  });

  it("retains a waiting trigger while a status banner hides the Hint", async () => {
    const host = await setup();
    try {
      await host.harness.behavior.emitThreadEvent("interaction.pending", {
        thread: host.data.thread,
        interaction: pendingQuestion(),
      });
      expect(host.record).not.toHaveBeenCalled();
      host.data.thread.status = "idle";
      host.data.events = [];
      await host.reload();
      expect((await host.eligible()).suggestion).not.toBeNull();
      expect(host.record).not.toHaveBeenCalled();
    } finally {
      await host.harness.lifecycle.dispose();
    }
  });

  it.each([false, true])(
    "retains a long completed turn before first display (observed=%s)",
    async (observed) => {
      const host = await setup();
      try {
        host.data.now = STARTED_AT + 70_000;
        host.data.thread.status = "idle";
        host.data.events = [
          {
            ...turnStarted(),
            seq: 2,
            createdAt: host.data.now,
            type: "turn/completed",
            data: {
              providerThreadId: "provider-thread-1",
              status: "completed",
            },
          },
          turnStarted(),
        ];
        if (observed) {
          await host.harness.behavior.emitThreadEvent("thread.idle", {
            thread: host.data.thread,
            lastAssistantText: null,
          });
          host.data.events = [];
          await host.reload();
        }
        expect((await host.eligible()).suggestion).not.toBeNull();
        expect(host.record).not.toHaveBeenCalled();
      } finally {
        await host.harness.lifecycle.dispose();
      }
    },
  );

  it("does not qualify short completions or a completion from another turn", async () => {
    const host = await setup();
    try {
      host.data.thread.status = "idle";
      const completed: ThreadEvent = {
        ...turnStarted(),
        seq: 2,
        createdAt: STARTED_AT + 60_000,
        type: "turn/completed",
        data: { providerThreadId: "provider-thread-1", status: "completed" },
      };
      host.data.events = [completed, turnStarted()];
      expect((await host.eligible()).suggestion).toBeNull();
      completed.createdAt += 1;
      completed.scope = { kind: "turn", turnId: "another-turn" };
      expect((await host.eligible()).suggestion).toBeNull();
    } finally {
      await host.harness.lifecycle.dispose();
    }
  });

  it("deduplicates shown and repeated dismissal across concurrent clients and reloads", async () => {
    const host = await setup();
    try {
      const id = await host.suggestion();
      await Promise.all([host.action("shown", id), host.action("shown", id)]);
      expect(host.record).toHaveBeenCalledExactlyOnceWith({
        name: "suggestion_shown",
        properties: {
          surface: "hint",
          kind: "notifications",
          trigger: "event",
          suggestion_analytics_id: id,
        },
      });
      await host.reload();
      await host.action("shown", id);
      const dismissed = await Promise.all([
        host.action("dismiss", id),
        host.action("dismiss", id),
      ]);
      expect(dismissed[0]).toEqual(dismissed[1]);
      expect(dismissed[0]).toMatchObject({
        dismissCount: 1,
        snoozedUntil: host.data.now + SNOOZE_MS,
        suggestion: null,
      });
      expect(host.record).toHaveBeenCalledTimes(2);
      expect(await host.eligible()).toEqual({
        suggestion: null,
        nextCheckAt: host.data.now + SNOOZE_MS,
      });
      await host.reload();
      host.data.now += SNOOZE_MS - 1;
      expect((await host.eligible()).suggestion).toBeNull();
      host.data.now += 1;
      const repeated = await host.eligible();
      const secondId = repeated.suggestion?.id;
      if (!secondId) throw new Error("Expected the Hint after the snooze");
      expect(secondId).not.toBe(id);
      await host.action("dismiss", id);
      expect((await host.eligible()).suggestion?.id).toBe(secondId);
      expect(await host.action("dismiss", secondId)).toMatchObject({
        dismissCount: 2,
        snoozedUntil: null,
        suggestion: null,
      });
      expect(host.record).toHaveBeenLastCalledWith({
        name: "suggestion_dismissed",
        properties: {
          surface: "hint",
          kind: "notifications",
          suggestion_analytics_id: secondId,
          dismiss: "never",
        },
      });
      host.data.now += SNOOZE_MS * 10;
      expect(await host.eligible()).toEqual({
        suggestion: null,
        nextCheckAt: null,
      });
    } finally {
      await host.harness.lifecycle.dispose();
    }
  });

  it("accepts once and excludes racing dismissals even if telemetry fails", async () => {
    const host = await setup();
    try {
      const id = await host.suggestion();
      host.record.mockRejectedValueOnce(new Error("Telemetry unavailable"));
      await Promise.all([
        host.action("accept", id),
        host.action("accept", id),
        host.action("dismiss", id),
      ]);
      expect(host.record).toHaveBeenCalledExactlyOnceWith({
        name: "suggestion_accepted",
        properties: {
          surface: "hint",
          kind: "notifications",
          suggestion_analytics_id: id,
        },
      });
      expect((await host.eligible()).suggestion).toBeNull();
      const state = await host.harness.behavior.runCli(["hint", "--json"]);
      expect(JSON.parse(state.stdout)).toMatchObject({
        accepted: true,
        dismissCount: 0,
        suggestion: null,
      });
      await host.reload();
      expect((await host.eligible()).suggestion).toBeNull();
    } finally {
      await host.harness.lifecycle.dispose();
    }
  });

  it("shares read/reset through CLI and RPC and rejects text or unknown identifiers at the RPC boundary", async () => {
    const host = await setup();
    try {
      const id = await host.suggestion();
      await host.action("dismiss", id);
      const cliState = await host.harness.behavior.runCli(["hint", "--json"]);
      expect(JSON.parse(cliState.stdout)).toEqual(
        await host.harness.behavior.callRpc("notificationsHint.state", {}),
      );
      const reset = await host.harness.behavior.runCli([
        "hint",
        "--reset",
        "--json",
      ]);
      expect(JSON.parse(reset.stdout)).toEqual({
        dismissCount: 0,
        snoozedUntil: null,
        accepted: false,
        suggestion: null,
      });
      expect(await host.action("accept", id)).toEqual(JSON.parse(reset.stdout));
      const newId = await host.suggestion();
      expect(newId).not.toBe(id);
      await host.action("accept", newId);
      expect(
        await host.harness.behavior.callRpc("notificationsHint.reset", {}),
      ).toEqual(JSON.parse(reset.stdout));
      await expect(
        host.harness.behavior.callRpc("notificationsHint.shown", {
          id: "thread-1",
        }),
      ).rejects.toMatchObject({ code: "invalid_input" });
      await expect(
        host.harness.behavior.callRpc("notificationsHint.shown", {
          id,
          title: "Secret title",
        }),
      ).rejects.toMatchObject({ code: "invalid_input" });
    } finally {
      await host.harness.lifecycle.dispose();
    }
  });
});
