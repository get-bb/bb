import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { ShareHostResolver } from "./hosts.js";
import { ShareRegistry } from "./shares.js";

interface FakeTunnelSocket {
  emit(eventName: string, ...args: unknown[]): boolean;
}

const fakeWebSockets = vi.hoisted(() => ({
  instances: [] as FakeTunnelSocket[],
}));

vi.mock("ws", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ws")>();
  const { EventEmitter } = await import("node:events");

  class FakeWebSocket extends EventEmitter {
    readyState = 0;

    constructor() {
      super();
      fakeWebSockets.instances.push(this);
    }

    terminate(): void {
      this.readyState = 3;
    }
  }

  return { ...actual, WebSocket: FakeWebSocket };
});

import { ConnectTunnel } from "./tunnel.js";
import { DEFAULT_CONNECT_BASE_URL } from "./redeem.js";

function createTunnelFixture() {
  const fakeHost = createFakePluginHost({
    pluginId: "connect",
    sdk: {
      system: {
        config: async () => ({ primaryHostId: "host-server" }) as never,
      },
    },
  });
  const pluginBb = fakeHost.bb;
  const credential = {
    serverUrl: "https://sawyer.getbb.app",
    handle: "sawyer",
    credential: "bbcred_x",
  };
  const clearCredential = vi.fn(async () => {});
  const onStatusChange = vi.fn();
  const shares = new ShareRegistry({
    kv: {
      get: async () => undefined,
      set: async () => {},
      delete: async () => {},
    },
    hosts: pluginBb.hosts,
    hostResolver: new ShareHostResolver(() => pluginBb.sdk),
    getLoopbackBaseUrl: () => "http://127.0.0.1:38886",
    getCredential: () => credential,
    log: pluginBb.log,
  });
  const tunnel = new ConnectTunnel({
    store: {
      read: async () => credential,
      write: async () => {},
      clear: clearCredential,
    },
    shares,
    defaultBaseUrl: DEFAULT_CONNECT_BASE_URL,
    getLoopbackBaseUrl: () => "http://127.0.0.1:38886",
    log: pluginBb.log,
    onStatusChange,
  });
  return {
    clearCredential,
    credential,
    fakeHost,
    onStatusChange,
    tunnel,
  };
}

describe("ConnectTunnel socket lifecycle", () => {
  afterEach(() => {
    fakeWebSockets.instances.length = 0;
  });

  it("ignores events from a socket after the tunnel stops", async () => {
    const { clearCredential, credential, fakeHost, onStatusChange, tunnel } =
      createTunnelFixture();

    try {
      await tunnel.start();
      await vi.waitFor(() => {
        expect(onStatusChange).toHaveBeenCalledTimes(2);
      });
      expect(fakeWebSockets.instances).toHaveLength(1);

      tunnel.stop();
      onStatusChange.mockClear();
      const socket = fakeWebSockets.instances[0]!;
      socket.emit("open");
      socket.emit("unexpected-response", {}, { statusCode: 401 });
      socket.emit("error", new Error("late socket error"));
      socket.emit("close", 1006, Buffer.from("late close"));

      expect(clearCredential).not.toHaveBeenCalled();
      expect(onStatusChange).not.toHaveBeenCalled();
      expect(tunnel.getCredential()).toEqual(credential);
      expect(tunnel.status().lastError).toBeNull();
    } finally {
      tunnel.stop();
      await fakeHost.harness.dispose();
    }
  });

  it("does not let a replaced socket close the current session", async () => {
    const { fakeHost, tunnel } = createTunnelFixture();

    try {
      await tunnel.start();
      expect(fakeWebSockets.instances).toHaveLength(1);
      const replacedSocket = fakeWebSockets.instances[0]!;

      tunnel.stop();
      await tunnel.start();
      expect(fakeWebSockets.instances).toHaveLength(2);
      const currentSocket = fakeWebSockets.instances[1]!;
      currentSocket.emit("open");
      expect(tunnel.status().state).toBe("connected");

      replacedSocket.emit("close", 1006, Buffer.from("late close"));

      expect(tunnel.status().state).toBe("connected");
    } finally {
      tunnel.stop();
      await fakeHost.harness.dispose();
    }
  });
});
