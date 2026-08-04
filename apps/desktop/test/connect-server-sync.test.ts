import { describe, expect, it, vi } from "vitest";
import {
  createConnectServerSync,
  fetchConnectAccountServers,
  selectTargetableConnectServers,
  type ConnectAccountServer,
} from "../src/connect-server-sync.js";

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

describe("selectTargetableConnectServers", () => {
  it("drops the self handle and keeps everything else, live or not", () => {
    const servers = selectTargetableConnectServers({
      selfHandle: "me",
      servers: [
        { handle: "me", name: "primary", live: true, url: "https://me.x" },
        { handle: "laptop", name: "Laptop", live: true, url: "https://l.x" },
        { handle: "phone", name: "Phone", live: false, url: "https://p.x" },
      ],
    });
    expect(servers.map((server) => server.handle)).toEqual(["laptop", "phone"]);
  });
});

describe("createConnectServerSync", () => {
  it("hands fresh servers to onServers and skips list trigger within the min interval", async () => {
    let now = 1_000_000;
    let received: ConnectAccountServer[] | null = null;
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
      getCredential: () => null,
      getLocalServerUrl: () => "http://127.0.0.1:38886",
      onServers(servers) {
        received = servers;
      },
      onUnauthorized: () => undefined,
      fetchImpl,
      now: () => now,
      minIntervalMs: 60_000,
      setIntervalFn: () => 0,
      clearIntervalFn: () => undefined,
    });

    await sync.syncNow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(received).toEqual([
      {
        handle: "other",
        name: "Other",
        live: true,
        url: "https://other.getbb.app",
      },
    ]);

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

  it("does not call onServers on failure and logs the failure only once until a success", async () => {
    const logs: string[] = [];
    let onServersCalls = 0;
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
      getCredential: () => null,
      getLocalServerUrl: () => "http://127.0.0.1:38886",
      onServers() {
        onServersCalls += 1;
      },
      onUnauthorized: () => undefined,
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
    expect(onServersCalls).toBe(0);

    fail = false;
    await sync.syncNow();
    expect(onServersCalls).toBe(1);
    fail = true;
    await sync.syncNow();
    expect(logs).toHaveLength(2);
  });
});

describe("createConnectServerSync without a local server", () => {
  const credential = {
    credential: "bbcm_desktop",
    handle: "me",
    serverUrl: "https://me.getbb.app",
  };

  it("lists servers straight from the gate with the cached credential", async () => {
    let received: ConnectAccountServer[] | null = null;
    const gateFetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            servers: [
              { handle: "me", name: "This Mac", live: true },
              { handle: "other", name: "Other", live: true },
            ],
          }),
        ),
    );

    const sync = createConnectServerSync({
      getCredential: () => credential,
      getLocalServerUrl: () => null,
      gateFetchImpl,
      onServers(servers) {
        received = servers;
      },
      onUnauthorized: () => undefined,
      setIntervalFn: () => 0,
      clearIntervalFn: () => undefined,
    });

    await sync.syncNow();
    expect(gateFetchImpl).toHaveBeenCalledWith(
      "https://me.getbb.app/api/connect/servers",
      expect.objectContaining({
        headers: { "x-bb-connect-machine": "bbcm_desktop" },
      }),
    );
    // selfHandle drops out: "This Mac" is its own menu entry.
    expect(received).toEqual([
      {
        handle: "other",
        name: "Other",
        live: true,
        url: "https://other.getbb.app",
      },
    ]);
  });

  it("reports a refused credential so the caller drops it", async () => {
    let unauthorized = 0;
    const sync = createConnectServerSync({
      getCredential: () => credential,
      getLocalServerUrl: () => null,
      gateFetchImpl: async () => new Response("no", { status: 403 }),
      onServers: () => undefined,
      onUnauthorized() {
        unauthorized += 1;
      },
      setIntervalFn: () => 0,
      clearIntervalFn: () => undefined,
    });

    await sync.syncNow();
    expect(unauthorized).toBe(1);
  });

  it("stays quiet when the app has no credential", async () => {
    const gateFetchImpl = vi.fn(async () => new Response("{}"));
    const sync = createConnectServerSync({
      getCredential: () => null,
      getLocalServerUrl: () => null,
      gateFetchImpl,
      onServers: () => undefined,
      onUnauthorized: () => undefined,
      setIntervalFn: () => 0,
      clearIntervalFn: () => undefined,
    });

    await sync.syncNow();
    expect(gateFetchImpl).not.toHaveBeenCalled();
  });
});
