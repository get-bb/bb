import { createServer, type Server } from "node:http";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket as NodeWebSocket, WebSocketServer } from "ws";
import {
  createFakePluginHost,
  type FakePluginHost,
} from "@get-bb/plugin-sdk/testing";
import { decodeFrame, encodeFrame, type Frame } from "@bb/tunnel-contract";
import {
  headersForLoopbackRequest,
  isBareBbRealtimeWs,
  TunnelSession,
} from "@bb/tunnel-client";
import { deriveConnectBaseUrl, serverUrlForHandle } from "@bb/connect-client";
import {
  parseSharePort,
  machineSharePublicUrl,
  SharePortError,
  ShareRegistry,
  sharePublicUrl,
  SHARES_KV_KEY,
  serverOwnPort,
} from "./shares.js";
import plugin from "./server.js";
import { createConnectPlugin } from "./plugin.js";
import { ConnectTunnel } from "./tunnel.js";
import {
  DEFAULT_CONNECT_BASE_URL,
  resolveDefaultConnectBaseUrl,
} from "./base-url.js";
import type { ConnectStatus } from "./types.js";
import { ShareHostResolver } from "./hosts.js";
import { LEGACY_CREDENTIAL_KV_KEY } from "./legacy-credential.js";
import { FakeAccount, TEST_ACCOUNT } from "./testing/fake-account.js";

const SERVER_HOST_ID = "host-server";
const SERVER_HOST_NAME = "Server";
const REMOTE_HOST_ID = "host-air";
const REMOTE_HOST_NAME = "Sawyer Air";

function createConnectFakeHost(options?: {
  remoteIdentity?: { label: string; baseDomain: string };
  mobileApp?: boolean;
  account?: FakeAccount;
}): FakePluginHost {
  const account = options?.account ?? new FakeAccount();
  return createFakePluginHost({
    pluginId: "connect",
    sdk: {
      plugins: {
        callRpc: account.callRpc as never,
      },
      system: {
        config: async () =>
          ({
            primaryHostId: SERVER_HOST_ID,
            experiments: { mobileApp: options?.mobileApp ?? true },
          }) as never,
      },
      hosts: {
        get: async ({ hostId }: { hostId: string }) => {
          const host =
            hostId === SERVER_HOST_ID
              ? { id: SERVER_HOST_ID, name: SERVER_HOST_NAME }
              : hostId === REMOTE_HOST_ID
                ? { id: REMOTE_HOST_ID, name: REMOTE_HOST_NAME }
                : null;
          if (!host) {
            throw Object.assign(new Error(`host ${hostId} not found`), {
              status: 404,
            });
          }
          return host as never;
        },
        list: async () =>
          [
            { id: SERVER_HOST_ID, name: SERVER_HOST_NAME },
            { id: REMOTE_HOST_ID, name: REMOTE_HOST_NAME },
          ] as never,
      },
    },
    ...(options?.remoteIdentity
      ? {
          sharedPortTunnelIdentities: {
            [REMOTE_HOST_ID]: options.remoteIdentity,
          },
        }
      : {}),
  });
}

describe("deriveConnectBaseUrl", () => {
  it("drops the handle label to reach the apex", () => {
    expect(deriveConnectBaseUrl("https://sawyer.getbb.app")).toBe(
      "https://getbb.app",
    );
    expect(deriveConnectBaseUrl("https://my-box.vibecodethis.site/")).toBe(
      "https://vibecodethis.site",
    );
  });
});

describe("resolveDefaultConnectBaseUrl", () => {
  it("uses the local Cloud origin only in development", () => {
    expect(
      resolveDefaultConnectBaseUrl({
        NODE_ENV: "development",
        BB_DEV_CONNECT_BASE_URL: "http://bb.localhost:42745/",
      }),
    ).toBe("http://bb.localhost:42745");
    expect(
      resolveDefaultConnectBaseUrl({
        NODE_ENV: "production",
        BB_DEV_CONNECT_BASE_URL: "http://bb.localhost:42745",
      }),
    ).toBe(DEFAULT_CONNECT_BASE_URL);
    expect(resolveDefaultConnectBaseUrl({ NODE_ENV: "development" })).toBe(
      DEFAULT_CONNECT_BASE_URL,
    );
    expect(
      resolveDefaultConnectBaseUrl({
        NODE_ENV: "development",
        BB_DEV_CONNECT_BASE_URL: "https://vibecodethis.site/",
      }),
    ).toBe("https://vibecodethis.site");
  });

  it("rejects non-local or non-origin development values", () => {
    for (const value of [
      "https://bb.localhost:42745",
      "http://getbb.app:42745",
      "http://bb.localhost:42745/dashboard",
      "http://vibecodethis.site",
      "https://sawyer.vibecodethis.site",
      "https://vibecodethis.site/dashboard",
      "not a url",
    ]) {
      expect(() =>
        resolveDefaultConnectBaseUrl({
          NODE_ENV: "development",
          BB_DEV_CONNECT_BASE_URL: value,
        }),
      ).toThrow(
        "BB_DEV_CONNECT_BASE_URL must be an http://bb.localhost:<port> origin or https://vibecodethis.site",
      );
    }
  });
});

describe("serverUrlForHandle", () => {
  it("prepends the handle label to the apex", () => {
    expect(serverUrlForHandle("https://getbb.app", "sawyer")).toBe(
      "https://sawyer.getbb.app",
    );
  });
});

describe("headersForLoopbackRequest", () => {
  it("rewrites the paired connect origin to the loopback app origin only", () => {
    expect(
      headersForLoopbackRequest(
        [
          ["Origin", "https://sawyer.getbb.app"],
          ["Content-Type", "application/json"],
          ["Host", "sawyer.getbb.app"],
        ],
        {
          publicOrigin: "https://sawyer.getbb.app",
          loopbackOrigin: "http://127.0.0.1:38886",
        },
      ),
    ).toEqual({
      Origin: "http://127.0.0.1:38886",
      "Content-Type": "application/json",
    });

    expect(
      headersForLoopbackRequest([["Origin", "https://evil.example"]], {
        publicOrigin: "https://sawyer.getbb.app",
        loopbackOrigin: "http://127.0.0.1:38886",
      }),
    ).toEqual({ Origin: "https://evil.example" });
  });

  it("injects Host and rewrites share Origin for share streams", () => {
    expect(
      headersForLoopbackRequest(
        [
          ["Origin", "https://sawyer--8000.getbb.app"],
          ["Content-Type", "text/plain"],
          ["Host", "sawyer--8000.getbb.app"],
        ],
        {
          publicOrigin: "https://sawyer--8000.getbb.app",
          loopbackOrigin: "http://127.0.0.1:8000",
          host: "127.0.0.1:8000",
        },
      ),
    ).toEqual({
      Origin: "http://127.0.0.1:8000",
      "Content-Type": "text/plain",
      Host: "127.0.0.1:8000",
    });
  });
});

describe("sharePublicUrl", () => {
  it("builds https://handle--port.base from the credential serverUrl", () => {
    expect(
      sharePublicUrl(
        { serverUrl: "https://sawyer.getbb.app", handle: "sawyer" },
        8000,
      ),
    ).toBe("https://sawyer--8000.getbb.app");
  });

  it("uses a non-primary routing label when multi-server pairing stored one", () => {
    expect(
      sharePublicUrl(
        {
          serverUrl: "https://sawyer-desktop.getbb.app",
          handle: "sawyer-desktop",
        },
        8000,
      ),
    ).toBe("https://sawyer-desktop--8000.getbb.app");
  });

  it("uses HTTP and the local port for machine shares in local Cloud", () => {
    expect(
      machineSharePublicUrl(
        { label: "sawyer-air", baseDomain: "bb.localhost:42745" },
        8000,
      ),
    ).toBe("http://sawyer-air--8000.bb.localhost:42745");
  });
});

describe("parseSharePort / serverOwnPort", () => {
  it("accepts integers 1–65535 and rejects the rest", () => {
    expect(parseSharePort(80)).toBe(80);
    expect(parseSharePort("5173")).toBe(5173);
    expect(() => parseSharePort(0)).toThrow(SharePortError);
    expect(() => parseSharePort(65536)).toThrow(SharePortError);
    expect(() => parseSharePort(3.5)).toThrow(SharePortError);
    expect(() => parseSharePort("nope")).toThrow(SharePortError);
  });

  it("reads the bb server port from the loopback base URL", () => {
    expect(serverOwnPort("http://127.0.0.1:38886")).toBe(38886);
    expect(serverOwnPort("http://127.0.0.1")).toBe(80);
  });
});

