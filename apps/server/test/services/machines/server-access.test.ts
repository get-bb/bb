import { createDeferredPromise } from "@bb/test-helpers";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getHost, setAppSettings, updateHost, upsertHost } from "@bb/db";
import { defaultAppSettings } from "@bb/domain";
import type { ServerAccessProviderDeclaration } from "@get-bb/plugin-sdk";
import {
  serverAccess,
  serverAccessStatus,
} from "../../../src/services/machines/server-access.js";
import { setServerAccessBridge } from "../../../src/services/plugins/plugin-server-access-registry.js";
import { listPublicHostsWithStatus } from "../../../src/services/lib/entity-lookup.js";
import { withTestHarness } from "../../helpers/test-app.js";

const signal = new AbortController().signal;

afterEach(() => {
  setServerAccessBridge(undefined);
  vi.unstubAllEnvs();
});

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

  it("reports provider availability without acquiring a grant", async () => {
    await withTestHarness(async ({ deps }) => {
      const availability = vi.fn(() => ({ status: "available" as const }));
      const acquire = vi.fn(provider().acquire);
      installProvider({ ...provider(), availability, acquire });
      const status = await serverAccessStatus(deps);
      const access = status.providers.find((entry) => entry.id === "relay");
      expect(access).toMatchObject({ id: "relay", pluginId: "access-plugin" });
      expect(access?.availability).toEqual({ status: "available" });
      expect(availability).toHaveBeenCalledOnce();
      expect(acquire).not.toHaveBeenCalled();
    });
  });
  it("prefers the first registered provider and respects an explicit direct default", async () => {
    await withTestHarness(async ({ deps }) => {
      vi.stubEnv("BB_EXTERNAL_URL", "https://direct.example.com");
      expect((await serverAccessStatus(deps)).defaultProviderId).toBe("direct");
      installProvider(provider());
      expect((await serverAccessStatus(deps)).defaultProviderId).toBe("relay");
      expect((await serverAccessStatus(deps)).providers[0]).toMatchObject({
        id: "relay",
        pluginId: "access-plugin",
        description: "Use a managed relay.",
      });
      setAppSettings(deps.db, {
        ...defaultAppSettings,
        defaultMachineAccess: "direct",
      });
      expect((await serverAccessStatus(deps)).defaultProviderId).toBe("direct");
      setAppSettings(deps.db, {
        ...defaultAppSettings,
        defaultMachineAccess: "missing",
      });
      const host = upsertHost(deps.db, deps.hub, { name: "test" })!;
      await expect(
        serverAccess.resolve(deps, { key: "k", hostId: host.id, signal }),
      ).rejects.toThrow("unavailable");
    });
  });

  it("requires provider setup instead of silently falling back to a configured URL", async () => {
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
      expect((await serverAccessStatus(deps)).defaultProviderId).toBe("relay");
      availability.mockClear();
      const host = upsertHost(deps.db, deps.hub, { name: "test" })!;
      await expect(
        serverAccess.resolve(deps, { key: "k", hostId: host.id, signal }),
      ).rejects.toThrow("Set up the relay");
      expect(availability).toHaveBeenCalledOnce();
      setAppSettings(deps.db, {
        ...defaultAppSettings,
        defaultMachineAccess: "direct",
      });
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

  it("returns direct access without headers", async () => {
    await withTestHarness(async ({ deps }) => {
      vi.stubEnv("BB_EXTERNAL_URL", "https://direct.example.com");
      const host = upsertHost(deps.db, deps.hub, { name: "direct" })!;
      const grant = await serverAccess.resolve(deps, {
        key: "direct",
        hostId: host.id,
        signal,
      });
      expect(grant).toEqual({
        id: host.id,
        serverUrl: "https://direct.example.com",
      });
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
      expect(row.serverAccessGrantId).toBe(host.id);
      expect(JSON.stringify(row)).not.toContain("secret-header");
      setAppSettings(deps.db, {
        ...defaultAppSettings,
        defaultMachineAccess: "direct",
        machineServerUrl: "https://other.example.com",
      });
      expect(
        await serverAccess.resolve(deps, { key: "k", hostId: host.id, signal }),
      ).toEqual(grant);
      await serverAccess.release(deps, { key: "k", hostId: host.id });
      expect(getHost(deps.db, host.id)?.serverAccessGrantId).toBeNull();
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
      expect(getHost(deps.db, host.id)?.serverAccessGrantId).toBe(host.id);
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
    expect(getHost(deps.db, host.id)).toMatchObject({
      serverAccessProviderId: "relay",
      serverAccessGrantId: null,
      statusMessage: message,
    });
    expect(
      listPublicHostsWithStatus(deps, { includeCreating: true }).find(
        (entry) => entry.id === host.id,
      )?.lifecycle.message,
    ).toBe(message);
    await expect(
      serverAccess.release(deps, { key: "k", hostId: host.id }),
    ).rejects.toThrow(message);
    expect(getHost(deps.db, host.id)?.serverAccessProviderId).toBe("relay");
    await serverAccess.release(deps, { key: "k", hostId: host.id });
    expect(release).toHaveBeenLastCalledWith({
      key: "k",
      hostId: host.id,
      grantId: null,
    });
    expect(getHost(deps.db, host.id)?.serverAccessProviderId).toBeNull();
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
    setAppSettings(h.db, {
      ...defaultAppSettings,
      defaultMachineAccess: "relay",
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
      expect(status.providers[0]?.availability?.status).toBe("unavailable");
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
      await vi.advanceTimersByTimeAsync(5_000);
      expect((await result).providers[0]?.availability?.status).toBe(
        "unavailable",
      );
      pending.resolve({ status: "available" });
      expect(
        (await serverAccessStatus(deps)).providers[0]?.availability,
      ).toEqual({ status: "available" });
    } finally {
      vi.useRealTimers();
    }
  });
});

it.each([
  { id: "direct" },
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
