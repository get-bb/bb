import { createServer, type Server } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getHost,
  getLatestSessionForHost,
  getOrCreateServerId,
  listHostServerAccessGrants,
  setAppSettings,
  setExperiments,
  upsertHost,
} from "@bb/db";
import { defaultAppSettings } from "@bb/domain";
import type { ServerAccessProviderDeclaration } from "@get-bb/plugin-sdk";
import { HOST_DAEMON_PROTOCOL_VERSION } from "@bb/host-daemon-contract";
import {
  routesForHost,
  serverAccess,
  serverAccessOverview,
} from "../../../src/services/machines/server-access.js";
import { setServerAccessBridge } from "../../../src/services/plugins/plugin-server-access-registry.js";
import {
  detectLocalNetworkAddresses,
  LocalNetworkAccess,
  setLocalNetworkAccess,
} from "../../../src/services/server-routes/local-network.js";
import { feedRawDaemonWebSocketMessage } from "../../helpers/daemon-ws.js";
import { seedHostSession } from "../../helpers/seed.js";
import {
  createTestDaemonHostKey,
  startTestServer,
  withTestHarness,
} from "../../helpers/test-app.js";

const LAN_INTERFACES = () => ({
  lo0: [
    {
      address: "127.0.0.1",
      netmask: "255.0.0.0",
      family: "IPv4" as const,
      mac: "00:00:00:00:00:00",
      internal: true,
      cidr: "127.0.0.1/8",
    },
  ],
  en0: [
    {
      address: "192.168.1.5",
      netmask: "255.255.255.0",
      family: "IPv4" as const,
      mac: "aa:bb:cc:dd:ee:ff",
      internal: false,
      cidr: "192.168.1.5/24",
    },
  ],
  utun3: [
    {
      address: "100.101.102.103",
      netmask: "255.255.255.255",
      family: "IPv4" as const,
      mac: "00:00:00:00:00:00",
      internal: false,
      cidr: "100.101.102.103/32",
    },
  ],
  awdl0: [
    {
      address: "169.254.10.20",
      netmask: "255.255.0.0",
      family: "IPv4" as const,
      mac: "00:00:00:00:00:00",
      internal: false,
      cidr: "169.254.10.20/16",
    },
  ],
});

function relay(
  overrides: Partial<ServerAccessProviderDeclaration> = {},
): ServerAccessProviderDeclaration {
  return {
    id: "relay",
    displayName: "Relay",
    description: "Use a managed relay.",
    routeKind: "relay",
    availability: () => ({
      status: "available",
      serverUrl: "https://relay.example.com",
    }),
    acquire: async ({ hostId }) => ({
      id: hostId,
      serverUrl: "https://relay.example.com",
      headers: { "x-relay-machine": `credential-${hostId}` },
    }),
    release: async () => {},
    ...overrides,
  };
}

function installProviders(...providers: ServerAccessProviderDeclaration[]) {
  setServerAccessBridge({
    list: () =>
      providers.map((provider) => ({ pluginId: "access-plugin", provider })),
    invoke: async (_record, run) => run(),
  });
}

function installLan(enabled: () => boolean) {
  setLocalNetworkAccess(
    new LocalNetworkAccess({
      bindHost: "0.0.0.0",
      port: 38886,
      logger: { info: () => {}, warn: () => {} },
      isEnabled: enabled,
      readInterfaces: LAN_INTERFACES,
    }),
  );
}

afterEach(() => {
  setServerAccessBridge(undefined);
  setLocalNetworkAccess(null);
  vi.unstubAllEnvs();
});

