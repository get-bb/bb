import type { PluginThreadEventPayloads } from "@get-bb/plugin-sdk";
import {
  createFakePluginHost,
  makePluginAgentConfigurationContext,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { EnvHttpProxyAgent } from "undici";
import { describe, expect, it, vi } from "vitest";
import {
  CLIENT_NOTIFICATION_CHANNEL,
  listPushSubscriptionsOutputSchema,
} from "./contract.js";
import {
  parseStoredNotificationLevel,
  type NotificationLevel,
} from "./preferences.js";
import { createPushNotificationsPlugin } from "./server.js";
import type { ExpoPushMessage, PushSenderFetch } from "./sender.js";

type ThreadResponse = PluginThreadEventPayloads["thread.idle"]["thread"];
type PendingInteraction =
  PluginThreadEventPayloads["interaction.pending"]["interaction"];

const COALESCE_MS = 10;
const EXPO_URL = "http://expo.test/push";

interface FakeExpo {
  fetch: PushSenderFetch;
  requests: ExpoPushMessage[][];
  ticketErrors: Map<string, string>;
  urls: string[];
}

function createFakeExpo(): FakeExpo {
  const requests: ExpoPushMessage[][] = [];
  const ticketErrors = new Map<string, string>();
  const urls: string[] = [];
  const fetch: PushSenderFetch = async (url, init) => {
    urls.push(url);
    expect(init.dispatcher).toBeInstanceOf(EnvHttpProxyAgent);
    const messages = JSON.parse(init.body) as ExpoPushMessage[];
    requests.push(messages);
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          data: messages.map((message) => {
            const error = ticketErrors.get(message.to);
            return error === undefined
              ? { status: "ok", id: `ticket-${message.to}` }
              : { status: "error", details: { error } };
          }),
        }),
    };
  };
  return { fetch, requests, ticketErrors, urls };
}

function pendingQuestion(threadId: string, prompt: string): PendingInteraction {
  return {
    id: `interaction-${threadId}`,
    threadId,
    status: "pending",
    statusReason: null,
    createdAt: 1,
    expiresAt: null,
    resolvedAt: null,
    turnId: `turn-${threadId}`,
    providerId: "codex",
    providerThreadId: `provider-${threadId}`,
    providerRequestId: `request-${threadId}`,
    origin: {
      kind: "provider",
      providerId: "codex",
      providerThreadId: `provider-${threadId}`,
      providerRequestId: `request-${threadId}`,
    },
    payload: {
      kind: "user_question",
      questions: [
        {
          id: "question-1",
          prompt,
          multiSelect: false,
          allowFreeText: true,
        },
      ],
    },
    resolution: null,
  };
}

interface SetupOptions {
  appUrl?: string | null;
  expo?: FakeExpo;
  fetch?: PushSenderFetch;
  now?: () => number;
  onThreadGet?: (threadId: string) => void | Promise<void>;
}

async function setup(options: SetupOptions = {}) {
  const expo = options.expo ?? createFakeExpo();
  const threads = new Map<string, ThreadResponse>();
  const interactions = new Map<string, PendingInteraction[]>();
  const metadata = new Map<string, Record<string, unknown>>();
  let nextId = 1;
  const listAncestors = vi.fn(
    async ({ threadIds }: { threadIds: readonly string[] }) => ({
      threads: [...new Set(threadIds)].flatMap((threadId) => {
        if (!threads.has(threadId)) return [];
        const ancestorIds: string[] = [];
        let parentId = threads.get(threadId)?.parentThreadId ?? null;
        while (parentId !== null && threads.has(parentId)) {
          ancestorIds.push(parentId);
          parentId = threads.get(parentId)?.parentThreadId ?? null;
        }
        return [{ threadId, ancestorIds }];
      }),
    }),
  );
  const fake = createFakePluginHost({
    pluginId: "push-notifications",
    experimental_declaredIconNames: ["ringing", "off"],
    ...(options.appUrl === undefined ? {} : { appUrl: options.appUrl }),
    settings: { expoPushUrl: EXPO_URL },
    sdk: {
      threads: {
        get: async ({ threadId }) => {
          const thread = threads.get(threadId);
          if (!thread) throw new Error("Thread not found");
          await options.onThreadGet?.(threadId);
          return thread;
        },
        experimental_listAncestors: listAncestors,
        experimental_listDescendants: async ({
          threadIds,
          includeArchived = false,
          includeHidden = false,
        }) => ({
          threads: [...new Set(threadIds)].flatMap((threadId) => {
            if (!threads.has(threadId)) return [];
            const walked: ThreadResponse[] = [];
            for (let index = -1; index < walked.length; index += 1) {
              const parentId = index < 0 ? threadId : walked[index]?.id;
              for (const thread of threads.values()) {
                if (thread.parentThreadId === parentId) walked.push(thread);
              }
            }
            const descendantIds = walked
              .filter(
                (thread) =>
                  (includeArchived || thread.archivedAt === null) &&
                  (includeHidden || thread.visibility === "visible"),
              )
              .map((thread) => thread.id);
            return [{ threadId, descendantIds }];
          }),
        }),
        getPluginMetadata: async ({ threadId }) => {
          if (!threads.has(threadId)) throw new Error("Thread not found");
          return metadata.get(threadId) ?? {};
        },
        updatePluginMetadata: async ({ threadId, set, remove }) => {
          if (!threads.has(threadId)) throw new Error("Thread not found");
          const next = { ...(metadata.get(threadId) ?? {}), ...set };
          for (const key of remove ?? []) delete next[key];
          if (Object.keys(next).length === 0) metadata.delete(threadId);
          else metadata.set(threadId, next);
          return next;
        },
        experimental_listPluginMetadata: async ({ threadIds }) => ({
          threads: threadIds.flatMap((threadId) => {
            const value = metadata.get(threadId);
            return value === undefined ? [] : [{ threadId, metadata: value }];
          }),
        }),
        interactions: {
          list: async ({ threadId }) => interactions.get(threadId) ?? [],
        },
      },
    },
  });
  await createPushNotificationsPlugin({
    coalesceMs: COALESCE_MS,
    createId: () => `subscription-${nextId++}`,
    fetch: options.fetch ?? expo.fetch,
    ...(options.now === undefined ? {} : { now: options.now }),
  })(fake.bb);

  async function addSubscription(
    expoPushToken = "ExponentPushToken[phone]",
    deviceLabel = "Phone",
  ) {
    return fake.harness.behavior.callRpc("pushSubscriptions.add", {
      expoPushToken,
      platform: "ios",
      deviceLabel,
    });
  }

  function setThread(overrides: Partial<ThreadResponse> = {}) {
    const thread = makeThreadResponse({
      id: `thread-${threads.size + 1}`,
      projectId: "project-1",
      status: "idle",
      title: "Fix the flaky test",
      latestAttentionAt: 100,
      ...overrides,
    });
    threads.set(thread.id, thread);
    return thread;
  }

  const service = fake.harness.behavior.runService("push-sender");

  async function cleanup() {
    service.controller.abort();
    await service.done;
    await fake.harness.lifecycle.dispose();
  }

  function storedLevel(threadId: string): NotificationLevel | null {
    return parseStoredNotificationLevel(metadata.get(threadId) ?? {});
  }

  function moveThread(threadId: string, parentThreadId: string | null) {
    const thread = threads.get(threadId);
    if (!thread) throw new Error("Thread not found");
    threads.set(threadId, { ...thread, parentThreadId });
  }

  async function setLevel(threadId: string, level: string) {
    return fake.harness.behavior.callRpc("threadNotifications.set", {
      threadId,
      level,
    });
  }

  async function getLevel(threadId: string) {
    const result = await fake.harness.behavior.runCli([
      "thread",
      threadId,
      "--json",
    ]);
    const { threadId: _threadId, ...row } = JSON.parse(result.stdout);
    if (result.exitCode !== 0) throw new Error(row.error.message);
    return row;
  }

  async function listLevels(threadIds: readonly string[]) {
    return fake.harness.behavior.callRpc("threadNotifications.list", {
      threadIds,
    });
  }

  function signals(channel: string) {
    return fake.harness.realtimeSignals.filter(
      (signal) => signal.channel === channel,
    );
  }

  return {
    ...fake,
    addSubscription,
    cleanup,
    service,
    clientSignals: () => signals(CLIENT_NOTIFICATION_CHANNEL),
    expo,
    getLevel,
    interactions,
    listAncestors,
    listLevels,
    setLevel,
    setThread,
    storedLevel,
    moveThread,
    threads,
  };
}

async function waitForCoalesce(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, COALESCE_MS * 4));
}

