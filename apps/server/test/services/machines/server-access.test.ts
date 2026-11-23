import { createDeferredPromise } from "@bb/test-helpers";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  getHost,
  getHostServerAccessGrant,
  installedPlugins,
  setAppSettings,
  setExperiments,
  updateHost,
  upsertHost,
} from "@bb/db";
import { defaultAppSettings } from "@bb/domain";
import type { ServerAccessProviderDeclaration } from "@get-bb/plugin-sdk";
import {
  serverAccess,
  serverAccessStatus,
} from "../../../src/services/machines/server-access.js";
import { setServerAccessBridge } from "../../../src/services/plugins/plugin-server-access-registry.js";
import { listPublicHostsWithStatus } from "../../../src/services/lib/entity-lookup.js";
import { createApp } from "../../../src/server.js";
import { advanceUntilSettled } from "../../helpers/fake-timers.js";
import { withTestHarness } from "../../helpers/test-app.js";

const signal = new AbortController().signal;

afterEach(() => {
  setServerAccessBridge(undefined);
  vi.unstubAllEnvs();
});

function grantId(
  deps: { db: Parameters<typeof getHostServerAccessGrant>[0] },
  hostId: string,
): string | null | undefined {
  const row = getHostServerAccessGrant(deps.db, {
    hostId,
    providerId: "relay",
  });
  return row === null ? undefined : row.grantId;
}

function installProvider(provider: ServerAccessProviderDeclaration) {
  setServerAccessBridge({
    list: () => [{ pluginId: "access-plugin", provider }],
    invoke: async (_id, run) => run(),
  });
}

function provider(): ServerAccessProviderDeclaration {
  return {
    id: "relay",
    displayName: "Relay",
    description: "Use a managed relay.",
    routeKind: "custom",
    availability: () => ({ status: "available" }),
    acquire: async ({ hostId }) => ({
      id: hostId,
      serverUrl: "https://bb.example.com",
      headers: { "x-access-token": "secret-header" },
    }),
    release: async () => {},
  };
}

