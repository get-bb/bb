import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import {
  createPushSender,
  type ExpoPushMessage,
  type PushSenderFetch,
} from "./sender.js";
import { createPushSubscriptionStore } from "./subscriptions.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function setupSender({ start = true }: { start?: boolean } = {}) {
  const thread = makeThreadResponse({
    id: "thread-1",
    projectId: "project-1",
    status: "idle",
  });
  const host = createFakePluginHost({
    pluginId: "push-notifications",
    sdk: { threads: { get: async () => thread } },
  });
  const subscriptions = createPushSubscriptionStore(host.bb);
  await subscriptions.add({
    expoPushToken: "ExponentPushToken[phone]",
    platform: "ios",
    deviceLabel: "Phone",
  });
  let config = {
    mobileEnabled: true,
    webEnabled: true,
    desktopEnabled: true,
    expoPushUrl: "http://expo.test/push",
    agentNotifications: true,
    agentNotifyCooldownMinutes: "0",
  };
  const getSettings = vi.fn(async () => ({ ...config }));
  const requests: ExpoPushMessage[][] = [];
  const urls: string[] = [];
  const dispatchers: Parameters<PushSenderFetch>[1]["dispatcher"][] = [];
  const fetch = vi.fn<PushSenderFetch>(async (url, init) => {
    const messages: ExpoPushMessage[] = JSON.parse(init.body);
    requests.push(messages);
    urls.push(url);
    dispatchers.push(init.dispatcher);
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ data: messages.map(() => ({ status: "ok" })) }),
    };
  });
  const sender = createPushSender({
    bb: host.bb,
    subscriptions,
    getSettings,
    getNotificationLevel: async () => "all",
    fetch,
  });
  if (start) await sender.start();
  return {
    ...host,
    sender,
    subscriptions,
    getSettings,
    requests,
    urls,
    dispatchers,
    fetch,
    setConfig(patch: Partial<typeof config>) {
      config = { ...config, ...patch };
    },
    send: () => sender.sendNow({ threadId: thread.id, message: "Ready" }),
    async cleanup() {
      await sender.stop();
      await host.harness.lifecycle.dispose();
    },
  };
}