describe("ShareRegistry", () => {
  it("persists shares in kv and refuses the server's own port", async () => {
    const kv = new Map<string, unknown>();
    const store = {
      async get<T>(key: string) {
        return kv.get(key) as T | undefined;
      },
      async set(key: string, value: unknown) {
        kv.set(key, value);
      },
      async delete(key: string) {
        kv.delete(key);
      },
    };
    const credential = {
      serverUrl: "https://sawyer.getbb.app",
      handle: "sawyer",
      credential: "bbcred_x",
    };
    const fakeHost = createFakePluginHost({
      sdk: {
        system: {
          config: async () => ({ primaryHostId: "host-server" }) as never,
        },
        hosts: {
          get: async () => ({ id: "host-server", name: "Server" }) as never,
        },
      },
    });
    const pluginBb = fakeHost.bb as unknown as Parameters<typeof plugin>[0];
    const hostResolver = new ShareHostResolver(() => pluginBb.sdk);
    const serverHost = {
      id: "host-server",
      name: "Server",
      isServer: true,
    };
    const registry = new ShareRegistry({
      kv: store,
      hosts: pluginBb.hosts,
      hostResolver,
      getLoopbackBaseUrl: () => "http://127.0.0.1:38886",
      getIdentity: () => credential,
      log: pluginBb.log,
    });
    await registry.load();

    await expect(registry.add(38886, serverHost)).rejects.toThrow(/own port/);

    const added = await registry.add(8000, serverHost);
    expect(added.url).toBe("https://sawyer--8000.getbb.app");
    expect(registry.hasServerPort(8000)).toBe(true);
    expect(kv.get(SHARES_KV_KEY)).toMatchObject({
      "host-server:8000": { hostId: "host-server", port: 8000 },
    });

    const reloaded = new ShareRegistry({
      kv: store,
      hosts: pluginBb.hosts,
      hostResolver,
      getLoopbackBaseUrl: () => "http://127.0.0.1:38886",
      getIdentity: () => credential,
      log: pluginBb.log,
    });
    await reloaded.load();
    expect(await reloaded.list()).toEqual([
      {
        hostId: "host-server",
        hostName: "Server",
        port: 8000,
        url: "https://sawyer--8000.getbb.app",
        createdAt: expect.any(Number),
      },
    ]);

    expect(await reloaded.remove(8000, "host-server")).toMatchObject({
      removed: true,
      hostId: "host-server",
    });
    expect(await reloaded.remove(8000, "host-server")).toMatchObject({
      removed: false,
      hostId: "host-server",
    });
    expect(kv.has(SHARES_KV_KEY)).toBe(false);
    await fakeHost.harness.dispose();
  });

  it("loads legacy entries without hostId as server-host shares", async () => {
    const kv = new Map<string, unknown>([
      [SHARES_KV_KEY, { "3000": { port: 3000, createdAt: 123 } }],
    ]);
    const fakeHost = createConnectFakeHost();
    const pluginBb = fakeHost.bb as unknown as Parameters<typeof plugin>[0];
    const registry = new ShareRegistry({
      kv: {
        async get<T>(key: string) {
          return kv.get(key) as T | undefined;
        },
        async set(key: string, value: unknown) {
          kv.set(key, value);
        },
        async delete(key: string) {
          kv.delete(key);
        },
      },
      hosts: pluginBb.hosts,
      hostResolver: new ShareHostResolver(() => pluginBb.sdk),
      getLoopbackBaseUrl: () => "http://127.0.0.1:38886",
      getIdentity: () => ({
        serverUrl: "https://sawyer.getbb.app",
        handle: "sawyer",
        credential: "bbcred_x",
      }),
      log: pluginBb.log,
    });

    await registry.load();
    expect(await registry.list()).toEqual([
      {
        hostId: SERVER_HOST_ID,
        hostName: SERVER_HOST_NAME,
        port: 3000,
        createdAt: 123,
        url: "https://sawyer--3000.getbb.app",
      },
    ]);
    expect(kv.get(SHARES_KV_KEY)).toEqual({
      "3000": { port: 3000, createdAt: 123 },
    });
    await fakeHost.harness.dispose();
  });

  it("lists persisted shares in the sync snapshot before any resolution, including unpaired", async () => {
    const kv = new Map<string, unknown>([
      [
        SHARES_KV_KEY,
        {
          "3000": { port: 3000, createdAt: 1 },
          [`${REMOTE_HOST_ID}:4000`]: {
            hostId: REMOTE_HOST_ID,
            port: 4000,
            createdAt: 2,
          },
        },
      ],
    ]);
    const fakeHost = createConnectFakeHost();
    const pluginBb = fakeHost.bb as unknown as Parameters<typeof plugin>[0];
    const registry = new ShareRegistry({
      kv: {
        async get<T>(key: string) {
          return kv.get(key) as T | undefined;
        },
        async set(key: string, value: unknown) {
          kv.set(key, value);
        },
        async delete(key: string) {
          kv.delete(key);
        },
      },
      hosts: pluginBb.hosts,
      hostResolver: new ShareHostResolver(() => pluginBb.sdk),
      getLoopbackBaseUrl: () => "http://127.0.0.1:38886",
      getIdentity: () => null,
      log: pluginBb.log,
    });

    await registry.load();
    expect(registry.snapshot()).toEqual([
      {
        hostId: REMOTE_HOST_ID,
        hostName: REMOTE_HOST_ID,
        port: 4000,
        createdAt: 2,
        url: "",
        unavailableReason: "Share URL has not been resolved yet.",
      },
      {
        hostId: "server",
        hostName: "server host",
        port: 3000,
        createdAt: 1,
        url: "",
        unavailableReason: "Share URL has not been resolved yet.",
      },
    ]);
    await fakeHost.harness.dispose();
  });

  it("collapses the placeholder snapshot row when a legacy share resolves", async () => {
    const kv = new Map<string, unknown>([
      [SHARES_KV_KEY, { "3000": { port: 3000, createdAt: 123 } }],
    ]);
    const fakeHost = createConnectFakeHost();
    const pluginBb = fakeHost.bb as unknown as Parameters<typeof plugin>[0];
    const registry = new ShareRegistry({
      kv: {
        async get<T>(key: string) {
          return kv.get(key) as T | undefined;
        },
        async set(key: string, value: unknown) {
          kv.set(key, value);
        },
        async delete(key: string) {
          kv.delete(key);
        },
      },
      hosts: pluginBb.hosts,
      hostResolver: new ShareHostResolver(() => pluginBb.sdk),
      getLoopbackBaseUrl: () => "http://127.0.0.1:38886",
      getIdentity: () => ({
        serverUrl: "https://sawyer.getbb.app",
        handle: "sawyer",
        credential: "bbcred_x",
      }),
      log: pluginBb.log,
    });

    await registry.load();
    expect(registry.snapshot()).toEqual([
      expect.objectContaining({ hostId: "server", port: 3000 }),
    ]);
    await registry.add(3000, {
      id: SERVER_HOST_ID,
      name: SERVER_HOST_NAME,
      isServer: true,
    });
    expect(registry.snapshot()).toEqual([
      {
        hostId: SERVER_HOST_ID,
        hostName: SERVER_HOST_NAME,
        port: 3000,
        createdAt: 123,
        url: "https://sawyer--3000.getbb.app",
      },
    ]);
    await fakeHost.harness.dispose();
  });

  it("normalizes legacy entries to the server host id at activation", async () => {
    const kv = new Map<string, unknown>([
      [SHARES_KV_KEY, { "3000": { port: 3000, createdAt: 123 } }],
    ]);
    const fakeHost = createConnectFakeHost();
    const pluginBb = fakeHost.bb as unknown as Parameters<typeof plugin>[0];
    const registry = new ShareRegistry({
      kv: {
        async get<T>(key: string) {
          return kv.get(key) as T | undefined;
        },
        async set(key: string, value: unknown) {
          kv.set(key, value);
        },
        async delete(key: string) {
          kv.delete(key);
        },
      },
      hosts: pluginBb.hosts,
      hostResolver: new ShareHostResolver(() => pluginBb.sdk),
      getLoopbackBaseUrl: () => "http://127.0.0.1:38886",
      getIdentity: () => ({
        serverUrl: "https://sawyer.getbb.app",
        handle: "sawyer",
        credential: "bbcred_x",
      }),
      log: pluginBb.log,
    });

    await registry.load();
    expect(registry.hasServerPort(3000)).toBe(true);
    await registry.declareMachineShares(() => true);
    expect(kv.get(SHARES_KV_KEY)).toEqual({
      [`${SERVER_HOST_ID}:3000`]: {
        hostId: SERVER_HOST_ID,
        port: 3000,
        createdAt: 123,
      },
    });
    expect(registry.hasServerPort(3000)).toBe(true);
    expect(await registry.remove(3000, SERVER_HOST_ID)).toMatchObject({
      removed: true,
      hostId: SERVER_HOST_ID,
    });
    await fakeHost.harness.dispose();
  });

  it("loads valid entries when another kv entry is malformed", async () => {
    const kv = new Map<string, unknown>([
      [
        SHARES_KV_KEY,
        {
          [`${SERVER_HOST_ID}:8000`]: {
            hostId: SERVER_HOST_ID,
            port: 8000,
            createdAt: 1,
          },
          malformed: { hostId: REMOTE_HOST_ID, port: "nope", createdAt: 2 },
        },
      ],
    ]);
    const fakeHost = createConnectFakeHost();
    const pluginBb = fakeHost.bb as unknown as Parameters<typeof plugin>[0];
    const registry = new ShareRegistry({
      kv: {
        async get<T>(key: string) {
          return kv.get(key) as T | undefined;
        },
        async set(key: string, value: unknown) {
          kv.set(key, value);
        },
        async delete(key: string) {
          kv.delete(key);
        },
      },
      hosts: pluginBb.hosts,
      hostResolver: new ShareHostResolver(() => pluginBb.sdk),
      getLoopbackBaseUrl: () => "http://127.0.0.1:38886",
      getIdentity: () => ({
        serverUrl: "https://sawyer.getbb.app",
        handle: "sawyer",
        credential: "bbcred_x",
      }),
      log: pluginBb.log,
    });

    await registry.load();
    expect(fakeHost.harness.sdk.callsTo("hosts.get")).toEqual([]);
    expect(fakeHost.harness.sdk.callsTo("system.config")).toEqual([]);
    expect(await registry.list()).toEqual([
      {
        hostId: SERVER_HOST_ID,
        hostName: SERVER_HOST_NAME,
        port: 8000,
        createdAt: 1,
        url: "https://sawyer--8000.getbb.app",
      },
    ]);
    expect(fakeHost.harness.logEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          message: expect.stringContaining(
            'malformed shared-port entry "malformed"',
          ),
        }),
      ]),
    );
    await fakeHost.harness.dispose();
  });

  it("hydrates offline machine shares without resolving their URLs", async () => {
    const kv = new Map<string, unknown>([
      [
        SHARES_KV_KEY,
        {
          [`${SERVER_HOST_ID}:8000`]: {
            hostId: SERVER_HOST_ID,
            port: 8000,
            createdAt: 1,
          },
          [`${REMOTE_HOST_ID}:3000`]: {
            hostId: REMOTE_HOST_ID,
            port: 3000,
            createdAt: 2,
          },
        },
      ],
    ]);
    const fakeHost = createConnectFakeHost();
    const pluginBb = fakeHost.bb as unknown as Parameters<typeof plugin>[0];
    const ensureIdentity = vi.fn(async () => {
      throw Object.assign(new Error("host is offline"), {
        body: { code: "connect_host_offline" },
      });
    });
    const registry = new ShareRegistry({
      kv: {
        async get<T>(key: string) {
          return kv.get(key) as T | undefined;
        },
        async set(key: string, value: unknown) {
          kv.set(key, value);
        },
        async delete(key: string) {
          kv.delete(key);
        },
      },
      hosts: {
        ensureSharedPortTunnel: ensureIdentity,
        declareSharedPorts: pluginBb.hosts.declareSharedPorts,
      },
      hostResolver: new ShareHostResolver(() => pluginBb.sdk),
      getLoopbackBaseUrl: () => "http://127.0.0.1:38886",
      getIdentity: () => ({
        serverUrl: "https://sawyer.getbb.app",
        handle: "sawyer",
        credential: "bbcred_x",
      }),
      log: pluginBb.log,
    });

    await registry.load();
    expect(ensureIdentity).not.toHaveBeenCalled();
    expect(fakeHost.harness.sdk.callsTo("hosts.get")).toEqual([]);
    expect(await registry.list()).toEqual([
      {
        hostId: REMOTE_HOST_ID,
        hostName: REMOTE_HOST_NAME,
        port: 3000,
        createdAt: 2,
        url: "",
        unavailableReason: expect.stringMatching(
          /not connected right now.*Bring the host online/,
        ),
      },
      {
        hostId: SERVER_HOST_ID,
        hostName: SERVER_HOST_NAME,
        port: 8000,
        createdAt: 1,
        url: "https://sawyer--8000.getbb.app",
      },
    ]);
    expect(ensureIdentity).toHaveBeenCalledTimes(1);
    await fakeHost.harness.dispose();
  });
});