describe("push subscription RPC and CLI", () => {
  it("upserts by token, redacts lists, and reports stable RPC errors", async () => {
    const host = await setup();
    try {
      await expect(host.addSubscription()).resolves.toEqual({
        id: "subscription-1",
        created: true,
      });
      await expect(
        host.addSubscription("ExponentPushToken[phone]", "New phone name"),
      ).resolves.toEqual({ id: "subscription-1", created: false });

      const listed = await host.harness.behavior.callRpc(
        "pushSubscriptions.list",
        {},
      );
      expect(listed).toEqual({
        subscriptions: [
          expect.objectContaining({
            id: "subscription-1",
            deviceLabel: "New phone name",
            tokenSuffix: "phone]",
          }),
        ],
      });
      expect(JSON.stringify(listed)).not.toContain("ExponentPushToken");

      await expect(
        host.harness.behavior.callRpc("pushSubscriptions.add", {
          expoPushToken: "token",
          platform: "windows",
          deviceLabel: "PC",
        }),
      ).rejects.toMatchObject({ code: "invalid_input" });
      await expect(
        host.harness.behavior.callRpc("pushSubscriptions.remove", {
          id: "missing",
        }),
      ).rejects.toMatchObject({
        code: "handler_error",
        message: "Push subscription not found: missing",
      });
      await expect(
        host.harness.behavior.callRpc("pushSubscriptions.remove", {
          id: "subscription-1",
        }),
      ).resolves.toEqual({ ok: true });
    } finally {
      await host.cleanup();
    }
  });

  it("provides list, add, remove, and status commands", async () => {
    const host = await setup();
    try {
      await expect(
        host.harness.behavior.runCli([
          "add",
          "--platform",
          "ios",
          "--label",
          "Phone",
          "--token",
          "ExponentPushToken[phone]",
        ]),
      ).resolves.toMatchObject({
        exitCode: 0,
        stdout: "Registered push device subscription-1",
      });
      const list = await host.harness.behavior.runCli(["list", "--json"]);
      expect(JSON.parse(list.stdout)).toEqual({
        subscriptions: [
          expect.objectContaining({
            id: "subscription-1",
            tokenSuffix: "phone]",
          }),
        ],
      });
      expect(list.stdout).not.toContain("ExponentPushToken");
      const status = await host.harness.behavior.runCli(["status", "--json"]);
      expect(JSON.parse(status.stdout)).toEqual({
        enabled: true,
        mobileEnabled: true,
        webEnabled: true,
        desktopEnabled: true,
        defaultLevel: "all",
        childLevel: "input-only",
        agentNotifications: true,
        agentNotifyCooldownMinutes: "5",
        subscriptionCount: 1,
        relayUrl: EXPO_URL,
        lastSendOutcome: { status: "never" },
      });
      await expect(
        host.harness.behavior.runCli(["remove", "subscription-1"]),
      ).resolves.toMatchObject({
        exitCode: 0,
        stdout: "Removed push device subscription-1",
      });
    } finally {
      await host.cleanup();
    }
  });

  it("documents limits in help, validates options, and reports errors as JSON", async () => {
    const host = await setup();
    try {
      const help = (await host.harness.behavior.runCli(["add", "--help"]))
        .stdout;
      expect(help).toContain("bb push-notifications add");
      expect(help).toContain("at most 512 characters");

      const badPlatform = await host.harness.behavior.runCli([
        "add",
        "--token",
        "ExponentPushToken[watch]",
        "--platform",
        "watchos",
        "--label",
        "Watch",
      ]);
      expect(badPlatform.exitCode).toBe(1);
      expect(badPlatform.stderr).toContain(
        "invalid value 'watchos' for --platform. Expected one of: ios, android",
      );

      const guessed = await host.harness.behavior.runCli([
        "add",
        "--expo-token",
        "ExponentPushToken[tablet]",
        "--os",
        "android",
        "--device",
        "Tablet",
        "--json",
      ]);
      expect(guessed.exitCode, guessed.stderr).toBe(0);
      expect(JSON.parse(guessed.stdout)).toEqual({
        id: "subscription-1",
        created: true,
      });

      const envelope = await host.harness.behavior.runCli([
        "remove",
        "missing",
        "--json",
      ]);
      expect(envelope.exitCode).toBe(1);
      expect(JSON.parse(envelope.stdout)).toMatchObject({
        ok: false,
        error: {
          code: "subscription_not_found",
          message: "Push subscription not found: missing",
        },
      });
      expect(envelope.stderr).toContain("Push subscription not found: missing");

      const badChannel = await host.harness.behavior.runCli(["test", "sms"]);
      expect(badChannel.exitCode).toBe(1);
      expect(badChannel.stderr).toContain("Use web or desktop");
    } finally {
      await host.cleanup();
    }
  });
});

