import { describe, expect, it, vi } from "vitest";
import {
  applyConnectServerSync,
  createConnectServerSync,
  fetchConnectAccountServers,
} from "../src/connect-server-sync.js";
import {
  connectServerId,
  createServerRegistry,
  type DesktopServerRecord,
  type ServerRegistry,
} from "../src/server-registry.js";

function memoryRegistry(): ServerRegistry {
  const files = new Map<string, string>();
  return createServerRegistry({
    builtinUrl: "http://127.0.0.1:38886",
    storagePath: "/tmp/bb-connect-sync-servers.json",
    fs: {
      async mkdir() {
        return undefined;
      },
      async readFile(path) {
        const raw = files.get(path);
        if (raw === undefined) {
          throw new Error("ENOENT");
        }
        return raw;
      },
      async writeFile(path, data) {
        files.set(path, data);
      },
    },
  });
}

describe("fetchConnectAccountServers", () => {
  it("POSTs the local plugin RPC path and Zod-parses the result", async () => {
    const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
      expect(input).toBe(
        "http://127.0.0.1:38886/api/v1/plugins/connect/rpc/listAccountServers",
      );
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ "content-type": "application/json" });
      expect(init?.body).toBe("null");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: {
            selfHandle: "me",
            servers: [
              {
                handle: "me",
                name: "primary",
                live: true,
                url: "https://me.getbb.app",
              },
              {
                handle: "other",
                name: "laptop",
                live: false,
                url: "https://other.getbb.app",
              },
            ],
          },
        }),
        text: async () => "",
      };
    });

    const result = await fetchConnectAccountServers({
      serverUrl: "http://127.0.0.1:38886/",
      fetchImpl,
    });
    expect(result?.selfHandle).toBe("me");
    expect(result?.servers).toHaveLength(2);
  });

  it("returns null on network failure, non-JSON, or ok:false", async () => {
    await expect(
      fetchConnectAccountServers({
        serverUrl: "http://127.0.0.1:1",
        fetchImpl: async () => {
          throw new Error("ECONNREFUSED");
        },
      }),
    ).resolves.toBeNull();

    await expect(
      fetchConnectAccountServers({
        serverUrl: "http://127.0.0.1:38886",
        fetchImpl: async () => ({
          ok: false,
          status: 500,
          json: async () => ({ ok: false, error: "not_paired" }),
          text: async () => "",
        }),
      }),
    ).resolves.toBeNull();

    await expect(
      fetchConnectAccountServers({
        serverUrl: "http://127.0.0.1:38886",
        fetchImpl: async () => ({
          ok: false,
          status: 422,
          json: async () => ({ ok: false, error: "plugin disabled" }),
          text: async () => "",
        }),
      }),
    ).resolves.toBeNull();
  });
});