describe("machine server access", () => {
  it("cancels a pending availability check without acquiring access when it later resolves", async () => {
    await withTestHarness(async ({ deps }) => {
      const controller = new AbortController();
      const pending = createDeferredPromise<{ status: "available" }>();
      const availability = vi.fn(() => pending.promise);
      const acquire = vi.fn(provider().acquire);
      installProvider({ ...provider(), availability, acquire });
      const host = upsertHost(deps.db, deps.hub, { name: "cancelled" })!;
      const result = serverAccess.resolve(deps, {
        key: "cancelled",
        hostId: host.id,
        signal: controller.signal,
      });
      const rejected = expect(result).rejects.toThrow("Cancelled by user");
      await vi.waitFor(() => expect(availability).toHaveBeenCalledOnce());
      controller.abort(new Error("Cancelled by user"));
      await rejected;
      pending.resolve({ status: "available" });
      await pending.promise;
      expect(acquire).not.toHaveBeenCalled();
      expect(getHost(deps.db, host.id)?.serverAccessProviderId).toBeNull();
    });
  });

  it("orders providers by the user's order, then route kind, and installs on the first one while serverRoutes is on", async () => {
    await withTestHarness(async ({ deps }) => {
      vi.stubEnv("BB_EXTERNAL_URL", "https://direct.example.com");
      setExperiments(deps.db, { serverRoutes: true });
      installProvider({ ...provider(), routeKind: "relay" });
      const ids = async () =>
        (await serverAccessStatus(deps)).providers.map((entry) => entry.id);
      expect(await ids()).toEqual(["local-network", "relay", "direct"]);
      expect(
        (await serverAccessStatus(deps)).providers.find(
          (entry) => entry.id === "relay",
        ),
      ).toMatchObject({
        pluginId: "access-plugin",
        routeKind: "relay",
      });
      setAppSettings(deps.db, {
        ...defaultAppSettings,
        serverAccessOrder: ["direct"],
      });
      expect(await ids()).toEqual(["direct", "local-network", "relay"]);
      const host = upsertHost(deps.db, deps.hub, { name: "test" })!;
      expect(
        (
          await serverAccess.resolve(deps, {
            key: "k",
            hostId: host.id,
            signal,
          })
        ).serverUrl,
      ).toBe("https://direct.example.com");
    });
  });

  it("installs a new machine on a tailnet route the user put first, ahead of a relay, while serverRoutes is on", async () => {
    await withTestHarness(async ({ deps }) => {
      setExperiments(deps.db, { serverRoutes: true });
      const overlay: ServerAccessProviderDeclaration = {
        ...provider(),
        id: "overlay",
        displayName: "Overlay",
        routeKind: "private-overlay",
        availability: () => ({
          status: "available",
          serverUrl: "https://mini.tail1234.ts.net",
        }),
        acquire: async ({ hostId }) => ({
          id: hostId,
          serverUrl: "https://mini.tail1234.ts.net",
        }),
      };
      setServerAccessBridge({
        list: () => [
          { pluginId: "overlay-plugin", provider: overlay },
          {
            pluginId: "access-plugin",
            provider: { ...provider(), routeKind: "relay" },
          },
        ],
        invoke: async (_id, run) => run(),
      });
      setAppSettings(deps.db, {
        ...defaultAppSettings,
        serverAccessOrder: ["overlay", "relay"],
      });
      const resolveFor = async (name: string) => {
        const host = upsertHost(deps.db, deps.hub, { name })!;
        await serverAccess.resolve(deps, {
          key: name,
          hostId: host.id,
          signal,
        });
        return getHost(deps.db, host.id)?.serverAccessProviderId;
      };
      expect(await resolveFor("tailnet")).toBe("overlay");
      setAppSettings(deps.db, {
        ...defaultAppSettings,
        serverAccessOrder: ["relay", "overlay"],
      });
      expect(await resolveFor("cloud")).toBe("relay");
    });
  });

  it("installs a new machine on the user's first route, then the first registered one, while the serverRoutes experiment is off", async () => {
    await withTestHarness(async ({ deps }) => {
      const overlay: ServerAccessProviderDeclaration = {
        ...provider(),
        id: "overlay",
        displayName: "Overlay",
        routeKind: "private-overlay",
        acquire: async ({ hostId }) => ({
          id: hostId,
          serverUrl: "https://mini.tail1234.ts.net",
        }),
      };
      setServerAccessBridge({
        list: () => [
          {
            pluginId: "access-plugin",
            provider: { ...provider(), routeKind: "relay" },
          },
          { pluginId: "overlay-plugin", provider: overlay },
        ],
        invoke: async (_id, run) => run(),
      });
      const resolveFor = async (name: string) => {
        const host = upsertHost(deps.db, deps.hub, { name })!;
        await serverAccess.resolve(deps, {
          key: name,
          hostId: host.id,
          signal,
        });
        return getHost(deps.db, host.id)?.serverAccessProviderId;
      };
      setAppSettings(deps.db, {
        ...defaultAppSettings,
        serverAccessOrder: ["overlay"],
      });
      expect(
        (await serverAccessStatus(deps)).providers.map((entry) => entry.id),
      ).toEqual(["overlay", "relay", "direct"]);
      expect(await resolveFor("tailnet")).toBe("overlay");
      setServerAccessBridge({
        list: () => [
          { pluginId: "overlay-plugin", provider: overlay },
          {
            pluginId: "access-plugin",
            provider: { ...provider(), routeKind: "relay" },
          },
        ],
        invoke: async (_id, run) => run(),
      });
      setAppSettings(deps.db, defaultAppSettings);
      expect(await resolveFor("first-registered")).toBe("overlay");
    });
  });

  it("falls back to the next route when the first needs setup, and reports the first failure when none works", async () => {
    await withTestHarness(async ({ deps }) => {
      vi.stubEnv("BB_EXTERNAL_URL", "https://direct.example.com");
      const availability = vi.fn(() => ({
        status: "setup-required" as const,
        message: "Set up the relay",
      }));
      installProvider({
        ...provider(),
        availability,
      });
      const host = upsertHost(deps.db, deps.hub, { name: "test" })!;
      expect(
        (
          await serverAccess.resolve(deps, {
            key: "k",
            hostId: host.id,
            signal,
          })
        ).serverUrl,
      ).toBe("https://direct.example.com");
      vi.stubEnv("BB_EXTERNAL_URL", "");
      const other = upsertHost(deps.db, deps.hub, { name: "other" })!;
      await expect(
        serverAccess.resolve(deps, { key: "k", hostId: other.id, signal }),
      ).rejects.toThrow("Set up the relay");
    });
  });

  it("returns direct access without headers, including on repair", async () => {
    await withTestHarness(async ({ deps }) => {
      vi.stubEnv("BB_EXTERNAL_URL", "https://direct.example.com");
      const host = upsertHost(deps.db, deps.hub, { name: "direct" })!;
      const args = { key: "direct", hostId: host.id, signal };
      const expected = {
        id: host.id,
        serverUrl: "https://direct.example.com",
      };
      await expect(serverAccess.resolve(deps, args)).resolves.toEqual(expected);
      await expect(serverAccess.repair(deps, args)).resolves.toEqual(expected);
      expect(getHost(deps.db, host.id)?.serverAccessProviderId).toBe("direct");
    });
  });

  it("stores grant identity without its code and retains provider on retry", async () => {
    await withTestHarness(async ({ deps }) => {
      installProvider(provider());
      const host = upsertHost(deps.db, deps.hub, { name: "test" })!;
      const grant = await serverAccess.resolve(deps, {
        key: "k",
        hostId: host.id,
        signal,
      });
      expect(grant.headers).toEqual({ "x-access-token": "secret-header" });
      const row = getHost(deps.db, host.id)!;
      expect(row.serverAccessProviderId).toBe("relay");
      expect(grantId(deps, host.id)).toBe(host.id);
      expect(JSON.stringify(row)).not.toContain("secret-header");
      setAppSettings(deps.db, {
        ...defaultAppSettings,
        serverAccessOrder: ["direct"],
        machineServerUrl: "https://other.example.com",
      });
      expect(
        await serverAccess.resolve(deps, { key: "k", hostId: host.id, signal }),
      ).toEqual(grant);
      await serverAccess.release(deps, { key: "k", hostId: host.id });
      expect(grantId(deps, host.id)).toBeUndefined();
    });
  });

  it("releases before reacquiring from the selected provider and accepts a new grant identity", async () => {
    await withTestHarness(async ({ deps }) => {
      const release = vi.fn(provider().release);
      const acquire = vi.fn(provider().acquire);
      installProvider({ ...provider(), release, acquire });
      const host = upsertHost(deps.db, deps.hub, { name: "test" })!;
      const args = { key: "k", hostId: host.id, signal };
      await serverAccess.resolve(deps, args);
      setAppSettings(deps.db, {
        ...defaultAppSettings,
        serverAccessOrder: ["direct"],
      });
      acquire.mockImplementationOnce(async () => {
        expect(release).toHaveBeenCalledWith({
          key: "k",
          hostId: host.id,
          grantId: host.id,
        });
        return {
          id: "replacement",
          serverUrl: "https://bb.example.com",
          headers: { "x-access-token": "new" },
        };
      });
      await expect(serverAccess.repair(deps, args)).resolves.toMatchObject({
        id: "replacement",
      });
      expect(getHost(deps.db, host.id)?.serverAccessProviderId).toBe("relay");
      expect(grantId(deps, host.id)).toBe("replacement");
    });
  });

  it("retains the selected provider and supports retry after failed reacquisition", async () => {
    await withTestHarness(async ({ deps }) => {
      const acquire = vi.fn(provider().acquire);
      installProvider({ ...provider(), acquire });
      const host = upsertHost(deps.db, deps.hub, { name: "test" })!;
      const args = { key: "k", hostId: host.id, signal };
      await serverAccess.resolve(deps, args);
      acquire.mockRejectedValueOnce(new Error("unavailable"));
      await expect(serverAccess.repair(deps, args)).rejects.toThrow(
        "unavailable",
      );
      expect(getHost(deps.db, host.id)?.serverAccessProviderId).toBe("relay");
      expect(grantId(deps, host.id)).toBeNull();
      await expect(serverAccess.repair(deps, args)).resolves.toMatchObject({
        id: host.id,
      });
    });
  });

  it("does not reacquire when release fails or switch providers when the selected one is missing", async () => {
    await withTestHarness(async ({ deps }) => {
      const acquire = vi.fn(provider().acquire);
      const release = vi.fn().mockRejectedValue(new Error("release failed"));
      installProvider({ ...provider(), acquire, release });
      const host = upsertHost(deps.db, deps.hub, { name: "test" })!;
      const args = { key: "k", hostId: host.id, signal };
      await serverAccess.resolve(deps, args);
      await expect(serverAccess.repair(deps, args)).rejects.toThrow(
        "release failed",
      );
      expect(acquire).toHaveBeenCalledOnce();
      setServerAccessBridge(undefined);
      await expect(serverAccess.repair(deps, args)).rejects.toThrow(
        "provider is unavailable",
      );
      expect(getHost(deps.db, host.id)?.serverAccessProviderId).toBe("relay");
      expect(grantId(deps, host.id)).toBe(host.id);
    });
  });

  it("keeps failed release retryable and refuses invalid grant output without echoing it", async () => {
    await withTestHarness(async ({ deps }) => {
      const release = vi.fn().mockRejectedValueOnce(new Error("retry"));
      installProvider({ ...provider(), release });
      const host = upsertHost(deps.db, deps.hub, { name: "test" })!;
      await serverAccess.resolve(deps, { key: "k", hostId: host.id, signal });
      await expect(
        serverAccess.release(deps, { key: "k", hostId: host.id }),
      ).rejects.toThrow("retry");
      expect(grantId(deps, host.id)).toBe(host.id);
      installProvider({
        ...provider(),
        acquire: async () => ({
          id: "id",
          serverUrl: "https://secret:secret@example.com",
        }),
      });
      await expect(
        serverAccess.resolve(deps, { key: "k", hostId: host.id, signal }),
      ).rejects.toThrow("invalid grant");
    });
  });

  it("uses the explicit machine URL before the environment fallback", async () => {
    vi.stubEnv("BB_EXTERNAL_URL", "https://fallback.example.com");
    await withTestHarness(async ({ deps }) => {
      setAppSettings(deps.db, {
        ...defaultAppSettings,
        machineServerUrl: "https://configured.example.com",
      });
      expect(await serverAccessStatus(deps)).toMatchObject({
        effectiveUrl: "https://configured.example.com",
        urlSource: "setting",
      });
      setAppSettings(deps.db, defaultAppSettings);
      expect(await serverAccessStatus(deps)).toMatchObject({
        effectiveUrl: "https://fallback.example.com",
        urlSource: "BB_EXTERNAL_URL",
      });
    });
  });
});

