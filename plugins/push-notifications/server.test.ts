import type { PluginThreadEventPayloads } from "@get-bb/plugin-sdk";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { EnvHttpProxyAgent } from "undici";
import { describe, expect, it, vi } from "vitest";
import {
  CLIENT_NOTIFICATION_CHANNEL,
  listPushSubscriptionsOutputSchema,
  THREAD_NOTIFICATIONS_CHANNEL,
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
}

async function setup(options: SetupOptions = {}) {
  const expo = options.expo ?? createFakeExpo();
  const threads = new Map<string, ThreadResponse>();
  const interactions = new Map<string, PendingInteraction[]>();
  const metadata = new Map<string, Record<string, unknown>>();
  let nextId = 1;
  const fake = createFakePluginHost({
    pluginId: "push-notifications",
    ...(options.appUrl === undefined ? {} : { appUrl: options.appUrl }),
    settings: { expoPushUrl: EXPO_URL },
    sdk: {
      system: {
        experimental_recordTelemetryEvent: async () => ({ ok: true }),
      },
      threads: {
        get: async ({ threadId }) => {
          const thread = threads.get(threadId);
          if (!thread) throw new Error("Thread not found");
          return thread;
        },
        experimental_listAncestors: async ({ threadIds }) => ({
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
    clientSignals: () => signals(CLIENT_NOTIFICATION_CHANNEL),
    levelUpdates: () =>
      signals(THREAD_NOTIFICATIONS_CHANNEL).map((signal) => signal.payload),
    expo,
    getLevel,
    interactions,
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
      await host.addSubscription("ExponentPushToken[tablet]", "Tablet");
      expect(
        host.harness.sdk.callsTo("system.experimental_recordTelemetryEvent"),
      ).toEqual([
        [
          {
            name: "device_paired",
            properties: { device: "mobile_ios", first_of_kind: true },
          },
        ],
        [
          {
            name: "device_paired",
            properties: { device: "mobile_ios", first_of_kind: false },
          },
        ],
      ]);

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

  it("lists resolved levels in one call and publishes the written thread", async () => {
    const host = await setup();
    try {
      const root = host.setThread({ id: "root" });
      host.setThread({ id: "child", parentThreadId: root.id });
      host.setThread({ id: "other" });

      await host.setLevel(root.id, "muted");
      await expect(
        host.listLevels(["root", "child", "other"]),
      ).resolves.toEqual({
        threads: {
          root: { own: "muted", ancestorCap: null },
          child: {
            own: "inherit",
            ancestorCap: { level: "muted", threadId: root.id },
          },
        },
      });
      expect(host.levelUpdates()).toEqual([
        {
          threadId: root.id,
          notifications: { own: "muted", ancestorCap: null },
        },
      ]);

      await host.setLevel(root.id, "inherit");
      expect(host.levelUpdates().at(-1)).toEqual({
        threadId: root.id,
        notifications: null,
      });
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