describe("ConnectTunnel share activation", () => {
  it("does not declare non-empty ports when serverHostId resolves after stop", async () => {
    let resolveServerHostId!: (hostId: string) => void;
    const serverHostId = new Promise<string>((resolve) => {
      resolveServerHostId = resolve;
    });
    let markLookupStarted!: () => void;
    const lookupStarted = new Promise<void>((resolve) => {
      markLookupStarted = resolve;
    });
    const fakeHost = createFakePluginHost({
      pluginId: "connect",
      sdk: {
        system: {
          config: async () => {
            markLookupStarted();
            return { primaryHostId: await serverHostId } as never;
          },
        },
        hosts: {
          get: async ({ hostId }: { hostId: string }) =>
            ({ id: hostId, name: hostId }) as never,
        },
      },
    });
    const pluginBb = fakeHost.bb as unknown as Parameters<typeof plugin>[0];
    const credential = {
      serverUrl: "http://127.0.0.1:1",
      handle: "sawyer",
      credential: "bbcred_x",
    };
    const kv = new Map<string, unknown>([
      [
        SHARES_KV_KEY,
        {
          [`${REMOTE_HOST_ID}:3000`]: {
            hostId: REMOTE_HOST_ID,
            port: 3000,
            createdAt: 1,
          },
        },
      ],
    ]);
    const shares = new ShareRegistry({
      kv: {
        async get<T>(key: string) {
          return kv.get(key) as T | undefined;
        },
        async set(key: string, value: unknown) {
          kv.set(key, value);
        },
        async delete(key: string) {
          kv.delete(key);
        },
      },
      hosts: pluginBb.hosts,
      hostResolver: new ShareHostResolver(() => pluginBb.sdk),
      getLoopbackBaseUrl: () => "http://127.0.0.1:38886",
      getIdentity: () => credential,
      log: pluginBb.log,
    });
    const tunnel = new ConnectTunnel({
      shares,
      mintTicket: async () => {
        throw new Error("offline");
      },
      defaultBaseUrl: DEFAULT_CONNECT_BASE_URL,
      enabled: true,
      getLoopbackBaseUrl: () => "http://127.0.0.1:38886",
      log: pluginBb.log,
    });
    tunnel.setAccount({
      ...TEST_ACCOUNT,
      serverUrl: credential.serverUrl,
      serverLabel: credential.handle,
    });

    await tunnel.start();
    await lookupStarted;
    tunnel.stop();
    resolveServerHostId(SERVER_HOST_ID);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(
      fakeHost.harness.sharedPortDeclarations.filter(
        (declaration) => declaration.ports.length > 0,
      ),
    ).toEqual([]);
    await fakeHost.harness.dispose();
  });

  it("keeps persisted shares visible in status after an unpaired restart", async () => {
    const fakeHost = createConnectFakeHost();
    const pluginBb = fakeHost.bb as unknown as Parameters<typeof plugin>[0];
    const kv = new Map<string, unknown>([
      [
        SHARES_KV_KEY,
        {
          "3000": { port: 3000, createdAt: 1 },
          [`${REMOTE_HOST_ID}:4000`]: {
            hostId: REMOTE_HOST_ID,
            port: 4000,
            createdAt: 2,
          },
        },
      ],
    ]);
    const shares = new ShareRegistry({
      kv: {
        async get<T>(key: string) {
          return kv.get(key) as T | undefined;
        },
        async set(key: string, value: unknown) {
          kv.set(key, value);
        },
        async delete(key: string) {
          kv.delete(key);
        },
      },
      hosts: pluginBb.hosts,
      hostResolver: new ShareHostResolver(() => pluginBb.sdk),
      getLoopbackBaseUrl: () => "http://127.0.0.1:38886",
      getIdentity: () => null,
      log: pluginBb.log,
    });
    const tunnel = new ConnectTunnel({
      shares,
      mintTicket: async () => {
        throw new Error("offline");
      },
      defaultBaseUrl: DEFAULT_CONNECT_BASE_URL,
      enabled: true,
      getLoopbackBaseUrl: () => "http://127.0.0.1:38886",
      log: pluginBb.log,
    });

    await tunnel.start();
    await waitFor(() => tunnel.status().shares.length === 2);
    expect(tunnel.status().shares).toEqual([
      expect.objectContaining({
        hostId: REMOTE_HOST_ID,
        port: 4000,
        url: "",
        unavailableReason: "Share URL has not been resolved yet.",
      }),
      expect.objectContaining({
        hostId: "server",
        port: 3000,
        url: "",
        unavailableReason: "Share URL has not been resolved yet.",
      }),
    ]);
    tunnel.stop();
    await fakeHost.harness.dispose();
  });
});

describe("isBareBbRealtimeWs", () => {
  it("matches bare-handle /ws paths only", () => {
    expect(isBareBbRealtimeWs("/ws", undefined)).toBe(true);
    expect(isBareBbRealtimeWs("/ws?x=1", undefined)).toBe(true);
    expect(isBareBbRealtimeWs("/ws/nested", undefined)).toBe(true);
    expect(isBareBbRealtimeWs("/ws", "8000")).toBe(false);
    expect(isBareBbRealtimeWs("/api", undefined)).toBe(false);
  });
});

async function listen(
  handler: (
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
  ) => void,
): Promise<{ server: Server; origin: string; port: number }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (addr === null || typeof addr === "string") {
    throw new Error("expected TCP address");
  }
  return {
    server,
    origin: `http://127.0.0.1:${addr.port}`,
    port: addr.port,
  };
}

async function waitForOpen(ws: NodeWebSocket): Promise<void> {
  if (ws.readyState === NodeWebSocket.OPEN) return;
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
}

function collectFrames(ws: NodeWebSocket): Frame[] {
  const frames: Frame[] = [];
  ws.on("message", (data: Buffer, isBinary: boolean) => {
    if (isBinary) frames.push(decodeFrame(data));
  });
  return frames;
}