it("keeps interrupted access visible and releases the acquisition without a returned grant", async () => {
  await withTestHarness(async ({ deps }) => {
    const message = "Cloud device may need dashboard revocation";
    const release = vi
      .fn()
      .mockRejectedValueOnce(new Error(message))
      .mockResolvedValue(undefined);
    installProvider({
      ...provider(),
      acquire: async () => ({ status: "failed", message }),
      release,
    });
    const host = upsertHost(deps.db, deps.hub, { name: "interrupted" })!;
    updateHost(deps.db, deps.hub, host.id, {
      machineProviderId: "test-machine",
      launchKey: "k",
      phase: "creating",
    });
    expect(
      listPublicHostsWithStatus(deps).some((entry) => entry.id === host.id),
    ).toBe(false);
    await expect(
      serverAccess.resolve(deps, { key: "k", hostId: host.id, signal }),
    ).rejects.toThrow(message);
    expect(getHost(deps.db, host.id)).toMatchObject({ statusMessage: message });
    expect(grantId(deps, host.id)).toBeNull();
    expect(
      listPublicHostsWithStatus(deps, { includeCreating: true }).find(
        (entry) => entry.id === host.id,
      )?.lifecycle.message,
    ).toBe(message);
    await expect(
      serverAccess.release(deps, { key: "k", hostId: host.id }),
    ).rejects.toThrow(message);
    expect(grantId(deps, host.id)).toBeNull();
    await serverAccess.release(deps, { key: "k", hostId: host.id });
    expect(release).toHaveBeenLastCalledWith({
      key: "k",
      hostId: host.id,
      grantId: null,
    });
    expect(grantId(deps, host.id)).toBeUndefined();
  });
});

