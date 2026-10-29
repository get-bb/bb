import { describe, expect, it, vi } from "vitest";
import {
  parsePushNotificationData,
  resolvePushTargetProfile,
} from "./push-notification-target";

const sawyer = { id: "p1", serverUrl: "https://sawyer.getbb.app" };
const lan = { id: "p2", serverUrl: "http://192.168.1.20:3000" };

describe("parsePushNotificationData", () => {
  it("reads the thread id and optional project / server hints", () => {
    expect(
      parsePushNotificationData({ threadId: "thr_1", projectId: "prj_1" }),
    ).toEqual({
      threadId: "thr_1",
      projectId: "prj_1",
      serverUrl: null,
      subscriptionId: null,
    });
    expect(
      parsePushNotificationData({
        threadId: "thr_1",
        url: "https://sawyer.getbb.app/threads/thr_1",
        extra: 1,
      }),
    ).toEqual({
      threadId: "thr_1",
      projectId: null,
      serverUrl: "https://sawyer.getbb.app",
      subscriptionId: null,
    });
    expect(
      parsePushNotificationData({
        threadId: "thr_1",
        serverUrl: "https://home.example.com/bb/",
      }),
    ).toEqual({
      threadId: "thr_1",
      projectId: null,
      serverUrl: "https://home.example.com/bb",
      subscriptionId: null,
    });
  });

  it("reads a threadless payload that names its server", () => {
    expect(
      parsePushNotificationData({
        kind: "message",
        serverUrl: "https://sawyer.getbb.app",
      }),
    ).toEqual({
      threadId: null,
      projectId: null,
      serverUrl: "https://sawyer.getbb.app",
      subscriptionId: null,
    });
  });

  it("reads the registration a push was sent to", () => {
    expect(
      parsePushNotificationData({ kind: "message", subscriptionId: "sub-2" }),
    ).toEqual({
      threadId: null,
      projectId: null,
      serverUrl: null,
      subscriptionId: "sub-2",
    });
  });

  it("rejects payloads with neither a thread id nor a server", () => {
    expect(parsePushNotificationData({ projectId: "p" })).toBeNull();
    expect(parsePushNotificationData({ serverUrl: "not a url" })).toBeNull();
    expect(parsePushNotificationData("nope")).toBeNull();
    expect(parsePushNotificationData(undefined)).toBeNull();
  });
});

describe("resolvePushTargetProfile", () => {
  const target = {
    threadId: "thr_1",
    projectId: null,
    serverUrl: null,
    subscriptionId: null,
  };

  it("uses the server hint when it names a saved profile", async () => {
    const hasThread = vi.fn(async () => false);
    expect(
      await resolvePushTargetProfile(
        { ...target, serverUrl: "http://192.168.1.20:3000" },
        {
          profiles: [sawyer, lan],
          activeProfileId: "p1",
          registrations: {},
          hasThread,
        },
      ),
    ).toBe(lan);
    expect(hasThread).not.toHaveBeenCalled();
  });

  it("matches a server hint with a saved path prefix", async () => {
    const prefixed = {
      id: "p3",
      serverUrl: "https://home.example.com/bb",
    };
    const hasThread = vi.fn(async () => false);
    expect(
      await resolvePushTargetProfile(
        { ...target, serverUrl: "https://home.example.com/bb" },
        {
          profiles: [sawyer, prefixed],
          activeProfileId: "p1",
          registrations: {},
          hasThread,
        },
      ),
    ).toBe(prefixed);
    expect(hasThread).not.toHaveBeenCalled();
  });

  it("probes the only profile when no server hint matches", async () => {
    const hasThread = vi.fn(async () => true);
    expect(
      await resolvePushTargetProfile(target, {
        profiles: [sawyer],
        activeProfileId: null,
        registrations: {},
        hasThread,
      }),
    ).toBe(sawyer);
    expect(hasThread).toHaveBeenCalledWith(sawyer.serverUrl, "thr_1");
  });

  it("probes profiles when a server hint does not match", async () => {
    const hasThread = vi.fn(
      async (serverUrl: string) => serverUrl === lan.serverUrl,
    );
    expect(
      await resolvePushTargetProfile(
        { ...target, serverUrl: "https://unknown.example" },
        {
          profiles: [sawyer, lan],
          activeProfileId: "p1",
          registrations: {},
          hasThread,
        },
      ),
    ).toBe(lan);
    expect(hasThread).toHaveBeenCalledTimes(2);
  });

  it("probes the active profile first, then the others, tolerating failures", async () => {
    const hasThread = vi.fn(async (serverUrl: string) => {
      if (serverUrl === lan.serverUrl) throw new Error("offline");
      return serverUrl === sawyer.serverUrl;
    });
    expect(
      await resolvePushTargetProfile(target, {
        profiles: [sawyer, lan],
        activeProfileId: "p2",
        registrations: {},
        hasThread,
      }),
    ).toBe(sawyer);
    expect(hasThread.mock.calls.map(([url]) => url)).toEqual([
      lan.serverUrl,
      sawyer.serverUrl,
    ]);
  });

  it("opens a threadless push only on the server it names", async () => {
    const threadless = { ...target, threadId: null };
    const hasThread = vi.fn(async () => true);
    expect(
      await resolvePushTargetProfile(
        { ...threadless, serverUrl: "http://192.168.1.20:3000" },
        {
          profiles: [sawyer, lan],
          activeProfileId: "p1",
          registrations: {},
          hasThread,
        },
      ),
    ).toBe(lan);
    expect(
      await resolvePushTargetProfile(
        { ...threadless, serverUrl: "https://unknown.example" },
        {
          profiles: [sawyer],
          activeProfileId: "p1",
          registrations: {},
          hasThread,
        },
      ),
    ).toBeNull();
    expect(hasThread).not.toHaveBeenCalled();
  });

  it("opens the server whose push registration the push was sent to", async () => {
    const hasThread = vi.fn(async () => true);
    const registrations = {
      p1: { subscriptionId: "sub-1" },
      p2: { subscriptionId: "sub-2" },
    };
    expect(
      await resolvePushTargetProfile(
        {
          ...target,
          serverUrl: "https://sawyer.getbb.app",
          subscriptionId: "sub-2",
        },
        {
          profiles: [sawyer, lan],
          activeProfileId: "p1",
          registrations,
          hasThread,
        },
      ),
    ).toBe(lan);
    expect(
      await resolvePushTargetProfile(
        { ...target, threadId: null, subscriptionId: "sub-1" },
        {
          profiles: [sawyer, lan],
          activeProfileId: "p2",
          registrations,
          hasThread,
        },
      ),
    ).toBe(sawyer);
    expect(hasThread).not.toHaveBeenCalled();
    expect(
      await resolvePushTargetProfile(
        { ...target, subscriptionId: "sub-gone" },
        {
          profiles: [sawyer, lan],
          activeProfileId: "p2",
          registrations,
          hasThread,
        },
      ),
    ).toBe(lan);
    expect(hasThread).toHaveBeenCalledTimes(1);
  });

  it("gives up when no server has the thread", async () => {
    expect(
      await resolvePushTargetProfile(target, {
        profiles: [sawyer, lan],
        activeProfileId: "p1",
        registrations: {},
        hasThread: async () => false,
      }),
    ).toBeNull();
  });
});