describe("push sender", () => {
  it("sends a root idle preview to each device and reads the relay setting at flush", async () => {
    const host = await setup();
    try {
      await host.addSubscription();
      await host.addSubscription("ExponentPushToken[tablet]", "Tablet");
      const thread = host.setThread();

      await host.harness.behavior.emitThreadEvent("thread.idle", {
        thread,
        lastAssistantText: "Done: the timer race is fixed.\nMore details.",
      });
      await host.harness.behavior.setSettings({
        expoPushUrl: "http://expo.test/changed",
      });

      await vi.waitFor(() => expect(host.expo.requests).toHaveLength(1));
      expect(host.expo.urls).toEqual(["http://expo.test/changed"]);
      expect(host.expo.requests[0]).toHaveLength(2);
      expect(host.expo.requests[0]?.[0]).toMatchObject({
        title: "Fix the flaky test",
        body: "Done: the timer race is fixed. More details.",
        data: {
          kind: "turn-finished",
          projectId: "project-1",
          threadId: thread.id,
        },
        sound: "default",
        channelId: "threads",
        priority: "high",
      });
      expect(host.expo.requests[0]?.[0]?.data).not.toHaveProperty("serverUrl");
      await vi.waitFor(async () => {
        const result = await host.harness.behavior.runCli(["status", "--json"]);
        expect(JSON.parse(result.stdout).lastSendOutcome).toMatchObject({
          status: "sent",
          sentCount: 2,
        });
      });
    } finally {
      await host.cleanup();
    }
  });

  it("sends the first paragraph as plain text with thread references named", async () => {
    const host = await setup();
    try {
      await host.addSubscription();
      host.setThread({ id: "thr_aedn9u3q8i", title: "Fix scroll jumps" });
      host.setThread({
        id: "thr_23456789ab",
        title:
          "Compare bb in-app terminal against Moshi, Termius, and Blink Shell",
      });
      const thread = host.setThread({ title: "Discord Dude" });

      await host.harness.behavior.emitThreadEvent("thread.idle", {
        thread,
        lastAssistantText: [
          "## Summary",
          "",
          "@thread:thr_aedn9u3q8i fixed **[#4793](https://github.com/get-bb/bb/issues/4793)**",
          "as `9579549809`; thr_8quy6y32b5 and snake_case_name remain.",
          "Then see @thread:thr_23456789ab.",
          "",
          "Second paragraph.",
        ].join("\n"),
      });

      await vi.waitFor(() => expect(host.expo.requests).toHaveLength(1));
      expect(host.expo.requests[0]?.[0]).toMatchObject({
        title: "Discord Dude",
        body: "“Fix scroll jumps” fixed #4793 as 9579549809; thr_8quy6y32b5 and snake_case_name remain. Then see “Compare bb in-app terminal against Mosh…”.",
      });
    } finally {
      await host.cleanup();
    }
  });

  it("skips directives, tables, and raw JSON in the preview", async () => {
    const host = await setup();
    try {
      await host.addSubscription();
      const previews = {
        Directive: [
          '::page{id="2d98aecf" version="e4d24dd2" display="inline"}',
          "",
          "Pick one icon and press Ship.",
        ],
        Table: [
          "## Result",
          "",
          "| Step | Before | After |",
          "|---|---|---|",
          "| Template | Unset | Set |",
          "The deployment did not change.",
        ],
        Json: [
          "{",
          '  "ok": true,',
          '  "enrolled": 9',
          "}",
          "",
          "All nine people are enrolled.",
        ],
        "Directive only": ['::page{id="2d98aecf" version="e4d24dd2"}'],
      };
      for (const [title, lines] of Object.entries(previews)) {
        await host.harness.behavior.emitThreadEvent("thread.idle", {
          thread: host.setThread({ title }),
          lastAssistantText: lines.join("\n"),
        });
      }

      await vi.waitFor(() => expect(host.expo.requests).toHaveLength(4));
      const bodies = Object.fromEntries(
        host.expo.requests.map((request) => [
          request[0]?.title,
          request[0]?.body,
        ]),
      );
      expect(bodies).toEqual({
        Directive: "Pick one icon and press Ship.",
        Table: "The deployment did not change.",
        Json: "All nine people are enrolled.",
        "Directive only": "Finished and waiting for you",
      });
    } finally {
      await host.cleanup();
    }
  });

  it("includes the configured public server URL", async () => {
    const host = await setup({ appUrl: "https://bb.example.test" });
    try {
      await host.addSubscription();
      const thread = host.setThread();

      await host.harness.behavior.emitThreadEvent("thread.idle", {
        thread,
        lastAssistantText: "Done",
      });

      await vi.waitFor(() => expect(host.expo.requests).toHaveLength(1));
      expect(host.expo.requests[0]?.[0]?.data).toEqual({
        kind: "turn-finished",
        projectId: "project-1",
        serverUrl: "https://bb.example.test",
        threadId: thread.id,
      });
    } finally {
      await host.cleanup();
    }
  });

  it("drops child, read, hidden, archived, and stale-status events", async () => {
    let now = 1_000;
    const host = await setup({ now: () => now });
    try {
      await host.addSubscription();
      const child = host.setThread({ parentThreadId: "parent-1" });
      await host.harness.behavior.emitThreadEvent("thread.idle", {
        thread: child,
        lastAssistantText: "Child done",
      });

      const read = host.setThread({ id: "thread-read" });
      await host.harness.behavior.emitThreadEvent("thread.idle", {
        thread: read,
        lastAssistantText: "Read done",
      });
      host.threads.set(read.id, {
        ...read,
        latestAttentionAt: now + 1,
        lastReadAt: now + 1,
      });

      const stale = host.setThread({ id: "thread-stale" });
      await host.harness.behavior.emitThreadEvent("thread.idle", {
        thread: stale,
        lastAssistantText: "Stale done",
      });
      host.threads.set(stale.id, { ...stale, status: "active" });

      const hidden = host.setThread({ id: "thread-hidden" });
      await host.harness.behavior.emitThreadEvent("thread.failed", {
        thread: hidden,
        error: "Failed",
      });
      host.threads.set(hidden.id, {
        ...hidden,
        status: "error",
        visibility: "hidden",
      });

      const archived = host.setThread({ id: "thread-archived" });
      await host.harness.behavior.emitThreadEvent("thread.failed", {
        thread: archived,
        error: "Failed",
      });
      host.threads.set(archived.id, {
        ...archived,
        status: "error",
        archivedAt: now,
      });
      now += 2;
      await waitForCoalesce();
      expect(host.expo.requests).toEqual([]);
      expect(host.clientSignals()).toEqual([]);
    } finally {
      await host.cleanup();
    }
  });

  it("coalesces interaction and idle events, prefers the interaction, and checks it again", async () => {
    const host = await setup();
    try {
      await host.addSubscription();
      const thread = host.setThread({ status: "active", title: "Release" });
      const interaction = pendingQuestion(
        thread.id,
        "Ship to staging or production?",
      );
      host.interactions.set(thread.id, [interaction]);

      await host.harness.behavior.emitThreadEvent("thread.idle", {
        thread: { ...thread, status: "idle" },
        lastAssistantText: "Done",
      });
      await host.harness.behavior.emitThreadEvent("interaction.pending", {
        thread,
        interaction,
      });

      await vi.waitFor(() => expect(host.expo.requests).toHaveLength(1));
      expect(host.expo.requests[0]).toEqual([
        expect.objectContaining({
          title: "Release",
          body: "Ship to staging or production?",
          data: expect.objectContaining({ kind: "pending-interaction" }),
        }),
      ]);

      const answered = host.setThread({ id: "thread-answered" });
      const answeredInteraction = pendingQuestion(answered.id, "Continue?");
      host.interactions.set(answered.id, [answeredInteraction]);
      await host.harness.behavior.emitThreadEvent("interaction.pending", {
        thread: answered,
        interaction: answeredInteraction,
      });
      host.interactions.set(answered.id, []);
      await waitForCoalesce();
      expect(host.expo.requests).toHaveLength(1);
    } finally {
      await host.cleanup();
    }
  });

  it("batches devices and removes rows that Expo rejects as unregistered", async () => {
    const host = await setup();
    try {
      for (let index = 0; index < 101; index += 1) {
        await host.addSubscription(
          `ExponentPushToken[device-${index}]`,
          `Device ${index}`,
        );
      }
      host.expo.ticketErrors.set(
        "ExponentPushToken[device-100]",
        "DeviceNotRegistered",
      );
      const thread = host.setThread({ status: "error" });
      await host.harness.behavior.emitThreadEvent("thread.failed", {
        thread,
        error: "Provider exited with code 1\nStack",
      });

      await vi.waitFor(() => expect(host.expo.requests).toHaveLength(2));
      expect(host.expo.requests.map((batch) => batch.length)).toEqual([100, 1]);
      await vi.waitFor(async () => {
        const listed = listPushSubscriptionsOutputSchema.parse(
          await host.harness.behavior.callRpc("pushSubscriptions.list", {}),
        );
        expect(listed.subscriptions).toHaveLength(100);
      });
      expect(JSON.stringify(host.harness.logEntries)).not.toContain(
        "ExponentPushToken",
      );
    } finally {
      await host.cleanup();
    }
  });

  it("warns once per hour for network failures and logs only row ids", async () => {
    let now = 10_000;
    const host = await setup({
      now: () => now,
      fetch: async () => {
        throw new Error("ECONNREFUSED with ExponentPushToken[secret]");
      },
    });
    try {
      await host.addSubscription();
      const trigger = async (id: string) => {
        const thread = host.setThread({ id, status: "error" });
        await host.harness.behavior.emitThreadEvent("thread.failed", {
          thread,
          error: "Provider failed",
        });
        await waitForCoalesce();
      };

      await trigger("thread-first");
      now += 3_599_999;
      await trigger("thread-second");
      now += 1;
      await trigger("thread-third");

      const warnings = host.harness.logEntries.filter(
        (entry) =>
          entry.level === "warn" &&
          entry.message.startsWith("Expo push request failed"),
      );
      expect(warnings).toHaveLength(2);
      expect(warnings[0]?.message).toContain("subscription-1");
      expect(JSON.stringify(host.harness.logEntries)).not.toContain(
        "ExponentPushToken",
      );
    } finally {
      await host.cleanup();
    }
  });
});

describe("web and desktop delivery", () => {
  it("delivers without mobile subscriptions and applies channel changes immediately", async () => {
    const host = await setup();
    try {
      const thread = host.setThread();
      await host.harness.behavior.emitThreadEvent("thread.idle", {
        thread,
        lastAssistantText: "Done",
      });
      await waitForCoalesce();
      expect(host.clientSignals()).toEqual([
        {
          channel: "notification",
          payload: expect.objectContaining({
            title: thread.title,
            body: "Done",
            threadId: thread.id,
            channels: ["web", "desktop"],
          }),
        },
      ]);
      await host.addSubscription();
      await host.harness.behavior.setSettings({
        mobileEnabled: false,
        webEnabled: false,
      });
      await host.harness.behavior.emitThreadEvent("thread.idle", {
        thread,
        lastAssistantText: "Desktop only",
      });
      await waitForCoalesce();
      expect(host.clientSignals().at(-1)?.payload).toMatchObject({
        channels: ["desktop"],
      });
      expect(host.expo.requests).toHaveLength(0);
      await host.harness.behavior.setSettings({ desktopEnabled: false });
      await host.harness.behavior.emitThreadEvent("thread.idle", {
        thread,
        lastAssistantText: "Disabled",
      });
      await waitForCoalesce();
      expect(host.clientSignals()).toHaveLength(2);
    } finally {
      await host.cleanup();
    }
  });

  it("routes CLI and RPC tests only to the selected enabled channel", async () => {
    const host = await setup();
    try {
      expect(await host.harness.behavior.runCli(["test", "web"])).toMatchObject(
        { exitCode: 0 },
      );
      expect(host.clientSignals().at(-1)?.payload).toMatchObject({
        channels: ["web"],
        threadId: null,
      });
      await host.harness.behavior.callRpc("notifications.test", {
        channel: "desktop",
      });
      expect(host.clientSignals().at(-1)?.payload).toMatchObject({
        channels: ["desktop"],
      });
      await host.harness.behavior.setSettings({ desktopEnabled: false });
      expect(
        await host.harness.behavior.runCli(["test", "desktop"]),
      ).toMatchObject({ exitCode: 1 });
      await expect(
        host.harness.behavior.callRpc("notifications.test", {
          channel: "desktop",
        }),
      ).rejects.toThrow("disabled");
      await expect(
        host.harness.behavior.callRpc("notifications.test", { channel: "ios" }),
      ).rejects.toMatchObject({ code: "invalid_input" });
      expect(host.clientSignals()).toHaveLength(2);
    } finally {
      await host.cleanup();
    }
  });
});