async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("TunnelSession routing", () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  it("routes no-target to primary origin, target to a shared port, unregistered → 404", async () => {
    const primaryHits: string[] = [];
    const shareHits: string[] = [];
    const primary = await listen((req, res) => {
      primaryHits.push(`${req.method} ${req.url}`);
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("primary");
    });
    const share = await listen((req, res) => {
      shareHits.push(
        `${req.method} ${req.url} host=${req.headers.host} origin=${req.headers.origin ?? ""}`,
      );
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("shared");
    });
    cleanups.push(
      () =>
        new Promise<void>((resolve) => primary.server.close(() => resolve())),
      () => new Promise<void>((resolve) => share.server.close(() => resolve())),
    );

    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise<void>((resolve) =>
      wss.once("listening", () => resolve()),
    );
    const wssAddr = wss.address();
    if (wssAddr === null || typeof wssAddr === "string") {
      throw new Error("expected TCP address");
    }
    const relayReady = new Promise<NodeWebSocket>((resolve) => {
      wss.on("connection", (socket) => resolve(socket));
    });
    const client = new NodeWebSocket(`ws://127.0.0.1:${wssAddr.port}`);
    cleanups.push(async () => {
      client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    });
    await waitForOpen(client);
    const relay = await relayReady;
    const frames = collectFrames(relay);

    const sharedPorts = new Set([share.port]);
    const session = new TunnelSession({
      tunnel: client,
      log: {
        info: () => {},
        warn: () => {},
      },
      resolveOrigin: (target) => {
        if (target === undefined) {
          return {
            kind: "ok",
            resolved: {
              origin: primary.origin,
              publicOrigin: "https://sawyer.getbb.app",
            },
          };
        }
        const port = Number(target);
        if (!sharedPorts.has(port)) return { kind: "unregistered" };
        return {
          kind: "ok",
          resolved: {
            origin: `http://127.0.0.1:${port}`,
            publicOrigin: `https://sawyer--${port}.getbb.app`,
            host: `127.0.0.1:${port}`,
          },
        };
      },
    });
    session.start();
    cleanups.push(() => session.dispose());

    const inject = (frame: Frame) => {
      relay.send(Buffer.from(encodeFrame(frame)));
    };

    inject({
      type: "open-http",
      streamId: 1,
      method: "GET",
      path: "/hello",
      headers: [["Origin", "https://sawyer.getbb.app"]],
      hasBody: false,
    });
    await waitFor(() =>
      frames.some((f) => f.type === "body-end" && f.streamId === 1),
    );
    expect(primaryHits).toEqual(["GET /hello"]);
    expect(shareHits).toEqual([]);

    frames.length = 0;
    inject({
      type: "open-http",
      streamId: 2,
      method: "GET",
      path: "/app",
      headers: [
        ["Origin", `https://sawyer--${share.port}.getbb.app`],
        ["Host", `sawyer--${share.port}.getbb.app`],
      ],
      hasBody: false,
      target: String(share.port),
    });
    await waitFor(() =>
      frames.some((f) => f.type === "body-end" && f.streamId === 2),
    );
    expect(shareHits).toHaveLength(1);
    expect(shareHits[0]).toContain("GET /app");
    expect(shareHits[0]).toContain(`host=127.0.0.1:${share.port}`);
    expect(shareHits[0]).toContain(`origin=http://127.0.0.1:${share.port}`);
    expect(primaryHits).toEqual(["GET /hello"]);

    frames.length = 0;
    inject({
      type: "open-http",
      streamId: 3,
      method: "GET",
      path: "/nope",
      headers: [],
      hasBody: false,
      target: "59999",
    });
    await waitFor(() =>
      frames.some((f) => f.type === "resp-head" && f.streamId === 3),
    );
    const head = frames.find((f) => f.type === "resp-head" && f.streamId === 3);
    expect(head).toMatchObject({ type: "resp-head", status: 404 });
    const bodyChunks = frames.filter(
      (f) => f.type === "body-chunk" && f.streamId === 3,
    );
    const body = Buffer.concat(
      bodyChunks.map((f) =>
        f.type === "body-chunk" ? Buffer.from(f.data) : Buffer.alloc(0),
      ),
    ).toString();
    expect(body).toBe("this port is not shared");
    expect(frames.some((f) => f.type === "body-end" && f.streamId === 3)).toBe(
      true,
    );
  });

  it("aborts the origin request when the relay closes an HTTP stream", async () => {
    let originStarted = false;
    let originClosed = false;
    const origin = await listen((request, response) => {
      originStarted = true;
      request.once("aborted", () => {
        originClosed = true;
      });
      response.once("close", () => {
        originClosed = true;
      });
    });
    cleanups.push(
      () =>
        new Promise<void>((resolve) => origin.server.close(() => resolve())),
    );

    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise<void>((resolve) =>
      wss.once("listening", () => resolve()),
    );
    const wssAddr = wss.address();
    if (wssAddr === null || typeof wssAddr === "string") {
      throw new Error("expected TCP address");
    }
    const relayReady = new Promise<NodeWebSocket>((resolve) => {
      wss.on("connection", (socket) => resolve(socket));
    });
    const client = new NodeWebSocket(`ws://127.0.0.1:${wssAddr.port}`);
    cleanups.push(async () => {
      client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    });
    await waitForOpen(client);
    const relay = await relayReady;

    const session = new TunnelSession({
      tunnel: client,
      log: {
        info: () => {},
        warn: () => {},
      },
      resolveOrigin: () => ({
        kind: "ok",
        resolved: {
          origin: origin.origin,
          publicOrigin: "https://sawyer.getbb.app",
        },
      }),
    });
    session.start();
    cleanups.push(() => session.dispose());

    relay.send(
      Buffer.from(
        encodeFrame({
          type: "open-http",
          streamId: 41,
          method: "GET",
          path: "/slow",
          headers: [],
          hasBody: false,
        }),
      ),
    );
    await waitFor(() => originStarted);

    relay.send(
      Buffer.from(
        encodeFrame({
          type: "close-stream",
          streamId: 41,
          code: 1000,
          reason: "visitor canceled response body",
        }),
      ),
    );
    await waitFor(() => originClosed);
  });

  it("preserves negotiated origin compression across the tunnel and relays 304 bodiless", async () => {
    const plainBody = "hello ".repeat(200);
    const gzippedBody = gzipSync(Buffer.from(plainBody));
    const acceptEncodings: Array<string | undefined> = [];
    const origin = await listen((req, res) => {
      acceptEncodings.push(req.headers["accept-encoding"]);
      if (req.headers["if-none-match"] === 'W/"v1"') {
        res.writeHead(304, { etag: 'W/"v1"' });
        res.end();
        return;
      }
      res.writeHead(200, {
        "content-type": "text/plain",
        "content-encoding": "gzip",
        "content-length": String(gzippedBody.length),
        etag: 'W/"v1"',
      });
      res.end(gzippedBody);
    });
    cleanups.push(
      () =>
        new Promise<void>((resolve) => origin.server.close(() => resolve())),
    );

    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise<void>((resolve) =>
      wss.once("listening", () => resolve()),
    );
    const wssAddr = wss.address();
    if (wssAddr === null || typeof wssAddr === "string") {
      throw new Error("expected TCP address");
    }
    const relayReady = new Promise<NodeWebSocket>((resolve) => {
      wss.on("connection", (socket) => resolve(socket));
    });
    const client = new NodeWebSocket(`ws://127.0.0.1:${wssAddr.port}`);
    cleanups.push(async () => {
      client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    });
    await waitForOpen(client);
    const relay = await relayReady;
    const frames = collectFrames(relay);
    const infoMessages: string[] = [];

    const session = new TunnelSession({
      tunnel: client,
      log: {
        info: (message) => infoMessages.push(message),
        warn: () => {},
      },
      resolveOrigin: () => ({
        kind: "ok",
        resolved: {
          origin: origin.origin,
          publicOrigin: "https://sawyer.getbb.app",
        },
      }),
    });
    session.start();
    cleanups.push(() => session.dispose());

    const inject = (frame: Frame) => {
      relay.send(Buffer.from(encodeFrame(frame)));
    };

    inject({
      type: "open-http",
      streamId: 21,
      method: "GET",
      path: "/api/v1/threads/thr_test/timeline",
      headers: [["accept-encoding", "gzip"]],
      hasBody: false,
    });
    await waitFor(() =>
      frames.some((f) => f.type === "body-end" && f.streamId === 21),
    );
    const head = frames.find(
      (f) => f.type === "resp-head" && f.streamId === 21,
    );
    if (head?.type !== "resp-head") throw new Error("missing resp-head");
    expect(head.status).toBe(200);
    const headerNames = head.headers.map(([name]) => name.toLowerCase());
    expect(headerNames).toContain("content-encoding");
    expect(headerNames).toContain("content-length");
    expect(headerNames).toContain("etag");
    expect(head.headers).toContainEqual([
      "server-timing",
      expect.stringMatching(/^bb_connect_origin;dur=\d+(?:\.\d+)?$/),
    ]);
    const relayedBody = Buffer.concat(
      frames
        .filter((f) => f.type === "body-chunk" && f.streamId === 21)
        .map((f) =>
          f.type === "body-chunk" ? Buffer.from(f.data) : Buffer.alloc(0),
        ),
    );
    expect(relayedBody).toEqual(gzippedBody);
    expect(acceptEncodings).toEqual(["gzip"]);
    expect(infoMessages).toEqual([
      expect.stringContaining(
        `responseBytes=${gzippedBody.length} contentEncoding=gzip`,
      ),
    ]);

    frames.length = 0;
    inject({
      type: "open-http",
      streamId: 22,
      method: "GET",
      path: "/api/v1/threads/thr_test/timeline",
      headers: [["If-None-Match", 'W/"v1"']],
      hasBody: false,
    });
    await waitFor(() =>
      frames.some((f) => f.type === "body-end" && f.streamId === 22),
    );
    const revalidated = frames.find(
      (f) => f.type === "resp-head" && f.streamId === 22,
    );
    expect(revalidated).toMatchObject({ type: "resp-head", status: 304 });
    expect(
      frames.some((f) => f.type === "body-chunk" && f.streamId === 22),
    ).toBe(false);
  });

  it("tracks remoteClients for bare-handle /ws streams", async () => {
    const origin = await listen((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    const originWss = new WebSocketServer({ server: origin.server });
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          originWss.close(() => origin.server.close(() => resolve()));
        }),
    );

    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise<void>((resolve) =>
      wss.once("listening", () => resolve()),
    );
    const wssAddr = wss.address();
    if (wssAddr === null || typeof wssAddr === "string") {
      throw new Error("expected TCP address");
    }
    const relayReady = new Promise<NodeWebSocket>((resolve) => {
      wss.on("connection", (socket) => resolve(socket));
    });
    const client = new NodeWebSocket(`ws://127.0.0.1:${wssAddr.port}`);
    cleanups.push(async () => {
      client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    });
    await waitForOpen(client);
    const relay = await relayReady;
    const frames = collectFrames(relay);

    const remoteClientsSeen: number[] = [];
    const session = new TunnelSession({
      tunnel: client,
      log: {
        info: () => {},
        warn: () => {},
      },
      resolveOrigin: () => ({
        kind: "ok",
        resolved: {
          origin: origin.origin,
          publicOrigin: "https://sawyer.getbb.app",
        },
      }),
      onRemoteClientsChange: (n) => {
        remoteClientsSeen.push(n);
      },
    });
    session.start();
    cleanups.push(() => session.dispose());

    expect(session.remoteClients).toBe(0);

    const inject = (frame: Frame) => {
      relay.send(Buffer.from(encodeFrame(frame)));
    };

    inject({
      type: "open-ws",
      streamId: 10,
      path: "/ws",
      headers: [],
      protocols: [],
    });
    await waitFor(() =>
      frames.some((f) => f.type === "ws-open-ack" && f.streamId === 10),
    );
    expect(session.remoteClients).toBe(1);
    expect(remoteClientsSeen).toContain(1);

    inject({
      type: "close-stream",
      streamId: 10,
      code: 1000,
      reason: "bye",
    });
    await waitFor(() => session.remoteClients === 0);
    expect(remoteClientsSeen).toContain(0);
  });
});

