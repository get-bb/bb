import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildFrpcConfig,
  createFrpcAdmin,
  loopbackTarget,
  parseTunnelServer,
  tunnelServerUrl,
  writeFrpcConfig,
} from "../src/config.js";

describe("parseTunnelServer", () => {
  it("has no override when unset, so the account decides", () => {
    expect(parseTunnelServer(undefined)).toBeNull();
    expect(parseTunnelServer("  ")).toBeNull();
    expect(
      tunnelServerUrl({
        protocol: "wss",
        host: "tunnel.next.getbb.app",
        port: 443,
      }),
    ).toBe("wss://tunnel.next.getbb.app/~!frp");
  });

  it("accepts ws:// and wss:// overrides", () => {
    expect(parseTunnelServer("ws://127.0.0.1:7000")).toEqual({
      protocol: "websocket",
      host: "127.0.0.1",
      port: 7000,
    });
    expect(parseTunnelServer("wss://staging.example:8443/~!frp")).toEqual({
      protocol: "wss",
      host: "staging.example",
      port: 8443,
    });
    expect(parseTunnelServer("ws://gate.internal")).toMatchObject({ port: 80 });
  });

  it("rejects other schemes and paths", () => {
    expect(() => parseTunnelServer("https://x.example")).toThrow(
      /ws:\/\/ or wss:\/\//u,
    );
    expect(() => parseTunnelServer("not a url")).toThrow(/ws:\/\//u);
    expect(() => parseTunnelServer("wss://x.example/other")).toThrow(
      /cannot choose a path/u,
    );
  });
});

const MAIN_PROXY = {
  name: "bb",
  subdomain: "sawyer",
  localIP: "127.0.0.1",
  localPort: 41234,
  hostHeaderRewrite: null,
};

describe("buildFrpcConfig", () => {
  it("lists each proxy and the loopback admin server", () => {
    expect(
      buildFrpcConfig({
        server: { protocol: "wss", host: "tunnel.next.getbb.app", port: 443 },
        user: "sawyer",
        credential: "bbcred_1",
        proxies: [
          MAIN_PROXY,
          {
            name: "share-5173",
            subdomain: "sawyer--5173",
            localIP: "127.0.0.1",
            localPort: 5173,
            hostHeaderRewrite: "127.0.0.1:5173",
          },
        ],
        trustedCaFile: "/data/frp/roots.pem",
        admin: { port: 40001, user: "bb-u", password: "secret" },
      }),
    ).toEqual({
      serverAddr: "tunnel.next.getbb.app",
      serverPort: 443,
      user: "sawyer",
      loginFailExit: false,
      metadatas: { credential: "bbcred_1" },
      log: { to: "console", level: "info", disablePrintColor: true },
      webServer: {
        addr: "127.0.0.1",
        port: 40001,
        user: "bb-u",
        password: "secret",
      },
      transport: {
        protocol: "wss",
        poolCount: 10,
        tls: {
          enable: true,
          serverName: "tunnel.next.getbb.app",
          trustedCaFile: "/data/frp/roots.pem",
        },
      },
      proxies: [
        {
          name: "bb",
          type: "http",
          localIP: "127.0.0.1",
          localPort: 41234,
          subdomain: "sawyer",
        },
        {
          name: "share-5173",
          type: "http",
          localIP: "127.0.0.1",
          localPort: 5173,
          subdomain: "sawyer--5173",
          hostHeaderRewrite: "127.0.0.1:5173",
        },
      ],
    });
  });

  it("refuses a proxy target that is not plain loopback http", () => {
    expect(loopbackTarget("http://127.0.0.1:41234")).toEqual({
      localIP: "127.0.0.1",
      localPort: 41234,
    });
    expect(loopbackTarget("http://[::1]:41234")).toEqual({
      localIP: "::1",
      localPort: 41234,
    });
    expect(() => loopbackTarget("https://127.0.0.1:41234")).toThrow(
      /plain http/u,
    );
  });

  it("gives every admin server its own port and password", async () => {
    const [first, second] = await Promise.all([
      createFrpcAdmin(),
      createFrpcAdmin(),
    ]);
    expect(first.port).toBeGreaterThan(0);
    expect(first.password).not.toBe(second.password);
    expect(first.password.length).toBeGreaterThanOrEqual(32);
    expect(first.user).not.toBe(second.user);
  });

  it.skipIf(process.platform === "win32")(
    "writes the config readable only by its owner, even over a looser file",
    async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "frp-client-cfg-"));
      const file = path.join(dir, "frp", "frpc.json");
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, "{}", { mode: 0o644 });
      await writeFrpcConfig(
        file,
        buildFrpcConfig({
          server: { protocol: "wss", host: "tunnel.next.getbb.app", port: 443 },
          user: "sawyer",
          credential: "bbcred_1",
          proxies: [MAIN_PROXY],
          trustedCaFile: null,
          admin: null,
        }),
      );
      expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
      await fs.rm(dir, { recursive: true, force: true });
    },
  );
});