describe("thread notification levels", () => {
  it.each([
    {
      name: "unset worker under an unset parent gets the child default",
      grandparent: "inherit",
      parent: "inherit",
      worker: "inherit",
      childLevel: "input-only",
      expected: {
        parent: { effective: "input-only", source: "child-default" },
        worker: { effective: "input-only", source: "child-default" },
      },
    },
    {
      name: "a worker's own all beats the child default",
      grandparent: "inherit",
      parent: "inherit",
      worker: "all",
      childLevel: "input-only",
      expected: {
        parent: { effective: "input-only", source: "child-default" },
        worker: { effective: "all", source: "self" },
      },
    },
    {
      name: "a parent set to all does not raise an unset worker",
      grandparent: "inherit",
      parent: "all",
      worker: "inherit",
      childLevel: "input-only",
      expected: {
        parent: { effective: "all", source: "self" },
        worker: { effective: "input-only", source: "child-default" },
      },
    },
    {
      name: "a muted parent mutes an unset worker",
      grandparent: "inherit",
      parent: "muted",
      worker: "inherit",
      childLevel: "input-only",
      expected: {
        parent: { effective: "muted", source: "self" },
        worker: { effective: "muted", source: "parent" },
      },
    },
    {
      name: "a muted grandparent caps a parent set to all and its workers",
      grandparent: "muted",
      parent: "all",
      worker: "inherit",
      childLevel: "input-only",
      expected: {
        parent: { effective: "muted", source: "parent" },
        worker: { effective: "muted", source: "ancestor" },
      },
    },
    {
      name: "a muted grandparent caps a worker set to all",
      grandparent: "muted",
      parent: "inherit",
      worker: "all",
      childLevel: "all",
      expected: {
        parent: { effective: "muted", source: "parent" },
        worker: { effective: "muted", source: "ancestor" },
      },
    },
  ])("$name", async ({ grandparent, parent, worker, childLevel, expected }) => {
    const host = await setup();
    try {
      await host.harness.behavior.setSettings({ childLevel });
      const root = host.setThread({ id: "root" });
      const middle = host.setThread({ id: "middle", parentThreadId: root.id });
      const leaf = host.setThread({ id: "leaf", parentThreadId: middle.id });
      await host.setLevel(leaf.id, worker);
      await host.setLevel(middle.id, parent);
      await host.setLevel(root.id, grandparent);
      await expect(host.getLevel(middle.id)).resolves.toEqual({
        own: parent,
        ...expected.parent,
      });
      await expect(host.getLevel(leaf.id)).resolves.toEqual({
        own: worker,
        ...expected.worker,
      });
    } finally {
      await host.cleanup();
    }
  });

  it("stores only each thread's own level and resolves limits from the current tree", async () => {
    const host = await setup();
    try {
      const root = host.setThread({ id: "root" });
      const child = host.setThread({ id: "child", parentThreadId: root.id });
      const grandchild = host.setThread({
        id: "grandchild",
        parentThreadId: child.id,
      });
      const other = host.setThread({ id: "other" });

      await host.setLevel(root.id, "muted");
      expect(host.storedLevel(root.id)).toBe("muted");
      expect(host.storedLevel(child.id)).toBeNull();
      expect(host.storedLevel(grandchild.id)).toBeNull();
      expect(host.storedLevel(other.id)).toBeNull();
      await expect(host.getLevel(grandchild.id)).resolves.toEqual({
        own: "inherit",
        effective: "muted",
        source: "ancestor",
      });

      await host.setLevel(child.id, "all");
      expect(host.storedLevel(child.id)).toBe("all");
      await expect(host.getLevel(child.id)).resolves.toEqual({
        own: "all",
        effective: "muted",
        source: "parent",
      });
      await expect(host.getLevel(grandchild.id)).resolves.toEqual({
        own: "inherit",
        effective: "muted",
        source: "ancestor",
      });

      await host.setLevel(root.id, "inherit");
      expect(host.storedLevel(root.id)).toBeNull();
      await expect(host.getLevel(child.id)).resolves.toEqual({
        own: "all",
        effective: "all",
        source: "self",
      });
      await expect(host.getLevel(grandchild.id)).resolves.toEqual({
        own: "inherit",
        effective: "input-only",
        source: "child-default",
      });

      await host.setLevel(child.id, "inherit");
      expect(host.storedLevel(child.id)).toBeNull();

      await host.harness.behavior.setSettings({ defaultLevel: "muted" });
      await expect(host.getLevel(root.id)).resolves.toEqual({
        own: "inherit",
        effective: "muted",
        source: "global",
      });
      await host.harness.behavior.setSettings({ childLevel: "inherit" });
      await expect(host.getLevel(grandchild.id)).resolves.toEqual({
        own: "inherit",
        effective: "muted",
        source: "global",
      });

      await expect(host.getLevel("missing")).rejects.toThrow(
        "Thread not found",
      );
      await expect(host.setLevel("missing", "muted")).rejects.toThrow(
        "Thread not found",
      );
    } finally {
      await host.cleanup();
    }
  });

  it("follows a thread nested under a new parent or released from an archived one", async () => {
    const host = await setup();
    try {
      const muted = host.setThread({ id: "muted" });
      const loud = host.setThread({ id: "loud" });
      const worker = host.setThread({ id: "worker", parentThreadId: muted.id });
      const subWorker = host.setThread({
        id: "sub-worker",
        parentThreadId: worker.id,
        status: "active",
      });
      await host.setLevel(muted.id, "muted");
      await host.setLevel(loud.id, "all");
      await expect(host.getLevel(subWorker.id)).resolves.toMatchObject({
        effective: "muted",
        source: "ancestor",
      });

      host.moveThread(worker.id, loud.id);
      await expect(host.getLevel(subWorker.id)).resolves.toEqual({
        own: "inherit",
        effective: "input-only",
        source: "child-default",
      });
      const question = pendingQuestion(subWorker.id, "Ship it?");
      host.interactions.set(subWorker.id, [question]);
      await host.harness.behavior.emitThreadEvent("interaction.pending", {
        thread: host.threads.get(subWorker.id)!,
        interaction: question,
      });
      await waitForCoalesce();
      expect(host.clientSignals().map((signal) => signal.payload)).toEqual([
        expect.objectContaining({ threadId: subWorker.id, body: "Ship it?" }),
      ]);

      host.moveThread(worker.id, muted.id);
      await expect(host.getLevel(subWorker.id)).resolves.toMatchObject({
        effective: "muted",
        source: "ancestor",
      });
      host.moveThread(worker.id, null);
      await expect(host.getLevel(worker.id)).resolves.toEqual({
        own: "inherit",
        effective: "all",
        source: "global",
      });
      await expect(host.getLevel(subWorker.id)).resolves.toEqual({
        own: "inherit",
        effective: "input-only",
        source: "child-default",
      });
    } finally {
      await host.cleanup();
    }
  });

  it("publishes a moved thread's subtree when its parent changes", async () => {
    const host = await setup();
    try {
      const muted = host.setThread({ id: "muted" });
      const worker = host.setThread({ id: "worker" });
      const subWorker = host.setThread({
        id: "sub-worker",
        parentThreadId: worker.id,
      });
      host.setThread({ id: "other" });
      await host.setLevel(muted.id, "muted");

      host.moveThread(worker.id, muted.id);
      await host.harness.behavior.emitThreadEvent(
        "experimental_thread.parentChanged",
        { thread: host.threads.get(worker.id)!, previousParentThreadId: null },
      );
      const capped = {
        own: "inherit",
        ancestorCap: { level: "muted", threadId: muted.id },
      };
      await expect(host.listLevels([worker.id, subWorker.id])).resolves.toEqual(
        { threads: { [worker.id]: capped, [subWorker.id]: capped } },
      );
    } finally {
      await host.cleanup();
    }
  });

  it("publishes only live, visible descendants and republishes a thread when it is unarchived", async () => {
    const host = await setup();
    try {
      const root = host.setThread({ id: "root" });
      const archived = host.setThread({
        id: "archived",
        parentThreadId: root.id,
        archivedAt: 1,
      });
      const worker = host.setThread({
        id: "worker",
        parentThreadId: archived.id,
      });
      host.setThread({
        id: "hidden",
        parentThreadId: root.id,
        visibility: "hidden",
      });
      const capped = {
        own: "inherit",
        ancestorCap: { level: "muted", threadId: root.id },
      };

      await host.setLevel(root.id, "muted");
      await expect(host.listLevels([root.id, worker.id])).resolves.toEqual({
        threads: {
          [root.id]: { own: "muted", ancestorCap: null },
          [worker.id]: capped,
        },
      });

      const unarchived = { ...archived, archivedAt: null };
      host.threads.set(archived.id, unarchived);
      await host.harness.behavior.emitThreadEvent("thread.unarchived", {
        thread: unarchived,
      });
      await expect(host.listLevels([archived.id, worker.id])).resolves.toEqual({
        threads: { [archived.id]: capped, [worker.id]: capped },
      });
    } finally {
      await host.cleanup();
    }
  });

  it("lists resolved levels in one call and publishes the written thread's subtree", async () => {
    const host = await setup();
    try {
      const root = host.setThread({ id: "root" });
      host.setThread({ id: "child", parentThreadId: root.id });
      host.setThread({ id: "other" });

      await host.setLevel(root.id, "muted");
      const capped = {
        own: "inherit",
        ancestorCap: { level: "muted", threadId: root.id },
      };
      await expect(
        host.listLevels(["root", "child", "other"]),
      ).resolves.toEqual({
        threads: { root: { own: "muted", ancestorCap: null }, child: capped },
      });
      await host.setLevel(root.id, "inherit");
      await expect(
        host.listLevels(["root", "child", "other"]),
      ).resolves.toEqual({ threads: {} });
    } finally {
      await host.cleanup();
    }
  });

  it("lists the requested threads' rows, archived ones included", async () => {
    const host = await setup();
    try {
      const archived = host.setThread({ id: "archived", archivedAt: 1 });
      const plain = host.setThread({ id: "plain" });
      host.setThread({ id: "unrequested" });
      await host.setLevel(archived.id, "muted");
      await host.setLevel("unrequested", "all");
      await expect(
        host.listLevels([archived.id, plain.id, "missing"]),
      ).resolves.toEqual({
        threads: { archived: { own: "muted", ancestorCap: null } },
      });
      await expect(host.listLevels([])).rejects.toMatchObject({
        code: "invalid_input",
      });
    } finally {
      await host.cleanup();
    }
  });

  it("prints and sets levels from the CLI", async () => {
    const host = await setup();
    try {
      const root = host.setThread({ id: "root" });
      const child = host.setThread({ id: "child", parentThreadId: root.id });
      const grandchild = host.setThread({
        id: "grandchild",
        parentThreadId: child.id,
      });
      await expect(
        host.harness.behavior.runCli(["thread", root.id]),
      ).resolves.toMatchObject({
        exitCode: 0,
        stdout: "Notifications for root: all (default)",
      });
      await expect(
        host.harness.behavior.runCli(["thread", root.id, "--level", "muted"]),
      ).resolves.toMatchObject({
        exitCode: 0,
        stdout: "Notifications for root: muted (set on this thread)",
      });
      await expect(
        host.harness.behavior.runCli(["thread", child.id, "--level", "all"]),
      ).resolves.toMatchObject({
        exitCode: 0,
        stdout: "Notifications for child: muted (limited by parent)",
      });
      await expect(
        host.harness.behavior.runCli(["thread", grandchild.id]),
      ).resolves.toMatchObject({
        exitCode: 0,
        stdout: "Notifications for grandchild: muted (limited by an ancestor)",
      });
      const inherited = await host.harness.behavior.runCli([
        "thread",
        child.id,
        "--json",
      ]);
      expect(JSON.parse(inherited.stdout)).toEqual({
        threadId: "child",
        own: "all",
        effective: "muted",
        source: "parent",
      });
      const invalid = await host.harness.behavior.runCli([
        "thread",
        child.id,
        "--level",
        "loud",
      ]);
      expect(invalid.exitCode).toBe(1);
      expect(invalid.stderr).toContain("invalid value 'loud' for --level");
      const missing = await host.harness.behavior.runCli([
        "thread",
        "missing",
        "--json",
      ]);
      expect(missing.exitCode).toBe(1);
      expect(JSON.parse(missing.stdout)).toMatchObject({
        ok: false,
        error: { code: "thread_not_found" },
      });
    } finally {
      await host.cleanup();
    }
  });

  it("applies the resolved level at send time", async () => {
    const host = await setup();
    try {
      const muted = host.setThread({ id: "muted", status: "active" });
      await host.setLevel(muted.id, "muted");
      const mutedQuestion = pendingQuestion(muted.id, "Continue?");
      host.interactions.set(muted.id, [mutedQuestion]);
      await host.harness.behavior.emitThreadEvent("interaction.pending", {
        thread: muted,
        interaction: mutedQuestion,
      });

      const quiet = host.setThread({ id: "quiet" });
      await host.setLevel(quiet.id, "input-only");
      await host.harness.behavior.emitThreadEvent("thread.idle", {
        thread: quiet,
        lastAssistantText: "Finished quietly",
      });
      await waitForCoalesce();
      expect(host.clientSignals()).toEqual([]);

      host.threads.set(quiet.id, { ...quiet, status: "active" });
      const quietQuestion = pendingQuestion(quiet.id, "Deploy now?");
      host.interactions.set(quiet.id, [quietQuestion]);
      await host.harness.behavior.emitThreadEvent("interaction.pending", {
        thread: quiet,
        interaction: quietQuestion,
      });
      await waitForCoalesce();
      expect(host.clientSignals().map((signal) => signal.payload)).toEqual([
        expect.objectContaining({ threadId: quiet.id, body: "Deploy now?" }),
      ]);

      const failing = host.setThread({ id: "failing", status: "error" });
      await host.setLevel(failing.id, "input-only");
      await host.harness.behavior.emitThreadEvent("thread.failed", {
        thread: failing,
        error: "Provider crashed",
      });

      const inheritedQuiet = host.setThread({
        id: "inherited-quiet",
        parentThreadId: quiet.id,
        status: "active",
      });
      const inheritedQuestion = pendingQuestion(inheritedQuiet.id, "Merge?");
      host.interactions.set(inheritedQuiet.id, [inheritedQuestion]);
      await host.harness.behavior.emitThreadEvent("interaction.pending", {
        thread: inheritedQuiet,
        interaction: inheritedQuestion,
      });
      await waitForCoalesce();
      expect(host.clientSignals().map((signal) => signal.payload)).toEqual([
        expect.objectContaining({ threadId: quiet.id }),
        expect.objectContaining({
          threadId: failing.id,
          body: "Provider crashed",
        }),
        expect.objectContaining({
          threadId: inheritedQuiet.id,
          body: "Merge?",
        }),
      ]);

      await host.harness.behavior.setSettings({ defaultLevel: "input-only" });
      const plain = host.setThread({ id: "plain" });
      await host.harness.behavior.emitThreadEvent("thread.idle", {
        thread: plain,
        lastAssistantText: "Done",
      });
      await waitForCoalesce();
      expect(host.clientSignals()).toHaveLength(3);
    } finally {
      await host.cleanup();
    }
  });

  it("notifies only chosen trees under a muted default, their workers no louder than the child level", async () => {
    const host = await setup();
    try {
      await host.harness.behavior.setSettings({ defaultLevel: "muted" });
      const plain = host.setThread({ id: "plain" });
      const chosen = host.setThread({ id: "chosen" });
      await host.setLevel(chosen.id, "all");
      const chosenWorker = host.setThread({
        id: "chosen-worker",
        parentThreadId: chosen.id,
      });
      for (const thread of [plain, chosen, chosenWorker]) {
        await host.harness.behavior.emitThreadEvent("thread.idle", {
          thread,
          lastAssistantText: `${thread.id} done`,
        });
      }
      await waitForCoalesce();
      expect(host.clientSignals().map((signal) => signal.payload)).toEqual([
        expect.objectContaining({ threadId: chosen.id }),
      ]);

      const plainWorker = host.setThread({
        id: "plain-worker",
        parentThreadId: plain.id,
      });
      await host.harness.behavior.emitThreadEvent("thread.idle", {
        thread: plainWorker,
        lastAssistantText: "Worker done",
      });
      await waitForCoalesce();
      expect(host.clientSignals()).toHaveLength(1);

      await host.harness.behavior.setSettings({ childLevel: "all" });
      await host.harness.behavior.emitThreadEvent("thread.idle", {
        thread: plainWorker,
        lastAssistantText: "Worker done again",
      });
      await waitForCoalesce();
      expect(host.clientSignals().at(-1)?.payload).toMatchObject({
        threadId: plainWorker.id,
        body: "Worker done again",
      });
    } finally {
      await host.cleanup();
    }
  });
});