it("refreshes access status through the real recheck notification and configuration route", async () => {
  await withTestHarness(async (h) => {
    await h.pluginService.install("builtin:keep-awake", { kind: "root" });
    const api = h.pluginService.getApi("keep-awake");
    if (!api) throw new Error("Test plugin did not load");
    let availability: Awaited<
      ReturnType<ServerAccessProviderDeclaration["availability"]>
    > = { status: "setup-required", message: "Pair the relay" };
    const acquire = vi.fn(provider().acquire);
    api.experimental_serverAccess.register({
      ...provider(),
      availability: () => availability,
      acquire,
    });
    const notify = vi.spyOn(h.hub, "notifySystem");
    for (const next of [
      { status: "setup-required", message: "Pair the relay" },
      { status: "available", serverUrl: "https://relay.example.com" },
      { status: "unavailable", message: "Credential revoked" },
      { status: "available" },
    ] as const) {
      availability = next;
      notify.mockClear();
      api.experimental_serverAccess.recheck();
      expect(notify).toHaveBeenCalledWith(["config-changed"]);
      const response = await h.app.request("/api/v1/system/config");
      expect(response.status).toBe(200);
      const config = await response.json();
      expect(
        config.serverAccess.providers.find(
          (entry: { id: string }) => entry.id === "relay",
        ).availability,
      ).toEqual(next);
    }
    expect(acquire).not.toHaveBeenCalled();
  });
});