describe("connect plugin", () => {
  let host: FakePluginHost | undefined;
  let account: FakeAccount;
  let tunnelService:
    | { controller: AbortController; done: Promise<void> }
    | undefined;

  async function loadPlugin(options?: {
    remoteIdentity?: { label: string; baseDomain: string };
    mobileApp?: boolean;
    beforeLoad?: (current: FakePluginHost) => Promise<void> | void;
  }): Promise<FakePluginHost> {
    account = new FakeAccount();
    host = createConnectFakeHost({ ...options, account });
    await options?.beforeLoad?.(host);
    await createConnectPlugin({ accountRetryMinMs: 20 })(
      host.bb as unknown as Parameters<typeof plugin>[0],
    );
    return host;
  }

  function startTunnel(current: FakePluginHost): void {
    tunnelService ??= current.harness.runService("tunnel");
  }

  async function status(current: FakePluginHost): Promise<ConnectStatus> {
    return (await current.harness.callRpc("status")) as ConnectStatus;
  }

  async function signIn(
    current: FakePluginHost,
    overrides: Partial<typeof TEST_ACCOUNT> = {},
  ): Promise<void> {
    account.signIn(overrides);
    startTunnel(current);
    await vi.waitFor(async () => {
      expect((await status(current)).paired).toBe(true);
    });
  }

  afterEach(async () => {
    if (tunnelService) {
      tunnelService.controller.abort();
      await tunnelService.done;
      tunnelService = undefined;
    }
    if (host) {
      await host.harness.dispose();
      host = undefined;
    }
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("starts signed out — a healthy state, not needs-configuration", async () => {
    const { harness } = await loadPlugin();
    const initial = await status(host!);
    expect(initial).toMatchObject({
      state: "disconnected",
      paired: false,
      enabled: true,
      handle: null,
      url: null,
      lastError: null,
      remoteClients: 0,
      lastRemoteActivityAt: null,
      shares: [],
    });
    expect(initial.dashboardUrl).toBe("https://getbb.app/dashboard");
    expect(initial.nextRetryAt).toBeNull();
    expect(harness.needsConfigurationMessages).toEqual([]);
  });

  it("uses the worktree-local Cloud dashboard while signed out in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BB_DEV_CONNECT_BASE_URL", "http://bb.localhost:59329");
    await loadPlugin();
    expect((await status(host!)).dashboardUrl).toBe(
      "http://bb.localhost:59329/dashboard",
    );
  });

  it("toggles remote instructions while preserving active and recent usage conditions", async () => {
    const connected: ConnectStatus = {
      state: "connected",
      paired: true,
      enabled: true,
      handle: "test",
      url: "https://test.getbb.app",
      dashboardUrl: "https://getbb.app",
      lastError: null,
      nextRetryAt: null,
      since: Date.now(),
      remoteClients: 1,
      lastRemoteActivityAt: null,
      shares: [],
    };
    const statusSpy = vi
      .spyOn(ConnectTunnel.prototype, "status")
      .mockReturnValue(connected);
    try {
      const { harness } = await loadPlugin();
      const instructions = () =>
        harness.registrations.instructionProvider?.({
          threadId: "thr_test",
          projectId: "proj_test",
        });
      expect(instructions()).toContain("bb connect expose");
      await harness.behavior.setSettings({ sendRemoteInstructions: false });
      expect(instructions()).toBeNull();
      await harness.behavior.setSettings({ sendRemoteInstructions: true });
      expect(instructions()).toContain("https://test.getbb.app");
      statusSpy.mockReturnValue({ ...connected, remoteClients: 0 });
      expect(instructions()).toBeNull();
      statusSpy.mockReturnValue({
        ...connected,
        remoteClients: 0,
        lastRemoteActivityAt: Date.now(),
      });
      expect(instructions()).toContain("bb connect expose");
      statusSpy.mockReturnValue({ ...connected, enabled: false });
      expect(instructions()).toBeNull();
    } finally {
      statusSpy.mockRestore();
    }
  });

  it("registers contributeInstructions", async () => {
    const { harness } = await loadPlugin();
    expect(harness.registrations.instructionProvider).not.toBeNull();
    expect(
      harness.registrations.instructionProvider?.({
        threadId: "th_1",
        projectId: "proj_1",
      }),
    ).toBeNull();
  });

  it("follows the bb account: signs in, reports the gate URL, and tears down on sign-out", async () => {
    const current = await loadPlugin();
    await signIn(current, {
      serverUrl: "http://sawyer-desktop.localhost:59332",
      serverLabel: "sawyer-desktop",
      baseUrl: "http://localhost:59332",
    });
    expect(await status(current)).toMatchObject({
      paired: true,
      enabled: true,
      handle: "sawyer-desktop",
      url: "http://sawyer-desktop.localhost:59332",
      dashboardUrl: "http://localhost:59332/dashboard",
    });
    const exposed = (await current.harness.callRpc("expose", {
      port: 8000,
    })) as { url: string };
    expect(exposed.url).toBe("http://sawyer-desktop--8000.localhost:59332");

    account.signOut();
    await vi.waitFor(async () => {
      expect(await status(current)).toMatchObject({
        state: "disconnected",
        paired: false,
        handle: null,
        url: null,
      });
    });
  });

  it("waits while bb account isn't running, then follows it once it is", async () => {
    const current = await loadPlugin();
    account.available = false;
    startTunnel(current);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((await status(current)).paired).toBe(false);

    account.available = true;
    account.signIn();
    await vi.waitFor(async () => {
      expect((await status(current)).paired).toBe(true);
    });
  });

  it("hands a legacy connect credential to bb account on start and forgets its copy", async () => {
    const legacy = {
      serverUrl: "https://sawyer.getbb.app",
      handle: "sawyer",
      credential: "bbcred_legacy",
    };
    const current = await loadPlugin({
      beforeLoad: (loading) =>
        loading.bb.storage.kv.set(LEGACY_CREDENTIAL_KV_KEY, legacy),
    });
    account.adopt = () => ({ adopted: true });
    startTunnel(current);

    await vi.waitFor(async () => {
      expect((await status(current)).paired).toBe(true);
    });
    expect(account.adoptions).toEqual([
      {
        credential: "bbcred_legacy",
        serverUrl: "https://sawyer.getbb.app",
        handle: "sawyer",
        baseUrl: "https://getbb.app",
      },
    ]);
    expect(
      await current.bb.storage.kv.get(LEGACY_CREDENTIAL_KV_KEY),
    ).toBeUndefined();
  });

  it("keeps the legacy credential until bb account runs, then drops it when bb account is already signed in", async () => {
    const current = await loadPlugin({
      beforeLoad: (loading) =>
        loading.bb.storage.kv.set(LEGACY_CREDENTIAL_KV_KEY, {
          serverUrl: "https://sawyer.getbb.app",
          handle: "sawyer",
          credential: "bbcred_legacy",
        }),
    });
    account.available = false;
    startTunnel(current);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await current.bb.storage.kv.get(LEGACY_CREDENTIAL_KV_KEY)).toEqual(
      expect.objectContaining({ credential: "bbcred_legacy" }),
    );

    account.signIn();
    account.available = true;
    await vi.waitFor(async () => {
      expect(
        await current.bb.storage.kv.get(LEGACY_CREDENTIAL_KV_KEY),
      ).toBeUndefined();
    });
    expect(account.adoptions).toEqual([]);
    await vi.waitFor(async () => {
      expect((await status(current)).paired).toBe(true);
    });
  });

  it("drops a legacy credential that bb account refuses", async () => {
    const current = await loadPlugin({
      beforeLoad: (loading) =>
        loading.bb.storage.kv.set(LEGACY_CREDENTIAL_KV_KEY, {
          serverUrl: "https://sawyer.getbb.app",
          handle: "sawyer",
          credential: "bbcred_revoked",
        }),
    });
    account.adopt = () => ({ adopted: false });
    startTunnel(current);

    await vi.waitFor(async () => {
      expect(
        await current.bb.storage.kv.get(LEGACY_CREDENTIAL_KV_KEY),
      ).toBeUndefined();
    });
    expect(account.adoptions).toHaveLength(1);
    expect((await status(current)).paired).toBe(false);
  });

  it("turns remote access off without signing out, and back on with a fresh ticket", async () => {
    const current = await loadPlugin();
    let mints = 0;
    account.route("api", "POST", "/api/connect/tunnel-ticket", () => {
      mints += 1;
      return { status: 503, body: { error: "unavailable" } };
    });
    await signIn(current);
    await vi.waitFor(() => expect(mints).toBe(1));

    const off = (await current.harness.callRpc("setRemoteAccess", {
      enabled: false,
    })) as ConnectStatus;
    expect(off).toMatchObject({
      paired: true,
      enabled: false,
      state: "disconnected",
      lastError: null,
    });
    expect(account.status.state).toBe("signed-in");

    const on = (await current.harness.callRpc("setRemoteAccess", {
      enabled: true,
    })) as ConnectStatus;
    expect(on).toMatchObject({ paired: true, enabled: true });
    await vi.waitFor(() => expect(mints).toBe(2));
  });

  it("expose / listShares / unexpose rpc round-trip when signed in", async () => {
    const current = await loadPlugin();
    await signIn(current, {
      serverUrl: "http://sawyer.localhost:59330",
      serverLabel: "sawyer",
    });
    const { harness } = current;

    const shareUrl = "http://sawyer--8000.localhost:59330";
    const exposed = (await harness.callRpc("expose", { port: 8000 })) as {
      port: number;
      url: string;
    };
    expect(exposed).toEqual({
      hostId: SERVER_HOST_ID,
      hostName: SERVER_HOST_NAME,
      port: 8000,
      url: shareUrl,
      createdAt: expect.any(Number),
    });

    const listed = (await harness.callRpc("listShares")) as Array<{
      port: number;
      url: string;
    }>;
    expect(listed).toEqual([
      {
        hostId: SERVER_HOST_ID,
        hostName: SERVER_HOST_NAME,
        port: 8000,
        url: shareUrl,
        createdAt: expect.any(Number),
      },
    ]);

    expect((await status(current)).shares).toEqual([
      {
        hostId: SERVER_HOST_ID,
        hostName: SERVER_HOST_NAME,
        port: 8000,
        url: shareUrl,
        createdAt: expect.any(Number),
      },
    ]);

    const removed = (await harness.callRpc("unexpose", { port: 8000 })) as {
      removed: boolean;
      port: number;
    };
    expect(removed).toEqual({
      removed: true,
      hostId: SERVER_HOST_ID,
      hostName: SERVER_HOST_NAME,
      port: 8000,
    });
    expect(await harness.callRpc("listShares")).toEqual([]);
  });

  it("refuses to expose while signed out", async () => {
    const { harness } = await loadPlugin();
    await expect(harness.callRpc("expose", { port: 8000 })).rejects.toThrow(
      "isn't signed in to a bb account",
    );
  });

  it("rejects tunnel identity fields on expose and unexpose rpc inputs", async () => {
    const { harness } = await loadPlugin();
    const redirected = {
      port: 3000,
      hostId: REMOTE_HOST_ID,
      label: "attacker",
      baseDomain: "attacker.example",
    };

    await expect(harness.callRpc("expose", redirected)).rejects.toMatchObject({
      code: "invalid_input",
      issues: expect.any(Array),
    });
    await expect(harness.callRpc("unexpose", redirected)).rejects.toMatchObject(
      {
        code: "invalid_input",
        issues: expect.any(Array),
      },
    );
  });

  it("keeps valid shares loaded when a host was removed and prunes orphaned shares without a host lookup", async () => {
    const { bb, harness } = await loadPlugin();
    await bb.storage.kv.set(SHARES_KV_KEY, {
      [`${SERVER_HOST_ID}:8000`]: {
        hostId: SERVER_HOST_ID,
        port: 8000,
        createdAt: 1,
      },
      "host-deleted:3000": {
        hostId: "host-deleted",
        port: 3000,
        createdAt: 2,
      },
      "host-deleted:4000": {
        hostId: "host-deleted",
        port: 4000,
        createdAt: 3,
      },
    });

    await expect(
      harness.callRpc("unexpose", { hostId: "host-deleted", port: 3000 }),
    ).resolves.toEqual({
      removed: true,
      hostId: "host-deleted",
      hostName: "removed host",
      port: 3000,
    });
    expect(await harness.callRpc("listShares")).toEqual(
      expect.arrayContaining([
        {
          hostId: SERVER_HOST_ID,
          hostName: SERVER_HOST_NAME,
          port: 8000,
          url: "http://127.0.0.1:8000",
          createdAt: 1,
        },
        expect.objectContaining({
          hostId: "host-deleted",
          hostName: "removed host",
          port: 4000,
          url: "",
          unavailableReason: expect.stringContaining("was removed"),
        }),
      ]),
    );
    const cliRemoval = await harness.runCli([
      "unexpose",
      "4000",
      "--host",
      "host-deleted",
    ]);
    expect(cliRemoval).toMatchObject({
      exitCode: 0,
      stdout: "Stopped sharing port 4000 on removed host (host-deleted)\n",
    });
    expect(await bb.storage.kv.get(SHARES_KV_KEY)).toEqual({
      [`${SERVER_HOST_ID}:8000`]: {
        hostId: SERVER_HOST_ID,
        port: 8000,
        createdAt: 1,
      },
    });
    expect(harness.sharedPortDeclarations).toEqual([
      { hostId: "host-deleted", ports: [] },
    ]);
  });

  it("unexposes a persisted machine share when its declaration update fails", async () => {
    const declarations = vi.fn((_hostId: string, _ports: readonly number[]) => {
      throw new Error("temporary declaration failure");
    });
    const current = await loadPlugin({
      beforeLoad: (loading) => {
        Object.defineProperty(loading.bb.hosts, "declareSharedPorts", {
          value: declarations,
        });
      },
    });
    await current.bb.storage.kv.set(SHARES_KV_KEY, {
      [`${REMOTE_HOST_ID}:3000`]: {
        hostId: REMOTE_HOST_ID,
        port: 3000,
        createdAt: 1,
      },
    });

    await expect(
      current.harness.callRpc("unexpose", {
        hostId: REMOTE_HOST_ID,
        port: 3000,
      }),
    ).resolves.toEqual({
      removed: true,
      hostId: REMOTE_HOST_ID,
      hostName: REMOTE_HOST_NAME,
      port: 3000,
    });
    expect(declarations).toHaveBeenCalledWith(REMOTE_HOST_ID, []);
    expect(await current.bb.storage.kv.get(SHARES_KV_KEY)).toBeUndefined();
    expect(await current.harness.callRpc("listShares")).toEqual([]);
    expect(current.harness.sdk.callsTo("hosts.get")).toEqual(
      expect.arrayContaining([
        [expect.objectContaining({ hostId: REMOTE_HOST_ID })],
      ]),
    );
    expect(current.harness.logEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          message: expect.stringContaining(
            "failed to update shared ports after removing port 3000",
          ),
        }),
      ]),
    );
  });

  it("uses machine tunnel identity and declares per-host port sets", async () => {
    const current = await loadPlugin({
      remoteIdentity: { label: "sawyer-air", baseDomain: "getbb.app" },
    });
    await signIn(current, {
      serverUrl: "http://sawyer.localhost:59333",
      serverLabel: "sawyer",
    });

    await expect(
      current.harness.callRpc("expose", { hostId: REMOTE_HOST_ID, port: 3000 }),
    ).resolves.toEqual({
      hostId: REMOTE_HOST_ID,
      hostName: REMOTE_HOST_NAME,
      port: 3000,
      url: "https://sawyer-air--3000.getbb.app",
      createdAt: expect.any(Number),
    });
    expect(current.harness.sharedPortDeclarations).toEqual([
      { hostId: REMOTE_HOST_ID, ports: [3000] },
    ]);

    await current.harness.callRpc("expose", {
      hostId: REMOTE_HOST_ID,
      port: 4000,
    });
    expect(current.harness.sharedPortDeclarations).toEqual([
      { hostId: REMOTE_HOST_ID, ports: [3000, 4000] },
    ]);

    await current.harness.callRpc("expose", { port: 3000 });
    expect(current.harness.sharedPortDeclarations).toEqual([
      { hostId: REMOTE_HOST_ID, ports: [3000, 4000] },
    ]);
    expect((await status(current)).shares).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ hostId: SERVER_HOST_ID, port: 3000 }),
        expect.objectContaining({ hostId: REMOTE_HOST_ID, port: 3000 }),
      ]),
    );

    await current.harness.callRpc("unexpose", {
      hostId: REMOTE_HOST_ID,
      port: 3000,
    });
    expect(current.harness.sharedPortDeclarations).toEqual([
      { hostId: REMOTE_HOST_ID, ports: [4000] },
    ]);
    await current.harness.callRpc("unexpose", {
      hostId: REMOTE_HOST_ID,
      port: 4000,
    });
    expect(current.harness.sharedPortDeclarations).toEqual([
      { hostId: REMOTE_HOST_ID, ports: [] },
    ]);
  });

  it("tells users to enroll a genuinely credentialless machine", async () => {
    const current = await loadPlugin({
      beforeLoad: (loading) => {
        Object.defineProperty(loading.bb.hosts, "ensureSharedPortTunnel", {
          value: async () => {
            throw Object.assign(new Error("machine credential missing"), {
              body: { code: "connect_host_unenrolled" },
            });
          },
        });
      },
    });
    await signIn(current, {
      serverUrl: "http://sawyer.localhost:59334",
      serverLabel: "sawyer",
    });

    await expect(
      current.harness.callRpc("expose", {
        hostId: REMOTE_HOST_ID,
        port: 3000,
      }),
    ).rejects.toThrow(
      /Sawyer Air.*host-air.*Enroll it via Connect.*Settings > Machines/,
    );
    expect(await current.harness.callRpc("listShares")).toEqual([]);
    expect(current.harness.sharedPortDeclarations).toEqual([]);
  });

  it("tells users to bring an enrolled but offline machine online", async () => {
    const current = await loadPlugin({
      beforeLoad: (loading) => {
        Object.defineProperty(loading.bb.hosts, "ensureSharedPortTunnel", {
          value: async () => {
            throw Object.assign(new Error("host is offline"), {
              body: { code: "connect_host_offline" },
            });
          },
        });
      },
    });
    await signIn(current, {
      serverUrl: "http://sawyer.localhost:59335",
      serverLabel: "sawyer",
    });

    let message = "";
    try {
      await current.harness.callRpc("expose", {
        hostId: REMOTE_HOST_ID,
        port: 3000,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(
      /Sawyer Air.*host-air.*not connected right now.*Bring the host online/,
    );
    expect(message).not.toMatch(/Enroll|remove and re-add/);
  });

  it("empties machine declarations when remote access turns off or the account signs out", async () => {
    const current = await loadPlugin({
      remoteIdentity: { label: "sawyer-air", baseDomain: "getbb.app" },
    });
    await signIn(current, {
      serverUrl: "http://sawyer.localhost:59335",
      serverLabel: "sawyer",
    });
    await current.harness.callRpc("expose", {
      hostId: REMOTE_HOST_ID,
      port: 5173,
    });
    expect(current.harness.sharedPortDeclarations).toEqual([
      { hostId: REMOTE_HOST_ID, ports: [5173] },
    ]);

    await current.harness.callRpc("setRemoteAccess", { enabled: false });
    expect(current.harness.sharedPortDeclarations).toEqual([
      { hostId: REMOTE_HOST_ID, ports: [] },
    ]);
    await current.harness.callRpc("setRemoteAccess", { enabled: true });
    await vi.waitFor(() =>
      expect(current.harness.sharedPortDeclarations).toEqual([
        { hostId: REMOTE_HOST_ID, ports: [5173] },
      ]),
    );

    account.signOut();
    await vi.waitFor(() =>
      expect(current.harness.sharedPortDeclarations).toEqual([
        { hostId: REMOTE_HOST_ID, ports: [] },
      ]),
    );
  });

  it("listAccountServers reads the gate through bb account and returns selfHandle", async () => {
    const current = await loadPlugin();
    account.route("gate", "GET", "/api/connect/servers", () => ({
      status: 200,
      body: {
        servers: [
          { handle: "sawyer", name: "default", live: true },
          { handle: "sawyer-desktop", name: "desktop", live: false },
        ],
      },
    }));
    await signIn(current, {
      serverUrl: "http://sawyer.localhost:59340",
      serverLabel: "sawyer",
      baseUrl: "http://localhost:59340",
    });

    expect(await current.harness.callRpc("listAccountServers")).toEqual({
      servers: [
        {
          handle: "sawyer",
          name: "default",
          live: true,
          url: "http://sawyer.localhost:59340",
        },
        {
          handle: "sawyer-desktop",
          name: "desktop",
          live: false,
          url: "http://sawyer-desktop.localhost:59340",
        },
      ],
      selfHandle: "sawyer",
    });
    expect(account.fetches).toContainEqual({
      target: "gate",
      method: "GET",
      path: "/api/connect/servers",
      body: null,
    });
  });

  it("listAccountServers when signed out returns a typed not_paired code", async () => {
    const { harness } = await loadPlugin();
    await expect(harness.callRpc("listAccountServers")).rejects.toThrow(
      "not_paired",
    );
  });

  it("listAccountServers surfaces unauthorized cleanly on 401", async () => {
    const current = await loadPlugin();
    account.route("gate", "GET", "/api/connect/servers", () => ({
      status: 401,
      body: { error: "unauthorized" },
    }));
    await signIn(current);
    await expect(current.harness.callRpc("listAccountServers")).rejects.toThrow(
      "unauthorized",
    );
  });

  it("createDesktopSession asks the gate through bb account", async () => {
    const current = await loadPlugin();
    account.route("gate", "POST", "/api/connect/desktop-session", () => ({
      status: 200,
      body: {
        cookie: {
          domain: ".getbb.app",
          expiresAt: 2_000_000,
          name: "__Secure-bb-connect.desktop_session",
          value: "short-lived-signed-cookie",
        },
      },
    }));
    await signIn(current);
    await expect(
      current.harness.callRpc("createDesktopSession"),
    ).resolves.toEqual({
      cookie: {
        domain: ".getbb.app",
        expiresAt: 2_000_000,
        name: "__Secure-bb-connect.desktop_session",
        value: "short-lived-signed-cookie",
      },
    });
  });

  it("createMachineCode mints through the apex via bb account", async () => {
    const current = await loadPlugin();
    account.route("api", "POST", "/api/connect/machine-code", () => ({
      status: 200,
      body: {
        code: "ABCD-EFGH",
        expiresInMs: 600_000,
        serverUrl: "https://sawyer.getbb.app",
      },
    }));
    await signIn(current);
    const before = Date.now();
    const minted = (await current.harness.callRpc("createMachineCode")) as {
      code: string;
      serverUrl: string;
      expiresAt: number;
    };
    expect(minted).toMatchObject({
      code: "ABCD-EFGH",
      serverUrl: "https://sawyer.getbb.app",
    });
    expect(minted.expiresAt).toBeGreaterThanOrEqual(before + 600_000);
  });

  it("createMachineCode reports not_paired without making a request", async () => {
    const { harness } = await loadPlugin();
    await expect(harness.callRpc("createMachineCode")).rejects.toThrow(
      "not_paired",
    );
    expect(account.fetches).toEqual([]);
  });

  it("createMachineCode maps a 409 to machine_limit", async () => {
    const current = await loadPlugin();
    account.route("api", "POST", "/api/connect/machine-code", () => ({
      status: 409,
      body: { error: "machine-limit" },
    }));
    await signIn(current);
    await expect(current.harness.callRpc("createMachineCode")).rejects.toThrow(
      "machine_limit",
    );
  });

  it("revokeMachine posts through bb account", async () => {
    const current = await loadPlugin();
    const revoked: unknown[] = [];
    account.route("api", "POST", "/api/connect/revoke-machine", (request) => {
      revoked.push(request.body);
      return { status: 200, body: { ok: true } };
    });
    await signIn(current);

    await expect(
      current.harness.callRpc("revokeMachine", { machineId: "machine-1" }),
    ).resolves.toEqual({ ok: true });
    expect(revoked).toEqual([{ machineId: "machine-1" }]);
  });
});

describe("connect CLI", () => {
  let host: FakePluginHost | undefined;
  let account: FakeAccount;
  let tunnelService:
    | { controller: AbortController; done: Promise<void> }
    | undefined;

  afterEach(async () => {
    if (tunnelService) {
      tunnelService.controller.abort();
      await tunnelService.done;
      tunnelService = undefined;
    }
    if (host) {
      await host.harness.dispose();
      host = undefined;
    }
    vi.unstubAllGlobals();
  });

  async function loadCli(options?: {
    mobileApp?: boolean;
    remoteIdentity?: { label: string; baseDomain: string };
  }): Promise<FakePluginHost> {
    account = new FakeAccount();
    host = createConnectFakeHost({ ...options, account });
    await createConnectPlugin({ accountRetryMinMs: 20 })(
      host.bb as unknown as Parameters<typeof plugin>[0],
    );
    return host;
  }

  async function signIn(
    current: FakePluginHost,
    overrides: Partial<typeof TEST_ACCOUNT> = {},
  ): Promise<void> {
    account.signIn(overrides);
    tunnelService ??= current.harness.runService("tunnel");
    await vi.waitFor(async () => {
      expect(
        ((await current.harness.callRpc("status")) as ConnectStatus).paired,
      ).toBe(true);
    });
  }

  it("bare `bb connect` prints a how-to, not an argument error", async () => {
    const { harness } = await loadCli();
    const result = await harness.runCli([]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("getbb.app");
    expect(result.stdout).toContain("bb account login");
    expect(result.stdout).toContain("bb connect status");
    expect(result.stdout).toContain("bb connect expose");
  });

  it("`bb connect --code --server` signs in through bb account (the dashboard command)", async () => {
    const { harness } = await loadCli();
    account.redeem = () => ({
      ...TEST_ACCOUNT,
      serverUrl: "http://sawyer.localhost:59324",
      serverLabel: "sawyer",
    });
    const result = await harness.runCli([
      "--code",
      "ABCD",
      "--server",
      "https://sawyer.getbb.app",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Paired as sawyer — reachable at http://sawyer.localhost:59324",
    );
    expect(account.redemptions).toEqual([
      { code: "ABCD", baseUrl: "https://getbb.app" },
    ]);

    await harness.runCli([
      "--code",
      "WXYZ",
      "--base-url",
      "http://bb.localhost:1",
    ]);
    expect(account.redemptions.at(-1)).toEqual({
      code: "WXYZ",
      baseUrl: "http://bb.localhost:1",
    });
  });

  it("`bb connect --code` turns remote access back on", async () => {
    const { harness } = await loadCli();
    await harness.runCli(["off"]);
    account.redeem = () => TEST_ACCOUNT;
    const result = await harness.runCli(["--code", "ABCD", "--json"]);
    expect(JSON.parse(result.stdout ?? "")).toMatchObject({
      paired: true,
      enabled: true,
    });
  });

  it("`--server` without `--code` is a usage error", async () => {
    const { harness } = await loadCli();
    const result = await harness.runCli(["--server", "https://x.getbb.app"]);
    expect(result.exitCode).toBe(1);
    expect(account.redemptions).toEqual([]);
  });

  it("a failed pair explains the code error on stderr", async () => {
    const { harness } = await loadCli();
    account.redeem = () => {
      throw new Error("expired_code");
    };
    const result = await harness.runCli([
      "--code",
      "OLD",
      "--server",
      "https://sawyer.getbb.app",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("that code has expired");
  });

  it("says so when the bb account plugin isn't running", async () => {
    const { harness } = await loadCli();
    account.available = false;
    const result = await harness.runCli(["--code", "ABCD"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("bb account plugin isn't running");
  });

  it("`bb connect off` keeps the account signed in and `on` restores remote access", async () => {
    const current = await loadCli();
    const { harness } = current;
    const before = await harness.runCli(["status"]);
    expect(before.exitCode).toBe(0);
    expect(before.stdout).toContain("Not signed in to a bb account");

    await signIn(current);
    const off = await harness.runCli(["off"]);
    expect(off.exitCode).toBe(0);
    expect(off.stdout).toContain("Remote access is off");
    expect(off.stdout).toContain("bb account logout");
    expect(account.status.state).toBe("signed-in");
    const offStatus = await harness.runCli(["status"]);
    expect(offStatus.stdout).toContain("sawyer  https://sawyer.getbb.app  off");

    const on = await harness.runCli(["on"]);
    expect(on.exitCode).toBe(0);
    expect(on.stdout).toContain(
      "Remote access is on — reachable at https://sawyer.getbb.app",
    );
    const json = await harness.runCli(["status", "--json"]);
    expect(JSON.parse(json.stdout ?? "")).toMatchObject({ enabled: true });
  });

  it("unknown subcommands fail with help", async () => {
    const { harness } = await loadCli();
    const result = await harness.runCli(["bogus"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("unknown command 'bogus'");
    expect(result.stderr).toContain("bb connect status");
  });

  it("`--help` prints help on stdout at every level", async () => {
    const { harness } = await loadCli();
    for (const argv of [["--help"], ["-h"], ["shares", "--help"]]) {
      const result = await harness.runCli(argv);
      expect(result.exitCode, argv.join(" ")).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("bb connect");
    }
    expect((await harness.runCli(["expose", "--help"])).stdout).toContain(
      "<port>",
    );
  });

  it("`bb connect list` points at shares", async () => {
    const { harness } = await loadCli();
    const result = await harness.runCli(["list"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("(Did you mean shares?)");
  });

  it("rejects an unknown flag instead of ignoring it", async () => {
    const { harness } = await loadCli();
    const result = await harness.runCli(["shares", "--hosts", "bee"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("unknown option '--hosts'");
    expect(result.stderr).toContain("(Did you mean --host?)");
  });

  it("expose, servers, and machine-code explain how to sign in when signed out", async () => {
    const { harness } = await loadCli();
    for (const argv of [["expose", "8000"], ["servers"], ["machine-code"]]) {
      const result = await harness.runCli(argv);
      expect(result.exitCode, argv.join(" ")).toBe(1);
      expect(result.stderr).toContain("isn't signed in to a bb account");
    }
    expect(account.fetches).toEqual([]);
  });

  it("servers lists account servers as a table or json", async () => {
    const current = await loadCli();
    account.route("gate", "GET", "/api/connect/servers", () => ({
      status: 200,
      body: {
        servers: [
          { handle: "sawyer", name: "default", live: true },
          { handle: "sawyer-desktop", name: "desktop", live: false },
        ],
      },
    }));
    await signIn(current, {
      serverUrl: "http://sawyer.localhost:59342",
      serverLabel: "sawyer",
      baseUrl: "http://localhost:59342",
    });

    const table = await current.harness.runCli(["servers"]);
    expect(table.exitCode).toBe(0);
    expect(table.stdout).toContain("sawyer");
    expect(table.stdout).toContain("desktop");
    expect(table.stdout).toContain("http://sawyer.localhost:59342");
    expect(table.stdout).toContain("http://sawyer-desktop.localhost:59342");
    expect(table.stdout).toContain("yes");
    expect(table.stdout).toContain("no");

    const json = await current.harness.runCli(["servers", "--json"]);
    expect(json.exitCode).toBe(0);
    const parsed = JSON.parse(json.stdout ?? "") as {
      servers: Array<{ handle: string; url: string }>;
      selfHandle: string;
    };
    expect(parsed.selfHandle).toBe("sawyer");
    expect(parsed.servers).toHaveLength(2);
    expect(parsed.servers[1]?.url).toBe(
      "http://sawyer-desktop.localhost:59342",
    );
  });

  it("machine-code is off until the mobileApp experiment is on", async () => {
    const { harness } = await loadCli({ mobileApp: false });
    const result = await harness.runCli(["machine-code"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('"Mobile app" experiment');
    expect(result.stderr).toContain("bb settings experiment mobileApp true");
    expect(account.fetches).toEqual([]);
  });

  it("machine-code prints the pairing payload as text or json", async () => {
    const current = await loadCli();
    account.route("api", "POST", "/api/connect/machine-code", () => ({
      status: 200,
      body: {
        code: "K7QP-2M4X",
        expiresInMs: 600_000,
        serverUrl: "https://sawyer.getbb.app",
      },
    }));
    await signIn(current);

    const before = Date.now();
    const text = await current.harness.runCli(["machine-code"]);
    expect(text.exitCode).toBe(0);
    expect(text.stdout).toContain("Code:       K7QP-2M4X");
    expect(text.stdout).toContain("Server:     https://sawyer.getbb.app");
    expect(text.stdout).toContain("Apex:       https://getbb.app");
    expect(text.stdout).toContain("in about 10 min");
    expect(text.stdout).toContain("Add mobile device");

    const json = await current.harness.runCli(["machine-code", "--json"]);
    expect(json.exitCode).toBe(0);
    const parsed = JSON.parse(json.stdout ?? "") as Record<string, unknown>;
    expect(parsed).toEqual({
      code: "K7QP-2M4X",
      serverUrl: "https://sawyer.getbb.app",
      apex: "https://getbb.app",
      expiresAt: expect.any(Number),
    });
    expect(parsed.expiresAt as number).toBeGreaterThanOrEqual(before + 600_000);
  });

  it("machine-code explains the account machine limit and names the dashboard", async () => {
    const current = await loadCli();
    account.route("api", "POST", "/api/connect/machine-code", () => ({
      status: 409,
      body: { error: "machine-limit" },
    }));
    await signIn(current);
    const result = await current.harness.runCli(["machine-code"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("machine limit");
    expect(result.stderr).toContain("https://getbb.app/dashboard");
    expect(result.stderr).not.toContain("machine_limit");
  });

  it("expose / shares / unexpose happy path", async () => {
    const current = await loadCli();
    await signIn(current, {
      serverUrl: "http://sawyer.localhost:59331",
      serverLabel: "sawyer",
    });
    const { harness } = current;

    const shareUrl = "http://sawyer--8000.localhost:59331";
    const exposed = await harness.runCli(["expose", "8000"]);
    expect(exposed.exitCode).toBe(0);
    expect(exposed.stdout).toContain(shareUrl);

    const shares = await harness.runCli(["shares"]);
    expect(shares.exitCode).toBe(0);
    expect(shares.stdout).toContain("8000");
    expect(shares.stdout).toContain(shareUrl);

    const status = await harness.runCli(["status"]);
    expect(status.stdout).toContain("shares:");
    expect(status.stdout).toContain("8000");

    const unexpose = await harness.runCli(["unexpose", "8000"]);
    expect(unexpose.exitCode).toBe(0);
    expect(unexpose.stdout).toContain("Stopped sharing port 8000");

    const again = await harness.runCli(["unexpose", "8000"]);
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toContain("was not shared");

    const empty = await harness.runCli(["shares"]);
    expect(empty.stdout).toContain("No shared ports");
  });

  it("resolves the thread host, honors --host, and defaults no-context calls to the server host", async () => {
    const current = await loadCli({
      remoteIdentity: { label: "sawyer-air", baseDomain: "getbb.app" },
    });
    current.harness.sdk.stub(
      "threads.get",
      async () => ({ environment: { hostId: REMOTE_HOST_ID } }) as never,
    );
    await signIn(current, {
      serverUrl: "http://sawyer.localhost:59336",
      serverLabel: "sawyer",
    });

    const fromThread = await current.harness.runCli(["expose", "3000"], {
      threadId: "thread-air",
    });
    expect(fromThread).toMatchObject({
      exitCode: 0,
      stdout: "https://sawyer-air--3000.getbb.app\n",
    });

    const overridden = await current.harness.runCli(
      ["expose", "3000", "--host", SERVER_HOST_NAME],
      { threadId: "thread-air" },
    );
    expect(overridden).toMatchObject({
      exitCode: 0,
      stdout: "http://sawyer--3000.localhost:59336\n",
    });

    const noContext = await current.harness.runCli(["expose", "3001"]);
    expect(noContext).toMatchObject({
      exitCode: 0,
      stdout: "http://sawyer--3001.localhost:59336\n",
    });

    const threadShares = await current.harness.runCli(["shares", "--json"], {
      threadId: "thread-air",
    });
    expect(JSON.parse(threadShares.stdout ?? "")).toEqual({
      host: {
        id: REMOTE_HOST_ID,
        name: REMOTE_HOST_NAME,
        isServer: false,
      },
      shares: [
        {
          hostId: REMOTE_HOST_ID,
          hostName: REMOTE_HOST_NAME,
          port: 3000,
          url: "https://sawyer-air--3000.getbb.app",
          createdAt: expect.any(Number),
        },
      ],
    });
    const serverShares = await current.harness.runCli(["shares"]);
    expect(serverShares.stdout).toContain(
      `${SERVER_HOST_NAME} (${SERVER_HOST_ID})  3000`,
    );
    expect(serverShares.stdout).toContain(
      `${SERVER_HOST_NAME} (${SERVER_HOST_ID})  3001`,
    );
    const status = await current.harness.runCli(["status"]);
    expect(status.stdout).toContain(
      `${REMOTE_HOST_NAME} (${REMOTE_HOST_ID})  3000  https://sawyer-air--3000.getbb.app`,
    );

    const removed = await current.harness.runCli(["unexpose", "3000"], {
      threadId: "thread-air",
    });
    expect(removed.stdout).toContain(
      `Stopped sharing port 3000 on ${REMOTE_HOST_NAME} (${REMOTE_HOST_ID})`,
    );
    expect(current.harness.sharedPortDeclarations).toEqual([
      { hostId: REMOTE_HOST_ID, ports: [] },
    ]);
  });
});