describe("push sender dispatch admission and lifecycle", () => {
  it("drains every admitted batch before restarting with a new dispatcher", async () => {
    const host = await setupSender();
    const reached = deferred();
    const release = deferred();
    try {
      for (let index = 1; index < 201; index += 1) {
        await host.subscriptions.add({
          expoPushToken: `ExponentPushToken[${index}]`,
          platform: "ios",
          deviceLabel: `Phone ${index}`,
        });
      }
      const fetch = host.fetch.getMockImplementation()!;
      host.fetch.mockImplementationOnce(async (...args) => {
        const response = await fetch(...args);
        reached.resolve();
        await release.promise;
        return response;
      });
      const sending = host.send();
      await reached.promise;
      let stopped = false;
      let restarted = false;
      const stopping = host.sender.stop().then(() => {
        stopped = true;
      });
      const restarting = host.sender.start().then(() => {
        restarted = true;
      });
      host.setConfig({ expoPushUrl: "http://new-relay.test/push" });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(stopped).toBe(false);
      expect(restarted).toBe(false);
      expect(host.requests.map((batch) => batch.length)).toEqual([100]);
      release.resolve();
      await expect(sending).resolves.toEqual({
        status: "sent",
        mobile: 201,
        web: true,
        desktop: true,
      });
      await Promise.all([stopping, restarting]);
      expect(host.requests.map((batch) => batch.length)).toEqual([100, 100, 1]);
      expect(host.urls).toEqual(Array(3).fill("http://expo.test/push"));
      expect(
        host.dispatchers.every(
          (dispatcher) => dispatcher === host.dispatchers[0],
        ),
      ).toBe(true);
      await expect(host.send()).resolves.toMatchObject({
        status: "sent",
        mobile: 201,
      });
      expect(host.urls.slice(3)).toEqual(
        Array(3).fill("http://new-relay.test/push"),
      );
      expect(host.dispatchers[3]).not.toBe(host.dispatchers[0]);
    } finally {
      release.resolve();
      await host.cleanup();
    }
  });

  it("recovers from failed startup without admitting old-run work", async () => {
    const host = await setupSender({ start: false });
    const reached = deferred();
    const release = deferred();
    vi.spyOn(host.bb.storage.kv, "get").mockImplementationOnce(async () => {
      reached.resolve();
      await release.promise;
      throw new Error("startup storage down");
    });
    try {
      const failed = host.sender.start();
      const rejection = expect(failed).rejects.toThrow("startup storage down");
      await reached.promise;
      const stale = host.send();
      const recovered = host.sender.start();
      release.resolve();
      await rejection;
      await recovered;
      await expect(stale).resolves.toEqual({
        status: "refused",
        reason: "sender-stopped",
      });
      expect(host.requests).toHaveLength(0);
      await expect(host.send()).resolves.toMatchObject({
        status: "sent",
        mobile: 1,
      });
    } finally {
      release.resolve();
      vi.restoreAllMocks();
      await host.cleanup();
    }
  });

  it("remains usable after concurrent starts and repeated stop/start cycles", async () => {
    const host = await setupSender({ start: false });
    try {
      for (let cycle = 0; cycle < 3; cycle += 1) {
        await Promise.all([
          host.sender.start(),
          host.sender.start(),
          host.sender.start(),
        ]);
        await expect(host.send()).resolves.toMatchObject({
          status: "sent",
          mobile: 1,
        });
        await Promise.all([host.sender.stop(), host.sender.stop()]);
        await expect(host.send()).resolves.toEqual({
          status: "refused",
          reason: "sender-stopped",
        });
      }
      expect(host.requests).toHaveLength(3);
      expect(new Set(host.dispatchers).size).toBe(3);
    } finally {
      await host.cleanup();
    }
  });

  it.each(["agent", "channels"] as const)(
    "honours changes to %s policy while recipients are loading",
    async (policy) => {
      const host = await setupSender();
      const reached = deferred();
      const release = deferred();
      const list = host.subscriptions.list.bind(host.subscriptions);
      vi.spyOn(host.subscriptions, "list").mockImplementationOnce(async () => {
        const rows = await list();
        reached.resolve();
        await release.promise;
        return rows;
      });
      try {
        const pending = host.send();
        await reached.promise;
        host.setConfig(
          policy === "agent"
            ? { agentNotifications: false }
            : {
                mobileEnabled: false,
                webEnabled: false,
                desktopEnabled: false,
              },
        );
        release.resolve();
        await expect(pending).resolves.toEqual(
          policy === "agent"
            ? { status: "refused", reason: "disabled" }
            : { status: "undelivered", mobile: 0, web: false, desktop: false },
        );
        expect(host.requests).toHaveLength(0);
        expect(host.harness.realtimeSignals).toHaveLength(0);
      } finally {
        release.resolve();
        vi.restoreAllMocks();
        await host.cleanup();
      }
    },
  );

  it("excludes devices removed before recipient selection", async () => {
    const host = await setupSender();
    try {
      host.setConfig({ webEnabled: false, desktopEnabled: false });
      const rows = await host.subscriptions.list();
      for (const row of rows) await host.subscriptions.remove(row.id);
      await expect(host.send()).resolves.toEqual({
        status: "undelivered",
        mobile: 0,
        web: false,
        desktop: false,
      });
      expect(host.requests).toHaveLength(0);
    } finally {
      await host.cleanup();
    }
  });

  it("drains queued sends, rejects old admission, and serializes an overlapping restart", async () => {
    const host = await setupSender();
    const reached = deferred();
    const release = deferred();
    const getSettings = host.getSettings.getMockImplementation()!;
    host.getSettings.mockImplementationOnce(async () => {
      const config = await getSettings();
      reached.resolve();
      await release.promise;
      return config;
    });
    try {
      const first = host.send();
      const queued = host.send();
      await reached.promise;
      let stopped = false;
      let started = false;
      const stopping = host.sender.stop().then(() => {
        stopped = true;
      });
      const starting = host.sender.start().then(() => {
        started = true;
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(stopped).toBe(false);
      expect(started).toBe(false);
      release.resolve();
      await expect(first).resolves.toEqual({
        status: "refused",
        reason: "sender-stopped",
      });
      await expect(queued).resolves.toEqual({
        status: "refused",
        reason: "sender-stopped",
      });
      await Promise.all([stopping, starting]);
      expect(host.requests).toHaveLength(0);
      expect(host.harness.realtimeSignals).toHaveLength(0);
      await expect(host.send()).resolves.toEqual({
        status: "sent",
        mobile: 1,
        web: true,
        desktop: true,
      });
      expect(host.requests).toHaveLength(1);
    } finally {
      release.resolve();
      await host.cleanup();
    }
  });
});