it.each([
  { status: "available", serverUrl: "https://secret:password@example.com" },
  { status: "unexpected", message: "private diagnostics" },
  new Error("private diagnostics"),
])(
  "fails closed without exposing invalid provider output: %s",
  async (output) => {
    await withTestHarness(async ({ deps }) => {
      const availability = vi.fn();
      if (output instanceof Error) availability.mockRejectedValue(output);
      else availability.mockResolvedValue(output);
      installProvider({ ...provider(), availability });
      const status = await serverAccessStatus(deps);
      expect(availability).toHaveBeenCalledOnce();
      expect(
        status.providers.find((entry) => entry.id === "relay")?.availability
          .status,
      ).toBe("unavailable");
      expect(JSON.stringify(status)).not.toMatch(
        /secret|password|private diagnostics/,
      );
    });
  },
);

it("bounds a stalled availability check and recovers on the next read", async () => {
  await withTestHarness(async ({ deps }) => {
    const pending = createDeferredPromise<{ status: "available" }>();
    installProvider({ ...provider(), availability: () => pending.promise });
    vi.useFakeTimers();
    try {
      const result = serverAccessStatus(deps);
      const relay = (status: Awaited<typeof result>) =>
        status.providers.find((entry) => entry.id === "relay")?.availability;
      expect(relay(await advanceUntilSettled(result, 5_000))?.status).toBe(
        "unavailable",
      );
      pending.resolve({ status: "available" });
      expect(relay(await serverAccessStatus(deps))).toEqual({
        status: "available",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

it.each([
  { id: "direct" },
  { id: "local-network" },
  { id: "Invalid ID" },
  { displayName: " " },
  { description: " " },
])(
  "matches real and fake server-access registration validation: %j",
  async (invalid) => {
    await withTestHarness(async (h) => {
      await h.pluginService.install("builtin:keep-awake", { kind: "root" });
      const real = h.pluginService.getApi("keep-awake");
      if (!real) throw new Error("Test plugin did not load");
      const fake = createFakePluginHost();
      try {
        for (const api of [real, fake.bb])
          expect(() =>
            api.experimental_serverAccess.register({
              ...provider(),
              ...invalid,
            }),
          ).toThrow();
      } finally {
        await fake.harness.lifecycle.dispose();
      }
    });
  },
);

it("rejects duplicate server-access registrations in real and fake hosts", async () => {
  await withTestHarness(async (h) => {
    await h.pluginService.install("builtin:keep-awake", { kind: "root" });
    const real = h.pluginService.getApi("keep-awake");
    if (!real) throw new Error("Test plugin did not load");
    const fake = createFakePluginHost();
    try {
      for (const api of [real, fake.bb]) {
        api.experimental_serverAccess.register(provider());
        expect(() =>
          api.experimental_serverAccess.register(provider()),
        ).toThrow("already registered");
      }
    } finally {
      await fake.harness.lifecycle.dispose();
    }
  });
});

it("ranks a provider from a plugin built before routeKind existed as custom in real and fake hosts", async () => {
  await withTestHarness(async (h) => {
    await h.pluginService.install("builtin:keep-awake", { kind: "root" });
    const real = h.pluginService.getApi("keep-awake");
    if (!real) throw new Error("Test plugin did not load");
    const fake = createFakePluginHost();
    const { routeKind: _omitted, ...legacy } = provider();
    try {
      real.experimental_serverAccess.register(
        legacy as ServerAccessProviderDeclaration,
      );
      fake.bb.experimental_serverAccess.register(
        legacy as ServerAccessProviderDeclaration,
      );
      expect(
        (await serverAccessStatus(h.deps)).providers.find(
          (entry) => entry.id === "relay",
        )?.routeKind,
      ).toBe("custom");
      expect(
        fake.harness.registrations.serverAccessProviders.get("relay")
          ?.routeKind,
      ).toBe("custom");
    } finally {
      await fake.harness.lifecycle.dispose();
    }
  });
});

it("admits an available provider's address in the Host and Origin guards until it is lost", async () => {
  await withTestHarness(async (h) => {
    await h.pluginService.install("builtin:keep-awake", { kind: "root" });
    const api = h.pluginService.getApi("keep-awake");
    if (!api) throw new Error("Test plugin did not load");
    const address = "https://mini.tail1234.ts.net:8443";
    let availability: Awaited<
      ReturnType<ServerAccessProviderDeclaration["availability"]>
    > = { status: "setup-required", message: "Set up Serve" };
    api.experimental_serverAccess.register({
      ...provider(),
      availability: () => availability,
    });
    const status = async () =>
      (
        await h.app.request("http://localhost/api/v1/threads", {
          headers: { host: "mini.tail1234.ts.net:8443", origin: address },
        })
      ).status;

    api.experimental_serverAccess.recheck();
    await vi.waitFor(async () => expect(await status()).toBe(403));

    availability = { status: "available", serverUrl: address };
    api.experimental_serverAccess.recheck();
    await vi.waitFor(async () => expect(await status()).toBe(200));
    expect(
      (
        await h.app.request("http://localhost/api/v1/threads", {
          headers: {
            host: "mini.tail1234.ts.net:8443",
            origin: "https://mini.tail1234.ts.net",
          },
        })
      ).status,
    ).toBe(403);

    availability = { status: "unavailable", message: "Tailscale is stopped" };
    api.experimental_serverAccess.recheck();
    await vi.waitFor(async () => expect(await status()).toBe(403));
  });
});

it("ranks providers of one route kind by the earliest-installed plugin, not load order", async () => {
  await withTestHarness(async (h) => {
    for (const name of ["keep-awake", "automations"]) {
      await h.pluginService.install(`builtin:${name}`, { kind: "root" });
      const api = h.pluginService.getApi(name);
      if (!api) throw new Error(`${name} did not load`);
      api.experimental_serverAccess.register({ ...provider(), id: name });
    }
    const ids = async () =>
      (await serverAccessStatus(h.deps)).providers.map((entry) => entry.id);
    expect(await ids()).toEqual(["keep-awake", "automations", "direct"]);

    h.db
      .update(installedPlugins)
      .set({ installedAt: 1 })
      .where(eq(installedPlugins.id, "automations"))
      .run();

    expect(await ids()).toEqual(["automations", "keep-awake", "direct"]);
    const host = upsertHost(h.db, h.hub, { name: "test" })!;
    await serverAccess.resolve(h.deps, { key: "k", hostId: host.id, signal });
    expect(getHost(h.db, host.id)?.serverAccessProviderId).toBe("automations");
  });
});

describe("server access addresses across restarts and failures", () => {
  const address = "https://mini.tail1234.ts.net:8443";
  const tailnetRequest = {
    headers: { host: "mini.tail1234.ts.net:8443", origin: address },
  };

  it("admits the last available address from the first request after a restart, before plugins load", async () => {
    await withTestHarness(async (h) => {
      await h.pluginService.install("builtin:keep-awake", { kind: "root" });
      const api = h.pluginService.getApi("keep-awake");
      if (!api) throw new Error("Test plugin did not load");
      api.experimental_serverAccess.register({
        ...provider(),
        availability: () => ({ status: "available", serverUrl: address }),
      });
      api.experimental_serverAccess.recheck();
      await vi.waitFor(async () =>
        expect(
          (await h.app.request("http://localhost/health", tailnetRequest))
            .status,
        ).toBe(200),
      );

      const restarted = createApp(h.deps);
      try {
        expect(restarted.pluginService.getApi("keep-awake")).toBeUndefined();
        for (const path of ["/health", "/api/v1/threads"]) {
          expect(
            (
              await restarted.app.request(
                `http://localhost${path}`,
                tailnetRequest,
              )
            ).status,
          ).toBe(200);
        }
        expect(
          (
            await restarted.app.request("http://localhost/health", {
              headers: { host: "other.tail1234.ts.net" },
            })
          ).status,
        ).toBe(403);
      } finally {
        await restarted.pluginService.stop();
      }
    });
  });

  it("keeps an address through a failed availability check and drops it on a real answer", async () => {
    await withTestHarness(async (h) => {
      await h.pluginService.install("builtin:keep-awake", { kind: "root" });
      const api = h.pluginService.getApi("keep-awake");
      if (!api) throw new Error("Test plugin did not load");
      let availability: () => Awaited<
        ReturnType<ServerAccessProviderDeclaration["availability"]>
      > = () => ({ status: "available", serverUrl: address });
      api.experimental_serverAccess.register({
        ...provider(),
        availability: () => availability(),
      });
      const status = async () =>
        (await h.app.request("http://localhost/health", tailnetRequest)).status;
      api.experimental_serverAccess.recheck();
      await vi.waitFor(async () => expect(await status()).toBe(200));

      availability = () => {
        throw new Error("tailscale status timed out");
      };
      await serverAccessStatus(h.deps);
      expect(await status()).toBe(200);

      availability = () => ({
        status: "unavailable",
        message: "Tailscale is stopped",
      });
      await serverAccessStatus(h.deps);
      expect(await status()).toBe(403);
    });
  });

  it("drops the address when its plugin is disabled", async () => {
    await withTestHarness(async (h) => {
      await h.pluginService.install("builtin:keep-awake", { kind: "root" });
      const api = h.pluginService.getApi("keep-awake");
      if (!api) throw new Error("Test plugin did not load");
      api.experimental_serverAccess.register({
        ...provider(),
        availability: () => ({ status: "available", serverUrl: address }),
      });
      const status = async () =>
        (await h.app.request("http://localhost/health", tailnetRequest)).status;
      api.experimental_serverAccess.recheck();
      await vi.waitFor(async () => expect(await status()).toBe(200));

      await h.pluginService.setEnabled("keep-awake", false);

      await vi.waitFor(async () => expect(await status()).toBe(403));
    });
  });
});
