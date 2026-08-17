// Socket-level test that only manifests against a real `ws` handshake: when the
// gate rejects the upgrade with a non-auth status (e.g. a 502 Cloudflare returns
// mid-deploy), the tunnel must schedule a reconnect rather than sit in
// CONNECTING forever. Because a `unexpected-response` listener is registered, ws
// skips `abortHandshake`, so unless that branch tears the socket down itself no
// `error`/`close` fires and the backoff timer is never set. This runs against a
// real http server so it exercises the actual handshake path (the sibling
// tunnel-lifecycle test mocks `ws` and cannot observe this).
import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { ShareHostResolver } from "./hosts.js";
import { ShareRegistry } from "./shares.js";
import { ConnectTunnel } from "./tunnel.js";
import { DEFAULT_CONNECT_BASE_URL } from "./redeem.js";

function createTunnelFixture(serverUrl: string) {
  const fakeHost = createFakePluginHost({
    pluginId: "connect",
    sdk: {
      system: {
        config: async () => ({ primaryHostId: "host-server" }) as never,
      },
    },
  });
  const pluginBb = fakeHost.bb;
  const credential = { serverUrl, handle: "sawyer", credential: "bbcred_x" };
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
      clear: async () => {},
    },
    shares,
    defaultBaseUrl: DEFAULT_CONNECT_BASE_URL,
    getLoopbackBaseUrl: () => "http://127.0.0.1:38886",
    log: pluginBb.log,
    onStatusChange: vi.fn(),
  });
  return { fakeHost, tunnel };
}

describe("ConnectTunnel — non-auth handshake rejection", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  it("schedules a reconnect instead of stalling on a 502 handshake", async () => {
    const server = http.createServer();
    server.on("upgrade", (_req, socket) => {
      socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      socket.destroy();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;

    const { fakeHost, tunnel } = createTunnelFixture(`http://127.0.0.1:${port}`);
    cleanup = async () => {
      tunnel.stop();
      await fakeHost.harness.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    };

    await tunnel.start();

    // Without a socket teardown in the non-auth branch, no close fires and
    // nextRetryAt stays null forever.
    await vi.waitFor(
      () => {
        expect(tunnel.status().nextRetryAt).not.toBeNull();
      },
      { timeout: 3000 },
    );
    expect(tunnel.status().state).toBe("reconnecting");
  });
});