describe("model notifications", () => {
  it("sends an explicit notification on a muted, already-read thread", async () => {
    const host = await setup();
    try {
      await host.addSubscription();
      await host.harness.behavior.setSettings({ defaultLevel: "muted" });
      const thread = host.setThread({
        id: "thread-muted",
        latestAttentionAt: 100,
        lastReadAt: 500,
      });

      const result = await host.harness.behavior.callAgentTool(
        "notify_user",
        { message: "Build is green" },
        { threadId: thread.id },
      );

      expect(result).toBe("Sent a push notification (web, desktop, 1 mobile).");
      expect(host.clientSignals().map((signal) => signal.payload)).toEqual([
        expect.objectContaining({
          threadId: thread.id,
          title: "Fix the flaky test",
          body: "Build is green",
        }),
      ]);
      expect(host.expo.requests).toEqual([
        [
          expect.objectContaining({
            to: "ExponentPushToken[phone]",
            title: "Fix the flaky test",
            body: "Build is green",
            data: expect.objectContaining({
              kind: "agent-message",
              threadId: thread.id,
            }),
          }),
        ],
      ]);
    } finally {
      await host.cleanup();
    }
  });

  it("refuses a second send inside the cooldown and allows it afterwards", async () => {
    let clock = 1_000_000;
    const host = await setup({ now: () => clock });
    try {
      const thread = host.setThread({ id: "thread-cooldown" });

      await expect(
        host.harness.behavior.callAgentTool(
          "notify_user",
          { message: "First" },
          { threadId: thread.id },
        ),
      ).resolves.toBe("Sent a push notification (web, desktop).");

      await expect(
        host.harness.behavior.callAgentTool(
          "notify_user",
          { message: "Second" },
          { threadId: thread.id },
        ),
      ).resolves.toEqual({
        content: [
          {
            type: "text",
            text: "A notification was recently attempted for this thread",
          },
        ],
        isError: true,
      });
      expect(host.clientSignals()).toHaveLength(1);

      clock += 5 * 60_000;
      await expect(
        host.harness.behavior.callAgentTool(
          "notify_user",
          { message: "Third" },
          { threadId: thread.id },
        ),
      ).resolves.toBe("Sent a push notification (web, desktop).");
      expect(host.clientSignals()).toHaveLength(2);
    } finally {
      await host.cleanup();
    }
  });

  it("refuses explicit tool/RPC sends with the kill switch off without muting automatic delivery", async () => {
    const host = await setup();
    try {
      await host.harness.behavior.setSettings({ agentNotifications: false });
      const thread = host.setThread({ id: "thread-disabled" });
      await expect(
        host.harness.behavior.callAgentTool(
          "notify_user",
          { message: "Anything" },
          { threadId: thread.id },
        ),
      ).resolves.toEqual({
        content: [{ type: "text", text: "Agent notifications are turned off" }],
        isError: true,
      });
      await expect(
        host.harness.behavior.callRpc("notifications.send", {
          threadId: thread.id,
          message: "RPC",
        }),
      ).rejects.toMatchObject({
        code: "handler_error",
        message: "Agent notifications are turned off",
      });
      expect(host.clientSignals()).toHaveLength(0);
      await host.harness.behavior.emitThreadEvent("thread.idle", {
        thread,
        lastAssistantText: "Automatic completion",
      });
      await waitForCoalesce();
      expect(host.clientSignals().map((signal) => signal.payload)).toEqual([
        expect.objectContaining({ body: "Automatic completion" }),
      ]);
    } finally {
      await host.cleanup();
    }
  });

  it("honours disabled mobile delivery and zero cooldown across immediate CLI/RPC sends", async () => {
    const host = await setup({ now: () => 1_000_000 });
    try {
      await host.addSubscription();
      await host.harness.behavior.setSettings({
        mobileEnabled: false,
        agentNotifyCooldownMinutes: "0",
      });
      const thread = host.setThread({ id: "thread-cli" });

      const cli = await host.harness.behavior.runCli(
        ["notify", "--message", "Blocked on credentials"],
        { threadId: thread.id },
      );
      expect(cli).toMatchObject({
        exitCode: 0,
        stdout: "Sent a push notification (web, desktop)",
      });

      await expect(
        host.harness.behavior.callRpc("notifications.send", {
          threadId: thread.id,
          message: "Second one",
        }),
      ).resolves.toEqual({
        status: "sent",
        delivered: { mobile: 0, web: true, desktop: true },
      });
      expect(host.expo.requests).toHaveLength(0);
    } finally {
      await host.cleanup();
    }
  });

  it("uses an explicit CLI thread override and emits structured success", async () => {
    const host = await setup();
    try {
      await host.addSubscription();
      const invoking = host.setThread({ id: "thread-invoking" });
      const target = host.setThread({ id: "thread-target" });
      const result = await host.harness.behavior.runCli(
        [
          "notify",
          "--thread",
          target.id,
          "--message",
          "Target ready",
          "--json",
        ],
        { threadId: invoking.id },
      );
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        status: "sent",
        delivered: { mobile: 1, web: true, desktop: true },
      });
      expect(host.clientSignals().map((signal) => signal.payload)).toEqual([
        expect.objectContaining({ threadId: target.id, body: "Target ready" }),
      ]);
      expect(host.expo.requests[0]?.[0]?.data.threadId).toBe(target.id);
    } finally {
      await host.cleanup();
    }
  });

  it.each(["tool", "rpc", "cli"] as const)(
    "enforces trimmed message boundaries and display limits via %s",
    async (surface) => {
      const host = await setup();
      try {
        await host.addSubscription();
        await host.harness.behavior.setSettings({
          agentNotifyCooldownMinutes: "0",
        });
        const thread = host.setThread();
        async function send(message: string): Promise<boolean> {
          try {
            if (surface === "tool")
              return (
                typeof (await host.harness.behavior.callAgentTool(
                  "notify_user",
                  { message },
                  { threadId: thread.id },
                )) === "string"
              );
            if (surface === "rpc") {
              await host.harness.behavior.callRpc("notifications.send", {
                threadId: thread.id,
                message,
              });
              return true;
            }
            return (
              (
                await host.harness.behavior.runCli(
                  ["notify", "--message", message],
                  { threadId: thread.id },
                )
              ).exitCode === 0
            );
          } catch {
            return false;
          }
        }
        expect(await send("x".repeat(501))).toBe(false);
        expect(await send(" \n ")).toBe(false);
        expect(host.clientSignals()).toHaveLength(0);
        expect(host.expo.requests).toHaveLength(0);
        expect(await send(`  ${"x".repeat(500)}  `)).toBe(true);
        expect(host.clientSignals().map((signal) => signal.payload)).toEqual([
          expect.objectContaining({ body: `${"x".repeat(179)}…` }),
        ]);
        expect(host.expo.requests[0]?.[0]?.body).toBe(`${"x".repeat(179)}…`);
      } finally {
        await host.cleanup();
      }
    },
  );

  it("exposes the tool through the agent configuration resolver", async () => {
    const host = await setup();
    try {
      const configuration =
        await host.harness.behavior.resolveAgentConfiguration(
          makePluginAgentConfigurationContext({
            pluginMetadata: {},
            thread: { id: "thread-test" },
          }),
        );
      expect(configuration.tools.map((tool) => tool.name)).toEqual([
        "notify_user",
      ]);
      expect(host.harness.registrations.agentConfigurationProvider).toBeNull();
    } finally {
      await host.cleanup();
    }
  });

  it("refuses archived, hidden, and deleted threads", async () => {
    const host = await setup();
    try {
      for (const thread of [
        host.setThread({ id: "thread-archived", archivedAt: 1 }),
        host.setThread({ id: "thread-hidden", visibility: "hidden" }),
        host.setThread({ id: "thread-deleted", deletedAt: 1 }),
      ]) {
        await expect(
          host.harness.behavior.callAgentTool(
            "notify_user",
            { message: "Anything" },
            { threadId: thread.id },
          ),
        ).resolves.toEqual({
          content: [
            { type: "text", text: "This thread cannot be notified right now" },
          ],
          isError: true,
        });
        await expect(
          host.harness.behavior.callRpc("notifications.send", {
            threadId: thread.id,
            message: "RPC",
          }),
        ).rejects.toMatchObject({
          code: "handler_error",
          message: "This thread cannot be notified right now",
        });
      }
      expect(host.clientSignals()).toHaveLength(0);
    } finally {
      await host.cleanup();
    }
  });

  it("admits one send per thread across simultaneous tool, RPC, and CLI calls", async () => {
    const host = await setup();
    try {
      const thread = host.setThread({ id: "thread-concurrent" });
      const results = await Promise.all([
        host.harness.behavior
          .callAgentTool(
            "notify_user",
            { message: "Tool" },
            { threadId: thread.id },
          )
          .then((result) => typeof result === "string"),
        host.harness.behavior
          .callRpc("notifications.send", {
            threadId: thread.id,
            message: "RPC",
          })
          .then(
            () => true,
            (error: Error) => {
              expect(error.message).toContain("recently");
              return false;
            },
          ),
        host.harness.behavior
          .runCli(["notify", "--message", "CLI"], { threadId: thread.id })
          .then((result) => result.exitCode === 0),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(host.clientSignals()).toHaveLength(1);
    } finally {
      await host.cleanup();
    }
  });

  it("rechecks the kill switch before dispatching a prepared send", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached!: () => void;
    const reachedGate = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const host = await setup({
      onThreadGet: async () => {
        reached();
        await gate;
      },
    });
    try {
      const thread = host.setThread({ id: "thread-toggle" });
      const pending = host.harness.behavior.callAgentTool(
        "notify_user",
        { message: "Ready" },
        { threadId: thread.id },
      );
      await reachedGate;
      await host.harness.behavior.setSettings({ agentNotifications: false });
      release();
      await expect(pending).resolves.toEqual({
        content: [{ type: "text", text: "Agent notifications are turned off" }],
        isError: true,
      });
      expect(host.clientSignals()).toHaveLength(0);
    } finally {
      await host.cleanup();
    }
  });

  it("does not deliver an explicit send after the sender stops", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached!: () => void;
    const reachedGate = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const host = await setup({
      onThreadGet: async () => {
        reached();
        await gate;
      },
    });
    try {
      const thread = host.setThread({ id: "thread-stop" });
      const pending = host.harness.behavior.callAgentTool(
        "notify_user",
        { message: "Ready" },
        { threadId: thread.id },
      );
      await reachedGate;
      host.service.controller.abort();
      let settled = false;
      void host.service.done.then(() => {
        settled = true;
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(settled).toBe(false);
      release();
      await expect(pending).resolves.toEqual({
        content: [{ type: "text", text: "Push delivery is not running" }],
        isError: true,
      });
      await host.service.done;
      expect(host.clientSignals()).toHaveLength(0);
    } finally {
      await host.cleanup();
    }
  });

  it("does not consume the cooldown when nothing was delivered", async () => {
    const host = await setup();
    try {
      await host.harness.behavior.setSettings({
        mobileEnabled: false,
        webEnabled: false,
        desktopEnabled: false,
      });
      const thread = host.setThread({ id: "thread-undelivered" });
      await expect(
        host.harness.behavior.callAgentTool(
          "notify_user",
          { message: "Ready" },
          { threadId: thread.id },
        ),
      ).resolves.toEqual({
        content: [
          {
            type: "text",
            text: "The notification was not delivered: no delivery channels or devices are available. Tell the user in your reply instead.",
          },
        ],
        isError: true,
      });
      await host.harness.behavior.setSettings({ webEnabled: true });
      await expect(
        host.harness.behavior.callAgentTool(
          "notify_user",
          { message: "Ready again" },
          { threadId: thread.id },
        ),
      ).resolves.toBe("Sent a push notification (web).");
      expect(host.clientSignals()).toHaveLength(1);
    } finally {
      await host.cleanup();
    }
  });

  it("reports a mobile relay failure instead of success and rate limits it", async () => {
    const failureFetch: PushSenderFetch = async () => ({
      ok: false,
      status: 502,
      text: async () => "bad gateway",
    });
    const host = await setup({ fetch: failureFetch });
    try {
      await host.addSubscription();
      await host.harness.behavior.setSettings({
        webEnabled: false,
        desktopEnabled: false,
      });
      const thread = host.setThread({ id: "thread-relay-failure" });
      const result = await host.harness.behavior.callAgentTool(
        "notify_user",
        { message: "Ready" },
        { threadId: thread.id },
      );
      if (typeof result === "string") throw new Error("expected a failure");
      expect(result.isError).toBe(true);
      expect(result.content[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("could not be delivered"),
      });
      expect(host.clientSignals()).toHaveLength(0);
      await expect(
        host.harness.behavior.callAgentTool(
          "notify_user",
          { message: "Again" },
          { threadId: thread.id },
        ),
      ).resolves.toMatchObject({
        isError: true,
        content: [
          {
            type: "text",
            text: "A notification was recently attempted for this thread",
          },
        ],
      });
    } finally {
      await host.cleanup();
    }
  });

  it("keeps cooldown history when the duration changes", async () => {
    let clock = 1_000_000;
    const host = await setup({ now: () => clock });
    try {
      const a = host.setThread({ id: "thread-a" });
      const b = host.setThread({ id: "thread-b" });
      await host.harness.behavior.callAgentTool(
        "notify_user",
        { message: "A1" },
        { threadId: a.id },
      );
      clock += 61_000;
      await host.harness.behavior.setSettings({
        agentNotifyCooldownMinutes: "1",
      });
      await host.harness.behavior.callAgentTool(
        "notify_user",
        { message: "B1" },
        { threadId: b.id },
      );
      await host.harness.behavior.setSettings({
        agentNotifyCooldownMinutes: "60",
      });
      await expect(
        host.harness.behavior.callAgentTool(
          "notify_user",
          { message: "A2" },
          { threadId: a.id },
        ),
      ).resolves.toMatchObject({
        isError: true,
        content: [
          {
            type: "text",
            text: "A notification was recently attempted for this thread",
          },
        ],
      });
    } finally {
      await host.cleanup();
    }
  });

  it("keeps explicit and automatic completion notifications independent", async () => {
    const host = await setup();
    try {
      const thread = host.setThread({ id: "thread-turn", status: "active" });
      await host.harness.behavior.callAgentTool(
        "notify_user",
        { message: "Done" },
        { threadId: thread.id },
      );
      expect(host.clientSignals()).toHaveLength(1);

      const firstIdle: ThreadResponse = { ...thread, status: "idle" };
      host.threads.set(thread.id, firstIdle);
      await host.harness.behavior.emitThreadEvent("thread.idle", {
        thread: firstIdle,
        lastAssistantText: "Done",
      });
      await waitForCoalesce();
      expect(host.clientSignals()).toHaveLength(2);

      const active: ThreadResponse = { ...thread, status: "active" };
      host.threads.set(thread.id, active);
      await host.harness.behavior.emitThreadEvent("thread.active", {
        thread: active,
      });
      const idle: ThreadResponse = { ...thread, status: "idle" };
      host.threads.set(thread.id, idle);
      await host.harness.behavior.emitThreadEvent("thread.idle", {
        thread: idle,
        lastAssistantText: "Second turn",
      });
      await waitForCoalesce();
      expect(host.clientSignals()).toHaveLength(3);
    } finally {
      await host.cleanup();
    }
  });

  it("preserves delivered counts and cooldown when bookkeeping throws", async () => {
    const host = await setup();
    try {
      await host.addSubscription();
      const thread = host.setThread({ id: "thread-bookkeeping" });
      vi.spyOn(host.bb.storage.kv, "set").mockRejectedValue(
        new Error("kv down"),
      );
      await expect(
        host.harness.behavior.callRpc("notifications.send", {
          threadId: thread.id,
          message: "Ready",
        }),
      ).resolves.toEqual({
        status: "failed",
        reason: "kv down",
        delivered: { mobile: 1, web: true, desktop: true },
      });
      expect(host.expo.requests).toHaveLength(1);
      expect(host.clientSignals()).toHaveLength(1);
      await expect(
        host.harness.behavior.callAgentTool(
          "notify_user",
          { message: "Again" },
          { threadId: thread.id },
        ),
      ).resolves.toMatchObject({
        isError: true,
        content: [
          {
            type: "text",
            text: "A notification was recently attempted for this thread",
          },
        ],
      });
    } finally {
      vi.restoreAllMocks();
      await host.cleanup();
    }
  });

  it("does not suppress a healthy completion after a failed explicit attempt", async () => {
    const failureFetch: PushSenderFetch = async () => ({
      ok: false,
      status: 502,
      text: async () => "bad gateway",
    });
    const host = await setup({ fetch: failureFetch });
    try {
      await host.addSubscription();
      await host.harness.behavior.setSettings({
        webEnabled: false,
        desktopEnabled: false,
      });
      const thread = host.setThread({
        id: "thread-failed-suppress",
        status: "active",
      });
      const result = await host.harness.behavior.callAgentTool(
        "notify_user",
        { message: "Ready" },
        { threadId: thread.id },
      );
      if (typeof result === "string") throw new Error("expected a failure");
      expect(result.isError).toBe(true);
      expect(host.clientSignals()).toHaveLength(0);

      await host.harness.behavior.setSettings({ webEnabled: true });
      const idle: ThreadResponse = { ...thread, status: "idle" };
      host.threads.set(thread.id, idle);
      await host.harness.behavior.emitThreadEvent("thread.idle", {
        thread: idle,
        lastAssistantText: "Finished",
      });
      await waitForCoalesce();
      expect(host.clientSignals().map((signal) => signal.payload)).toEqual([
        expect.objectContaining({ body: "Finished" }),
      ]);
    } finally {
      await host.cleanup();
    }
  });

  it("delivers automatic completions before and after a pending explicit send independently", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached!: () => void;
    const reachedGate = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let lookupStarted = false;
    const host = await setup({
      onThreadGet: async () => {
        if (lookupStarted) return;
        lookupStarted = true;
        reached();
        await gate;
      },
    });
    try {
      const thread = host.setThread({ id: "thread-slow", status: "active" });
      const pending = host.harness.behavior.callAgentTool(
        "notify_user",
        { message: "Explicit A" },
        { threadId: thread.id },
      );
      await reachedGate;

      const idleA: ThreadResponse = { ...thread, status: "idle" };
      host.threads.set(thread.id, idleA);
      await host.harness.behavior.emitThreadEvent("thread.idle", {
        thread: idleA,
        lastAssistantText: "Completion A",
      });
      await waitForCoalesce();
      expect(host.clientSignals().map((signal) => signal.payload)).toEqual([
        expect.objectContaining({ body: "Completion A" }),
      ]);

      const activeB: ThreadResponse = { ...thread, status: "active" };
      host.threads.set(thread.id, activeB);
      await host.harness.behavior.emitThreadEvent("thread.active", {
        thread: activeB,
      });
      release();
      await pending;

      const idleB: ThreadResponse = { ...thread, status: "idle" };
      host.threads.set(thread.id, idleB);
      await host.harness.behavior.emitThreadEvent("thread.idle", {
        thread: idleB,
        lastAssistantText: "Completion B",
      });
      await waitForCoalesce();
      const bodies = host
        .clientSignals()
        .map((signal) => (signal.payload as { body: string }).body);
      expect(bodies).toEqual(["Completion A", "Explicit A", "Completion B"]);
    } finally {
      release();
      await host.cleanup();
    }
  });

  it("reports failure when the relay accepts no deliveries", async () => {
    const expo = createFakeExpo();
    expo.ticketErrors.set("ExponentPushToken[phone]", "DeviceNotRegistered");
    const host = await setup({ expo });
    try {
      await host.addSubscription();
      await host.harness.behavior.setSettings({
        webEnabled: false,
        desktopEnabled: false,
      });
      const thread = host.setThread({ id: "thread-unregistered" });
      const result = await host.harness.behavior.callAgentTool(
        "notify_user",
        { message: "Ready" },
        { threadId: thread.id },
      );
      if (typeof result === "string") throw new Error("expected a failure");
      expect(result.isError).toBe(true);
      await expect(
        host.harness.behavior.callRpc("pushSubscriptions.list", {}),
      ).resolves.toEqual({ subscriptions: [] });
    } finally {
      await host.cleanup();
    }
  });

  it.each(["tool", "cli"] as const)(
    "reports accepted mobile delivery after bookkeeping failure via %s",
    async (surface) => {
      const host = await setup();
      try {
        await host.addSubscription();
        await host.harness.behavior.setSettings({
          webEnabled: false,
          desktopEnabled: false,
        });
        const thread = host.setThread();
        vi.spyOn(host.bb.storage.kv, "set").mockRejectedValue(
          new Error("kv down"),
        );
        if (surface === "tool") {
          const result = await host.harness.behavior.callAgentTool(
            "notify_user",
            { message: "Ready" },
            { threadId: thread.id },
          );
          expect(result).toMatchObject({
            isError: true,
            content: [
              {
                type: "text",
                text: expect.stringContaining(
                  "reached 1 mobile, but processing reported an error",
                ),
              },
            ],
          });
        } else {
          const result = await host.harness.behavior.runCli(
            ["notify", "--message", "Ready"],
            { threadId: thread.id },
          );
          expect(result.exitCode).toBe(1);
          expect(result.stderr).toContain(
            "reached 1 mobile, but processing reported an error",
          );
        }
        expect(host.expo.requests).toHaveLength(1);
      } finally {
        vi.restoreAllMocks();
        await host.cleanup();
      }
    },
  );

  it("does not claim web delivery when publication throws", async () => {
    const host = await setup();
    try {
      await host.addSubscription();
      const thread = host.setThread();
      vi.spyOn(host.bb.realtime, "publish").mockImplementation(() => {
        throw new Error("publish down");
      });
      await expect(
        host.harness.behavior.callRpc("notifications.send", {
          threadId: thread.id,
          message: "Ready",
        }),
      ).resolves.toEqual({
        status: "failed",
        reason: "publish down",
        delivered: { mobile: 1, web: false, desktop: false },
      });
      expect(host.expo.requests).toHaveLength(1);
      expect(host.clientSignals()).toHaveLength(0);
    } finally {
      vi.restoreAllMocks();
      await host.cleanup();
    }
  });

  it("preserves all accepted tickets when subscription cleanup fails", async () => {
    const host = await setup();
    try {
      await host.addSubscription("ExponentPushToken[before]");
      await host.addSubscription("ExponentPushToken[unregistered]");
      await host.addSubscription("ExponentPushToken[after]");
      host.expo.ticketErrors.set(
        "ExponentPushToken[unregistered]",
        "DeviceNotRegistered",
      );
      const thread = host.setThread();
      vi.spyOn(host.bb.storage.kv, "delete").mockRejectedValue(
        new Error("delete down"),
      );
      await expect(
        host.harness.behavior.callRpc("notifications.send", {
          threadId: thread.id,
          message: "Ready",
        }),
      ).resolves.toEqual({
        status: "failed",
        reason: "delete down",
        delivered: { mobile: 2, web: true, desktop: true },
      });
    } finally {
      vi.restoreAllMocks();
      await host.cleanup();
    }
  });

  it.each([0, 1, 3])(
    "rejects a response containing %i tickets for two devices, retaining accepted counts",
    async (ticketCount) => {
      const host = await setup({
        fetch: async () => ({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              data: Array.from({ length: ticketCount }, () => ({
                status: "ok",
              })),
            }),
        }),
      });
      try {
        await host.addSubscription("ExponentPushToken[first]");
        await host.addSubscription("ExponentPushToken[second]");
        await host.harness.behavior.setSettings({
          webEnabled: false,
          desktopEnabled: false,
        });
        const thread = host.setThread();
        await expect(
          host.harness.behavior.callRpc("notifications.send", {
            threadId: thread.id,
            message: "Ready",
          }),
        ).resolves.toEqual({
          status: "failed",
          reason: "relay returned an unexpected number of tickets",
          delivered: {
            mobile: Math.min(ticketCount, 2),
            web: false,
            desktop: false,
          },
        });
      } finally {
        await host.cleanup();
      }
    },
  );

  it("rejects a non-success HTTP response even when its body contains successful tickets", async () => {
    const host = await setup({
      fetch: async () => ({
        ok: false,
        status: 502,
        text: async () => JSON.stringify({ data: [{ status: "ok" }] }),
      }),
    });
    try {
      await host.addSubscription();
      await host.harness.behavior.setSettings({
        webEnabled: false,
        desktopEnabled: false,
      });
      const thread = host.setThread();
      await expect(
        host.harness.behavior.callRpc("notifications.send", {
          threadId: thread.id,
          message: "Ready",
        }),
      ).resolves.toEqual({
        status: "failed",
        reason: "relay returned HTTP 502",
        delivered: { mobile: 0, web: false, desktop: false },
      });
    } finally {
      await host.cleanup();
    }
  });

  it.each([{ validIndexes: [0, 1] }, { validIndexes: [0, 100] }])(
    "classifies accepted and unregistered tickets independently of batch layout ($validIndexes)",
    async ({ validIndexes }) => {
      const host = await setup();
      try {
        for (let index = 0; index < 101; index += 1) {
          const token = `ExponentPushToken[${index}]`;
          await host.addSubscription(token);
          if (!validIndexes.includes(index))
            host.expo.ticketErrors.set(token, "DeviceNotRegistered");
        }
        await host.harness.behavior.setSettings({
          webEnabled: false,
          desktopEnabled: false,
        });
        const thread = host.setThread();
        await expect(
          host.harness.behavior.callRpc("notifications.send", {
            threadId: thread.id,
            message: "Ready",
          }),
        ).resolves.toEqual({
          status: "sent",
          delivered: { mobile: 2, web: false, desktop: false },
        });
        expect(host.expo.requests.map((batch) => batch.length)).toEqual([
          100, 1,
        ]);
      } finally {
        await host.cleanup();
      }
    },
  );

  it("maps undelivered outcomes through the CLI and RPC", async () => {
    const host = await setup();
    try {
      await host.harness.behavior.setSettings({
        mobileEnabled: false,
        webEnabled: false,
        desktopEnabled: false,
      });
      const thread = host.setThread({ id: "thread-mapping" });
      await expect(
        host.harness.behavior.callRpc("notifications.send", {
          threadId: thread.id,
          message: "Nothing",
        }),
      ).resolves.toEqual({
        status: "undelivered",
        delivered: { mobile: 0, web: false, desktop: false },
      });
      const cli = await host.harness.behavior.runCli(
        ["notify", "--message", "Nothing", "--json"],
        { threadId: thread.id },
      );
      expect(cli.exitCode).toBe(1);
      expect(JSON.parse(cli.stdout)).toMatchObject({
        ok: false,
        error: { code: "no_recipients" },
      });
    } finally {
      await host.cleanup();
    }
  });
});