describe("applyConnectServerSync", () => {
  it("upserts connect entries, skips selfHandle, and removes stale handles", async () => {
    const registry = memoryRegistry();
    await registry.load();
    await registry.upsert({
      id: connectServerId("gone"),
      name: "Gone",
      source: "connect",
      url: "https://gone.getbb.app",
    });
    await registry.add({
      name: "Manual",
      source: "manual",
      url: "https://manual.example.com",
    });

    const { upsertedIds, removedIds } = await applyConnectServerSync({
      registry,
      result: {
        selfHandle: "me",
        servers: [
          {
            handle: "me",
            name: "primary",
            live: true,
            url: "https://me.getbb.app",
          },
          {
            handle: "laptop",
            name: "Laptop",
            live: true,
            url: "https://laptop.getbb.app",
          },
          {
            handle: "phone",
            name: "Phone",
            live: false,
            url: "https://phone.getbb.app",
          },
        ],
      },
    });

    expect(upsertedIds.sort()).toEqual([
      connectServerId("laptop"),
      connectServerId("phone"),
    ]);
    expect(removedIds).toEqual([connectServerId("gone")]);

    // snapshot includes connect rows even though list filters by setting
    const connectRows = registry
      .snapshot()
      .servers.filter((s) => s.source === "connect");
    expect(connectRows.map((s) => s.id).sort()).toEqual([
      connectServerId("laptop"),
      connectServerId("phone"),
    ]);
    expect(
      connectRows.find((s) => s.id === connectServerId("laptop")),
    ).toMatchObject({
      name: "Laptop",
      url: "https://laptop.getbb.app",
    });
    // Manual entry untouched; no connect twin for self.
    expect(
      registry.snapshot().servers.some((s) => s.id === connectServerId("me")),
    ).toBe(false);
    expect(
      registry.snapshot().servers.some((s) => s.source === "manual"),
    ).toBe(true);
  });

  it("preserves tile styles across connect upsert and removes style on stale handle", async () => {
    const registry = memoryRegistry();
    await registry.load();
    const laptop = connectServerId("laptop");
    const gone = connectServerId("gone");
    await registry.upsert({
      id: laptop,
      name: "Laptop",
      source: "connect",
      url: "https://laptop.getbb.app",
    });
    await registry.upsert({
      id: gone,
      name: "Gone",
      source: "connect",
      url: "https://gone.getbb.app",
    });
    await registry.setTileStyle(laptop, { icon: "Cloud", color: "purple" });
    await registry.setTileStyle(gone, { icon: "Zap", color: "orange" });

    await applyConnectServerSync({
      registry,
      result: {
        selfHandle: "me",
        servers: [
          {
            handle: "laptop",
            name: "Laptop Renamed",
            live: true,
            url: "https://laptop-new.getbb.app",
          },
        ],
      },
    });

    // Upsert updated row fields but left the local style overlay alone.
    expect(registry.getServer(laptop)).toMatchObject({
      name: "Laptop Renamed",
      url: "https://laptop-new.getbb.app",
    });
    expect(registry.getTileStyle(laptop)).toEqual({
      icon: "Cloud",
      color: "purple",
    });
    // Stale connect id removed together with its style.
    expect(registry.getServer(gone)).toBeNull();
    expect(gone in registry.snapshot().tileStyles).toBe(false);
  });

  it("updates name/url for an existing connect id", async () => {
    const registry = memoryRegistry();
    await registry.load();
    await registry.upsert({
      id: connectServerId("laptop"),
      name: "Old",
      source: "connect",
      url: "https://old.getbb.app",
    });

    await applyConnectServerSync({
      registry,
      result: {
        selfHandle: "me",
        servers: [
          {
            handle: "laptop",
            name: "New Name",
            live: true,
            url: "https://laptop.getbb.app",
          },
        ],
      },
    });

    expect(registry.getServer(connectServerId("laptop"))).toEqual({
      id: connectServerId("laptop"),
      name: "New Name",
      source: "connect",
      url: "https://laptop.getbb.app",
    } satisfies DesktopServerRecord);
  });
});

describe("createConnectServerSync", () => {
  it("syncs on runtime ready and skips list trigger within the min interval", async () => {
    const registry = memoryRegistry();
    await registry.load();
    let now = 1_000_000;
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        result: {
          selfHandle: "me",
          servers: [
            {
              handle: "other",
              name: "Other",
              live: true,
              url: "https://other.getbb.app",
            },
          ],
        },
      }),
      text: async () => "",
    }));

    const sync = createConnectServerSync({
      getLocalServerUrl: () => "http://127.0.0.1:38886",
      registry,
      fetchImpl,
      now: () => now,
      minIntervalMs: 60_000,
      setIntervalFn: () => 0,
      clearIntervalFn: () => undefined,
    });

    await sync.syncNow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(registry.getServer(connectServerId("other"))).not.toBeNull();

    // Within 60s: list should not re-fetch.
    now += 10_000;
    sync.onListRequested();
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now += 60_000;
    const listSync = new Promise<void>((resolve) => {
      // onListRequested fires syncNow without returning the promise; wait via
      // a subsequent syncNow that coalesces onto the same in-flight work, or
      // completes immediately if the list-triggered run already finished.
      sync.onListRequested();
      void sync.syncNow().then(resolve);
    });
    await listSync;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("logs a connect failure only once until a success", async () => {
    const registry = memoryRegistry();
    await registry.load();
    const logs: string[] = [];
    let fail = true;
    const fetchImpl = vi.fn(async () => {
      if (fail) {
        throw new Error("down");
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: { selfHandle: "me", servers: [] },
        }),
        text: async () => "",
      };
    });

    const sync = createConnectServerSync({
      getLocalServerUrl: () => "http://127.0.0.1:38886",
      registry,
      fetchImpl,
      log: (message) => {
        logs.push(message);
      },
      setIntervalFn: () => 0,
      clearIntervalFn: () => undefined,
    });

    await sync.syncNow();
    await sync.syncNow();
    expect(logs).toHaveLength(1);

    fail = false;
    await sync.syncNow();
    fail = true;
    await sync.syncNow();
    expect(logs).toHaveLength(2);
  });
});
