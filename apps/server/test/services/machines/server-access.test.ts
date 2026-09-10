import { afterEach, describe, expect, it, vi } from "vitest";
import { getHost, setAppSettings, updateHost, upsertHost } from "@bb/db";
import { defaultAppSettings } from "@bb/domain";
import type { ServerAccessProviderDeclaration } from "@get-bb/plugin-sdk";
import {
  serverAccess,
  serverAccessStatus,
} from "../../../src/services/machines/server-access.js";
import {
  setServerAccessBridge,
  setServerAccessRecheckHandler,
} from "../../../src/services/plugins/plugin-server-access-registry.js";
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
  it("lists providers without invoking availability", async () => {
    await withTestHarness(async ({ deps }) => {
      const availability = vi.fn(() => ({ status: "available" as const }));
      installProvider({
        ...provider(),
        availability,
      });
      const status = await serverAccessStatus(deps);
      const access = status.providers.find((entry) => entry.id === "relay");
      expect(access).toMatchObject({ id: "relay", pluginId: "access-plugin" });
      expect(availability).not.toHaveBeenCalled();
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
      expect(availability).not.toHaveBeenCalled();
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
        access: { providerId: "direct" },
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
      await expect(
        serverAccess.resolve(deps, {
          key: "k",
          hostId: host.id,
          access: { providerId: "direct" },
          signal,
        }),
      ).rejects.toThrow("different");
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

it("routes a provider recheck to core with the calling plugin id", async () => {
  await withTestHarness(async (h) => {
    await h.pluginService.install("builtin:keep-awake", { kind: "root" });
    const api = h.pluginService.getApi("keep-awake");
    if (!api) throw new Error("Test plugin did not load");
    const rechecked: string[] = [];
    setServerAccessRecheckHandler((pluginId) => rechecked.push(pluginId));
    try {
      api.experimental_serverAccess.recheck();
    } finally {
      setServerAccessRecheckHandler(undefined);
    }
    expect(rechecked).toEqual(["keep-awake"]);
  });
});