describe("server routes", () => {
  it("detects only private LAN IPv4 addresses", () => {
    expect(detectLocalNetworkAddresses(LAN_INTERFACES)).toEqual([
      "192.168.1.5",
    ]);
  });

  it("offers only the address this computer routes through, leaving out virtual bridges, and every address when that is unknown", async () => {
    const interfaces = () => ({
      ...LAN_INTERFACES(),
      bridge100: [
        {
          address: "192.168.139.3",
          netmask: "255.255.254.0",
          family: "IPv4" as const,
          mac: "00:00:00:00:00:00",
          internal: false,
          cidr: "192.168.139.3/23",
        },
      ],
    });
    const urlsWith = async (primary: string | null) => {
      const access = new LocalNetworkAccess({
        bindHost: "0.0.0.0",
        port: 38886,
        logger: { info: () => {}, warn: () => {} },
        isEnabled: () => true,
        readInterfaces: interfaces,
        findPrimaryAddress: async () => primary,
      });
      access.attach(createServer());
      try {
        await vi.waitFor(() =>
          expect(access.state().urls.length).toBe(primary === null ? 2 : 1),
        );
        return access.state().urls;
      } finally {
        access.stop();
      }
    };
    expect(await urlsWith("192.168.1.5")).toEqual(["http://192.168.1.5:38886"]);
    expect(await urlsWith(null)).toEqual([
      "http://192.168.1.5:38886",
      "http://192.168.139.3:38886",
    ]);
  });

  const lanAddress = detectLocalNetworkAddresses()[0];

  it.skipIf(lanAddress === undefined)(
    "drops connections already upgraded over the local network when the route is removed",
    async () => {
      const address = lanAddress ?? "";
      const probe = createServer();
      await new Promise<void>((resolve) =>
        probe.listen(0, address, () => resolve()),
      );
      const port = (probe.address() as AddressInfo).port;
      await new Promise<void>((resolve) => probe.close(() => resolve()));
      const target: Server = createServer();
      target.on("upgrade", (_request, socket) => {
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\nUpgrade: test\r\nConnection: Upgrade\r\n\r\n",
        );
      });
      let enabled = true;
      const access = new LocalNetworkAccess({
        bindHost: "127.0.0.1",
        port,
        logger: { info: () => {}, warn: () => {} },
        isEnabled: () => enabled,
        readInterfaces: () => ({
          en0: [
            {
              address,
              netmask: "255.255.255.0",
              family: "IPv4",
              mac: "00:00:00:00:00:00",
              internal: false,
              cidr: `${address}/24`,
            },
          ],
        }),
      });
      try {
        access.attach(target);
        await vi.waitFor(() =>
          expect(access.state().urls).toEqual([
            `http://${address}:${String(port)}`,
          ]),
        );
        const client = connect(port, address);
        const upgraded = new Promise<void>((resolve) =>
          client.once("data", () => resolve()),
        );
        const closed = new Promise<void>((resolve) =>
          client.once("close", () => resolve()),
        );
        client.write(
          `GET / HTTP/1.1\r\nHost: ${address}\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n`,
        );
        await upgraded;
        enabled = false;
        access.reconcile();
        await closed;
        expect(client.destroyed).toBe(true);
      } finally {
        access.stop();
      }
    },
  );

  it("advertises the local network as soon as it is turned on, before its listeners are reconciled", async () => {
    await withTestHarness(async ({ deps }) => {
      setExperiments(deps.db, { serverRoutes: true });
      installProviders();
      setAppSettings(deps.db, {
        ...defaultAppSettings,
        localNetworkEnabled: true,
      });
      let enabled = false;
      const access = new LocalNetworkAccess({
        bindHost: "127.0.0.1",
        port: 38886,
        logger: { info: () => {}, warn: () => {} },
        isEnabled: () => enabled,
        readInterfaces: LAN_INTERFACES,
      });
      setLocalNetworkAccess(access);
      try {
        access.attach(createServer());
        enabled = true;
        const host = upsertHost(deps.db, deps.hub, { name: "laptop" })!;
        expect(
          (
            await routesForHost(deps, {
              hostId: host.id,
              signal: AbortSignal.timeout(5_000),
            })
          ).routes.map((route) => route.url),
        ).toEqual(["http://192.168.1.5:38886"]);
      } finally {
        access.stop();
      }
    });
  });

  it("keeps one server id across reads", async () => {
    await withTestHarness(async ({ db }) => {
      const first = getOrCreateServerId(db);
      expect(first).toMatch(/^srv_[0-9a-f]{32}$/u);
      expect(getOrCreateServerId(db)).toBe(first);
    });
  });

  it("advertises no routes, hides Local network and acquires no grants while the serverRoutes experiment is off", async () => {
    await withTestHarness(async ({ deps }) => {
      vi.stubEnv("BB_EXTERNAL_URL", "https://bb.example.com");
      const acquire = vi.fn(relay().acquire);
      installProviders(relay({ acquire }));
      installLan(() => true);
      setAppSettings(deps.db, {
        ...defaultAppSettings,
        localNetworkEnabled: true,
      });
      const overview = await serverAccessOverview(deps);
      expect(overview.routes).toEqual([]);
      expect(overview.status.providers.map((provider) => provider.id)).toEqual([
        "relay",
        "direct",
      ]);
      const host = upsertHost(deps.db, deps.hub, { name: "laptop" })!;
      expect(
        await routesForHost(deps, {
          hostId: host.id,
          signal: AbortSignal.timeout(5_000),
        }),
      ).toEqual({ serverId: getOrCreateServerId(deps.db), routes: [] });
      expect(acquire).not.toHaveBeenCalled();
    });
  });

  it("advertises available routes in order with Local network off until it is added", async () => {
    await withTestHarness(async ({ deps }) => {
      vi.stubEnv("BB_EXTERNAL_URL", "https://bb.example.com");
      setExperiments(deps.db, { serverRoutes: true });
      installProviders(relay());
      installLan(() => false);
      expect((await serverAccessOverview(deps)).routes).toEqual([
        {
          providerId: "relay",
          kind: "relay",
          displayName: "Relay",
          url: "https://relay.example.com",
        },
        {
          providerId: "direct",
          kind: "custom",
          displayName: "Manual",
          url: "https://bb.example.com",
        },
      ]);
      setAppSettings(deps.db, {
        ...defaultAppSettings,
        localNetworkEnabled: true,
      });
      installLan(() => true);
      const overview = await serverAccessOverview(deps);
      expect(overview.routes.map((route) => route.url)).toEqual([
        "http://192.168.1.5:38886",
        "https://relay.example.com",
        "https://bb.example.com",
      ]);
      expect(overview.status.localNetwork).toEqual({
        bindHost: "0.0.0.0",
        addresses: ["192.168.1.5"],
        listenerError: null,
      });
    });
  });

  it("gives each machine every available route with its own headers and records lazy grants", async () => {
    await withTestHarness(async ({ deps }) => {
      vi.stubEnv("BB_EXTERNAL_URL", "https://bb.example.com");
      setExperiments(deps.db, { serverRoutes: true });
      const acquire = vi.fn(relay().acquire);
      installProviders(relay({ acquire }));
      installLan(() => true);
      setAppSettings(deps.db, {
        ...defaultAppSettings,
        localNetworkEnabled: true,
      });
      const host = upsertHost(deps.db, deps.hub, { name: "laptop" })!;
      const routes = await routesForHost(deps, {
        hostId: host.id,
        signal: AbortSignal.timeout(5_000),
      });
      expect(routes).toEqual({
        serverId: getOrCreateServerId(deps.db),
        routes: [
          {
            providerId: "local-network",
            kind: "local-network",
            url: "http://192.168.1.5:38886",
            headers: {},
          },
          {
            providerId: "relay",
            kind: "relay",
            url: "https://relay.example.com",
            headers: { "x-relay-machine": `credential-${host.id}` },
          },
          {
            providerId: "direct",
            kind: "custom",
            url: "https://bb.example.com",
            headers: {},
          },
        ],
      });
      expect(
        listHostServerAccessGrants(deps.db, host.id).map((grant) => [
          grant.providerId,
          grant.grantId,
        ]),
      ).toEqual([["relay", host.id]]);
      setAppSettings(deps.db, {
        ...defaultAppSettings,
        serverAccessOrder: ["direct"],
      });
      expect(
        (
          await routesForHost(deps, {
            hostId: host.id,
            signal: AbortSignal.timeout(5_000),
          })
        ).routes.map((route) => route.providerId),
      ).toEqual(["direct", "relay"]);
      expect(acquire).toHaveBeenCalledTimes(2);
    });
  });

  it("answers without a slow provider and reports its route once it arrives", async () => {
    await withTestHarness(async ({ deps }) => {
      setExperiments(deps.db, { serverRoutes: true });
      let finish: (() => void) | undefined;
      installProviders(
        relay({
          acquire: ({ hostId }) =>
            new Promise((resolve) => {
              finish = () =>
                resolve({
                  id: hostId,
                  serverUrl: "https://relay.example.com",
                  headers: {},
                });
            }),
        }),
      );
      const host = upsertHost(deps.db, deps.hub, { name: "slow" })!;
      const late = vi.fn();
      const quick = await routesForHost(deps, {
        hostId: host.id,
        signal: AbortSignal.timeout(5_000),
        providerDeadlineMs: 20,
        onLateRoutes: late,
      });
      expect(quick.routes).toEqual([]);
      finish?.();
      await vi.waitFor(() => expect(late).toHaveBeenCalledOnce());
      expect(late.mock.calls[0]?.[0].routes).toEqual([
        {
          providerId: "relay",
          kind: "relay",
          url: "https://relay.example.com",
          headers: {},
        },
      ]);
    });
  });

  it("returns the server id and routes from health, config, and session open, and records the reported route", async () => {
    const server = await startTestServer();
    try {
      setExperiments(server.db, { serverRoutes: true });
      installProviders(relay());
      const health = await fetch(`${server.baseUrl}/health`).then(
        (response) => response.json() as Promise<{ serverId: string }>,
      );
      const config = await fetch(`${server.baseUrl}/api/v1/system/config`).then(
        (response) =>
          response.json() as Promise<{
            serverId: string;
            routes: Array<{ providerId: string }>;
          }>,
      );
      expect(config.serverId).toBe(health.serverId);
      expect(config.routes.map((route) => route.providerId)).toEqual(["relay"]);
      const hostId = "host-routes";
      upsertHost(server.db, server.hub, { id: hostId, name: "Laptop" });
      const opened = await fetch(`${server.baseUrl}/internal/session/open`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${createTestDaemonHostKey({ hostId })}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          hostId,
          instanceId: "instance-routes",
          hostName: "Laptop",
          hasMachineCredential: false,
          platform: "darwin",
          dataDir: "/tmp/host-routes",
          localApiPort: null,
          protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
          activeThreads: [],
          openThreadWork: [],
          turnCommandThreadIds: [],
          undeliveredEventThreadIds: [],
          loadedEnvironments: [],
          route: { providerId: "relay", kind: "relay" },
        }),
      });
      expect(opened.status).toBe(201);
      const body = (await opened.json()) as {
        serverRoutes: { serverId: string; routes: Array<{ url: string }> };
      };
      expect(body.serverRoutes.serverId).toBe(health.serverId);
      expect(body.serverRoutes.routes.map((route) => route.url)).toEqual([
        "https://relay.example.com",
      ]);
      expect(getLatestSessionForHost(server.db, { hostId })).toMatchObject({
        routeProviderId: "relay",
        routeKind: "relay",
      });
    } finally {
      await server.close();
    }
  });

  it("records the route a resumed session reports and tells clients", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-route-report",
      });
      const notifyHost = vi.spyOn(harness.deps.hub, "notifyHost");
      const socket = { close: vi.fn(), send: vi.fn() };
      for (const route of [
        { providerId: "local-network", kind: "local-network" },
        null,
      ] as const) {
        feedRawDaemonWebSocketMessage({
          harness,
          hostId: host.id,
          sessionId: session.id,
          socket,
          rawMessage: { type: "session.route", route },
        });
        expect(
          getLatestSessionForHost(harness.deps.db, { hostId: host.id }),
        ).toMatchObject({
          routeProviderId: route?.providerId ?? null,
          routeKind: route?.kind ?? null,
        });
      }
      expect(notifyHost).toHaveBeenCalledWith(host.id, ["host-connected"]);
      expect(socket.close).not.toHaveBeenCalled();
    });
  });

  it("admits route hostnames without BB_APP_URL and refuses Manual's once its URL is cleared", async () => {
    await withTestHarness(async (h) => {
      setExperiments(h.db, { serverRoutes: true });
      setAppSettings(h.db, {
        ...defaultAppSettings,
        machineServerUrl: "https://bb.custom.example:8443",
      });
      installProviders(relay());
      await serverAccessOverview(h.deps);
      const request = (origin: string) =>
        h.app.request("/api/v1/system/attention", {
          headers: { host: new URL(origin).host, origin },
        });
      expect((await request("https://relay.example.com")).status).toBe(200);
      expect((await request("https://bb.custom.example:8443")).status).toBe(
        200,
      );
      setAppSettings(h.db, defaultAppSettings);
      await serverAccessOverview(h.deps);
      expect((await request("https://bb.custom.example:8443")).status).toBe(
        403,
      );
      expect((await request("https://relay.example.com")).status).toBe(200);
    });
  });

  it("installs a new machine on Local network only when no other route works", async () => {
    await withTestHarness(async ({ deps }) => {
      vi.stubEnv("BB_EXTERNAL_URL", "https://bb.example.com");
      setExperiments(deps.db, { serverRoutes: true });
      installProviders();
      installLan(() => true);
      setAppSettings(deps.db, {
        ...defaultAppSettings,
        localNetworkEnabled: true,
        serverAccessOrder: ["local-network", "direct"],
      });
      const installRoute = async (name: string) => {
        const host = upsertHost(deps.db, deps.hub, { name })!;
        await serverAccess.resolve(deps, {
          key: name,
          hostId: host.id,
          signal: AbortSignal.timeout(5_000),
        });
        return getHost(deps.db, host.id)?.serverAccessProviderId;
      };
      expect(await installRoute("travels")).toBe("direct");
      vi.stubEnv("BB_EXTERNAL_URL", "");
      expect(await installRoute("stays-home")).toBe("local-network");
    });
  });

  describe("route addresses across restarts and failures", () => {
    const relayRequest = {
      headers: {
        host: "relay.example.com",
        origin: "https://relay.example.com",
      },
    };
    const manualRequest = {
      headers: {
        host: "bb.custom.example:8443",
        origin: "https://bb.custom.example:8443",
      },
    };

    it("admits every route's address from the first request after a restart, before plugins load", async () => {
      await withTestHarness(async (h) => {
        setExperiments(h.db, { serverRoutes: true });
        setAppSettings(h.db, {
          ...defaultAppSettings,
          machineServerUrl: "https://bb.custom.example:8443",
        });
        installProviders(relay());
        await serverAccessOverview(h.deps);

        vi.resetModules();
        const { createApp } = await import("../../../src/server.js");
        const restarted = createApp(h.deps);
        try {
          for (const request of [relayRequest, manualRequest]) {
            for (const path of ["/health", "/api/v1/system/attention"]) {
              expect(
                (
                  await restarted.app.request(
                    `http://localhost${path}`,
                    request,
                  )
                ).status,
              ).toBe(200);
            }
          }
          expect(
            (
              await restarted.app.request("http://localhost/health", {
                headers: { host: "other.example.com" },
              })
            ).status,
          ).toBe(403);
        } finally {
          await restarted.pluginService.stop();
        }
      });
    });

    it("keeps a route's address through a failed check and drops it on a definite answer, or for core routes with the experiment off", async () => {
      await withTestHarness(async (h) => {
        setExperiments(h.db, { serverRoutes: true });
        const routeSettings = {
          ...defaultAppSettings,
          machineServerUrl: "https://bb.custom.example:8443",
        };
        setAppSettings(h.db, routeSettings);
        let availability: ServerAccessProviderDeclaration["availability"] =
          () => ({
            status: "available",
            serverUrl: "https://relay.example.com",
          });
        installProviders(relay({ availability: () => availability() }));
        const status = async () =>
          (await h.app.request("http://localhost/health", relayRequest)).status;
        const manualStatus = async () =>
          (await h.app.request("http://localhost/health", manualRequest))
            .status;
        await serverAccessOverview(h.deps);
        expect(await status()).toBe(200);

        availability = () => {
          throw new Error("relay status timed out");
        };
        await serverAccessOverview(h.deps);
        expect(await status()).toBe(200);

        availability = () => ({
          status: "unavailable",
          message: "The relay is stopped",
        });
        await serverAccessOverview(h.deps);
        expect(await status()).toBe(403);

        availability = () => ({
          status: "available",
          serverUrl: "https://relay.example.com",
        });
        await serverAccessOverview(h.deps);
        expect(await status()).toBe(200);
        expect(await manualStatus()).toBe(200);
        setExperiments(h.db, { serverRoutes: false });
        await serverAccessOverview(h.deps);
        expect(await status()).toBe(200);
        expect(await manualStatus()).toBe(403);
      });
    });
  });
});
