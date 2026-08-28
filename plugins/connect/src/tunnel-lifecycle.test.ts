import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { WebSocket as NodeWebSocket, WebSocketServer } from "ws";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { ShareHostResolver } from "./hosts.js";
import { ShareRegistry } from "./shares.js";

import { ConnectTunnel } from "./tunnel.js";
import { DEFAULT_CONNECT_BASE_URL } from "./redeem.js";

interface TunnelServer {
  http: Server;
  sockets: NodeWebSocket[];
  ws: WebSocketServer | null;
}

function isAddressInfo(
  address: string | AddressInfo | null,
): address is AddressInfo {
  return address !== null && Object(address) === address;
}

async function createTunnelServer(
  mode: "open" | "reject" = "open",
): Promise<TunnelServer & { port: number }> {
  const sockets: NodeWebSocket[] = [];
  const http = createServer(
    mode === "reject"
      ? (_request, response) => {
          response.writeHead(500);
          response.end();
        }
      : undefined,
  );
  const ws = mode === "open" ? new WebSocketServer({ server: http }) : null;
  ws?.on("connection", (socket) => sockets.push(socket));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  if (!isAddressInfo(address)) {
    throw new Error("Tunnel test server did not expose a TCP address");
  }
  return { http, port: address.port, sockets, ws };
}

async function closeTunnelServer(server: TunnelServer): Promise<void> {
  for (const socket of server.sockets) socket.terminate();
  server.ws?.close();
  await new Promise<void>((resolve) => server.http.close(() => resolve()));
}

async function createTunnelFixture(mode: "open" | "reject" = "open") {
  const tunnelServer = await createTunnelServer(mode);
  const fakeHost = createFakePluginHost({
    pluginId: "connect",
    sdk: {
      system: {
        // SAFETY: The fake host accepts this minimal configuration for the connect test.
        config: async () => ({ primaryHostId: "host-server" }) as never,
      },
    },
  });
  const pluginBb = fakeHost.bb;
  const credential = {
    serverUrl: `http://127.0.0.1:${tunnelServer.port}`,
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
    dispose: () => closeTunnelServer(tunnelServer),
    tunnelServer,
    tunnel,
  };
}

async function waitForSocket(server: TunnelServer): Promise<NodeWebSocket> {
  await vi.waitFor(() => expect(server.sockets).toHaveLength(1));
  const socket = server.sockets[0];
  if (!socket) throw new Error("Tunnel test server did not receive a socket");
  return socket;
}

describe("ConnectTunnel socket lifecycle", () => {
  it("ignores a socket close after the tunnel stops", async () => {
    const {
      clearCredential,
      credential,
      dispose,
      fakeHost,
      onStatusChange,
      tunnel,
      tunnelServer,
    } = await createTunnelFixture();

    try {
      await tunnel.start();
      const socket = await waitForSocket(tunnelServer);
      await vi.waitFor(() => {
        expect(tunnel.status().state).toBe("connected");
      });

      const socketClosed = new Promise<void>((resolve) => {
        socket.once("close", () => resolve());
      });
      tunnel.stop();
      onStatusChange.mockClear();
      await socketClosed;

      expect(clearCredential).not.toHaveBeenCalled();
      expect(onStatusChange).not.toHaveBeenCalled();
      expect(tunnel.getCredential()).toEqual(credential);
      expect(tunnel.status().lastError).toBeNull();
    } finally {
      tunnel.stop();
      await fakeHost.harness.dispose();
      await dispose();
    }
  });

  it("does not let a replaced socket close the current session", async () => {
    const { dispose, fakeHost, tunnel, tunnelServer } =
      await createTunnelFixture();

    try {
      await tunnel.start();
      const replacedSocket = await waitForSocket(tunnelServer);

      tunnel.stop();
      await tunnel.start();
      await vi.waitFor(() => expect(tunnelServer.sockets).toHaveLength(2));
      expect(tunnel.status().state).toBe("connected");

      replacedSocket.terminate();

      expect(tunnel.status().state).toBe("connected");
    } finally {
      tunnel.stop();
      await fakeHost.harness.dispose();
      await dispose();
    }
  });

  it("retries when the handshake never completes within the deadline", async () => {
    vi.useFakeTimers();
    const { dispose, fakeHost, tunnel } = await createTunnelFixture();

    try {
      await tunnel.start();
      await vi.advanceTimersByTimeAsync(15_000);

      expect(tunnel.status().lastError).toContain("handshake timed out");
      const nextRetryAt = tunnel.status().nextRetryAt;
      expect(nextRetryAt).not.toBeNull();

      await vi.advanceTimersByTimeAsync(nextRetryAt! - Date.now());
    } finally {
      tunnel.stop();
      vi.useRealTimers();
      await fakeHost.harness.dispose();
      await dispose();
    }
  });

  it("retries an HTTP rejection without waiting for close", async () => {
    vi.useFakeTimers();
    const { dispose, fakeHost, tunnel } = await createTunnelFixture("reject");

    try {
      await tunnel.start();
      await vi.waitFor(() =>
        expect(tunnel.status().lastError).toContain("HTTP 500"),
      );
      expect(tunnel.status().lastError).toBe("tunnel rejected: HTTP 500");
      const nextRetryAt = tunnel.status().nextRetryAt;
      expect(nextRetryAt).not.toBeNull();

      await vi.advanceTimersByTimeAsync(nextRetryAt! - Date.now());

      expect(tunnel.status().nextRetryAt).toBeNull();
    } finally {
      tunnel.stop();
      vi.useRealTimers();
      await fakeHost.harness.dispose();
      await dispose();
    }
  });

  it("schedules one retry after an HTTP rejection closes the socket", async () => {
    vi.useFakeTimers();
    const { dispose, fakeHost, tunnel } = await createTunnelFixture("reject");

    try {
      await tunnel.start();
      await vi.waitFor(() =>
        expect(tunnel.status().lastError).toContain("HTTP 500"),
      );
      const nextRetryAt = tunnel.status().nextRetryAt;
      expect(nextRetryAt).not.toBeNull();

      expect(tunnel.status().nextRetryAt).toBe(nextRetryAt);
      await vi.advanceTimersByTimeAsync(nextRetryAt! - Date.now());
    } finally {
      tunnel.stop();
      vi.useRealTimers();
      await fakeHost.harness.dispose();
      await dispose();
    }
  });
});
