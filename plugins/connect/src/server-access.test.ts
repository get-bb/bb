import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  type FakePluginHost,
} from "@get-bb/plugin-sdk/testing";
import {
  createConnection,
  migrate,
  getPluginKvValue,
  setPluginKvValue,
  deletePluginKvValue,
  pluginKv,
  listPluginKvKeys,
} from "@bb/db";
import { registerServerAccess } from "./server-access.js";

const credential = {
  serverUrl: "https://test.getbb.app",
  handle: "test",
  credential: "bbcred_private_server",
};
const tunnel = {
  getCredential: () => credential,
  status: () => ({ paired: true, url: credential.serverUrl }),
};
const request = {
  key: "launch-key",
  hostId: "host-pending",
  signal: new AbortController().signal,
};
const key = "server-access-grant:host-pending";
const hosts: FakePluginHost[] = [];
const databases: ReturnType<typeof createConnection>[] = [];
async function setup(
  beforeInit?: (host: FakePluginHost) => Promise<void>,
  settings?: Record<string, string>,
) {
  const host = createFakePluginHost({
    pluginId: "connect",
    settings,
    sdk: { hosts: { get: async () => ({ connectMachineId: null }) } },
  });
  const db = createConnection(":memory:");
  migrate(db);
  databases.push(db);
  Object.assign(host.bb.storage.kv, {
    list: async (prefix?: string) => listPluginKvKeys(db, "connect", prefix),
    get: async (key: string) => {
      const value = getPluginKvValue(db, "connect", key);
      return value === undefined ? undefined : JSON.parse(value);
    },
    set: async (key: string, value: unknown) => {
      setPluginKvValue(db, "connect", key, JSON.stringify(value));
    },
    delete: async (key: string) => {
      deletePluginKvValue(db, "connect", key);
    },
  });
  hosts.push(host);
  await beforeInit?.(host);
  await registerServerAccess(host.bb, tunnel);
  return host;
}
function provider(host: FakePluginHost) {
  const p = host.harness.registrations.serverAccessProviders.get("connect");
  if (!p) throw new Error("Missing provider");
  return p;
}
function cloud() {
  let active = false;
  let failRevoke = false;
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/machine-code"))
        return Response.json({
          code: "PRIVATE-CODE",
          expiresInMs: 600000,
          serverUrl: credential.serverUrl,
        });
      if (path.endsWith("/redeem-machine")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          code: "PRIVATE-CODE",
        });
        active = true;
        return Response.json({
          credential: "bbcm_private",
          machineId: "cloud-id",
          serverUrl: credential.serverUrl,
        });
      }
      expect(path).toBe("https://getbb.app/api/connect/revoke-machine");
      expect(JSON.parse(String(init?.body))).toEqual({ machineId: "cloud-id" });
      if (failRevoke) return new Response(null, { status: 503 });
      active = false;
      return Response.json({ ok: true });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    active: () => active,
    failRevoke: (value: boolean) => {
      failRevoke = value;
    },
  };
}
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose();
  for (const db of databases.splice(0)) db.$client.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("Connect server-owned machine access", () => {
  it("persists redemption before enrollment and revokes after restart", async () => {
    const api = cloud();
    const original = await setup();
    const grant = await provider(original).acquire(request);
    expect(grant).toEqual({
      id: request.hostId,
      serverUrl: credential.serverUrl,
      headers: { "x-bb-connect-machine": "bbcm_private" },
    });
    expect(await original.bb.storage.kv.get(key)).toMatchObject({
      connectMachineId: "cloud-id",
    });
    const restarted = await original.harness.lifecycle.reload((bb) =>
      registerServerAccess(bb, tunnel),
    );
    Object.assign(restarted.bb.storage.kv, original.bb.storage.kv);
    hosts.push(restarted);
    expect(await provider(restarted).acquire(request)).toEqual(grant);
    expect(api.fetchMock).toHaveBeenCalledTimes(2);
    await provider(restarted).release({
      key: request.key,
      hostId: request.hostId,
      grantId: grant.id,
    });
    expect(api.active()).toBe(false);
    expect(await restarted.bb.storage.kv.get(key)).toBeUndefined();
  });
  it("retains the device ID on revoke failure and retries after restart", async () => {
    const api = cloud();
    const original = await setup();
    await provider(original).acquire(request);
    api.failRevoke(true);
    await expect(
      provider(original).release({
        key: request.key,
        hostId: request.hostId,
        grantId: request.hostId,
      }),
    ).rejects.toThrow("503");
    const restarted = await original.harness.lifecycle.reload((bb) =>
      registerServerAccess(bb, tunnel),
    );
    Object.assign(restarted.bb.storage.kv, original.bb.storage.kv);
    hosts.push(restarted);
    api.failRevoke(false);
    await provider(restarted).release({
      key: request.key,
      hostId: request.hostId,
      grantId: request.hostId,
    });
    expect(api.active()).toBe(false);
    expect(await restarted.bb.storage.kv.get(key)).toBeUndefined();
  });
  it("retains the device ID when pairing is unavailable", async () => {
    cloud();
    const host = await setup();
    await provider(host).acquire(request);
    const restarted = await host.harness.lifecycle.reload((bb) =>
      registerServerAccess(bb, { ...tunnel, getCredential: () => null }),
    );
    Object.assign(restarted.bb.storage.kv, host.bb.storage.kv);
    hosts.push(restarted);
    await expect(
      provider(restarted).release({
        key: request.key,
        hostId: request.hostId,
        grantId: request.hostId,
      }),
    ).rejects.toThrow("Pair this bb instance");
    expect(await host.bb.storage.kv.get(key)).toMatchObject({
      connectMachineId: "cloud-id",
    });
  });
});

it("moves plaintext grants into private secret storage before replacing SQLite metadata", async () => {
  const host = await setup();
  expect(host.harness.registrations.settingsDescriptors).not.toHaveProperty(
    "machineAccessSecrets",
  );
  cloud();
  const grant = {
    id: request.hostId,
    serverUrl: credential.serverUrl,
    headers: { "x-bb-connect-machine": "bbcm_private" },
  };
  await host.bb.storage.kv.set(key, { connectMachineId: "cloud-id", grant });
  expect(await provider(host).acquire(request)).toEqual(grant);
  const rows = databases.at(-1)!.select().from(pluginKv).all();
  expect(JSON.stringify(rows)).not.toContain("bbcm_private");
  expect(await host.bb.storage.kv.get(key)).toEqual({
    grantId: request.hostId,
    connectMachineId: "cloud-id",
  });
  await provider(host).release({
    key: request.key,
    hostId: request.hostId,
    grantId: grant.id,
  });
});

it.each([true, false])(
  "reconciles lost redemption responses with lookup available=%s without blindly minting",
  async (available) => {
    const host = await setup();
    const active = new Set<string>();
    let minted = 0;
    let redeemed = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/machine-code") && init?.method === "GET") {
          return available
            ? Response.json({ consumed: true, machineId: "device-1" })
            : new Response("<!doctype html><title>bb</title>", {
                headers: { "content-type": "text/html" },
              });
        }
        if (url.endsWith("/machine-code")) {
          minted++;
          return Response.json({
            code: `CODE-${minted}`,
            expiresInMs: 600000,
            serverUrl: credential.serverUrl,
          });
        }
        if (url.endsWith("/redeem-machine")) {
          const id = `device-${++redeemed}`;
          active.add(id);
          if (redeemed === 1)
            throw new Error("Response lost after Cloud commit");
          return Response.json({
            credential: "private-bearer",
            machineId: id,
            serverUrl: credential.serverUrl,
          });
        }
        active.delete(JSON.parse(String(init?.body)).machineId);
        return Response.json({ ok: true });
      }),
    );
    await expect(provider(host).acquire(request)).rejects.toThrow(
      "Cloud device may need dashboard revocation",
    );
    if (available) {
      await provider(host).acquire(request);
      await provider(host).release({
        key: request.key,
        hostId: request.hostId,
        grantId: request.hostId,
      });
      expect(active.size).toBe(0);
    } else {
      await expect(provider(host).acquire(request)).rejects.toThrow(
        "Cloud device may need dashboard revocation",
      );
      await expect(
        provider(host).release({
          key: request.key,
          hostId: request.hostId,
          grantId: null,
        }),
      ).rejects.toThrow("Cloud device may need dashboard revocation");
      expect(minted).toBe(1);
      expect(redeemed).toBe(1);
      expect(await host.bb.storage.kv.get(key)).toMatchObject({
        message: expect.stringContaining(
          "Cloud device may need dashboard revocation",
        ),
      });
    }
    expect(
      JSON.stringify(databases.at(-1)!.select().from(pluginKv).all()),
    ).not.toContain("private-bearer");
  },
);

it("serializes concurrent acquisitions so release revokes every created device", async () => {
  const host = await setup();
  const api = cloud();
  const grants = await Promise.all([
    provider(host).acquire(request),
    provider(host).acquire(request),
  ]);
  expect(grants[0]).toEqual(grants[1]);
  expect(api.fetchMock).toHaveBeenCalledTimes(2);
  await provider(host).release({
    key: request.key,
    hostId: request.hostId,
    grantId: request.hostId,
  });
  expect(api.active()).toBe(false);
});

it("revokes a known device from SQLite metadata even if its secret is missing", async () => {
  const host = await setup();
  const api = cloud();
  await host.bb.storage.kv.set(key, {
    connectMachineId: "cloud-id",
    grantId: request.hostId,
  });
  await provider(host).release({
    key: request.key,
    hostId: request.hostId,
    grantId: request.hostId,
  });
  expect(api.fetchMock).toHaveBeenCalledOnce();
  expect(api.fetchMock.mock.calls[0]?.[0]).toBe(
    "https://getbb.app/api/connect/revoke-machine",
  );
  expect(await host.bb.storage.kv.get(key)).toBeUndefined();
});

it("revokes both server-owned and delivered-v1 device identities after a pending bundle upgrade", async () => {
  const host = await setup();
  cloud();
  await provider(host).acquire(request);
  host.harness.sdk.stub("hosts.get", async () => ({
    connectMachineId: "legacy-delivered-device",
  }));
  const revoked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      revoked.push(JSON.parse(String(init?.body)).machineId);
      return Response.json({ ok: true });
    }),
  );
  await provider(host).release({
    key: request.key,
    hostId: request.hostId,
    grantId: request.hostId,
  });
  expect(revoked).toEqual(["cloud-id", "legacy-delivered-device"]);
});

it("migrates every dormant plaintext grant before registering access", async () => {
  const host = await setup(async (host) => {
    for (const id of ["dormant-a", "dormant-b"]) {
      await host.bb.storage.kv.set(`server-access-grant:${id}`, {
        connectMachineId: `device-${id}`,
        grant: {
          id,
          serverUrl: credential.serverUrl,
          headers: { authorization: `private-${id}` },
        },
      });
    }
  });
  expect(provider(host)).toBeDefined();
  expect(
    JSON.stringify(databases.at(-1)!.select().from(pluginKv).all()),
  ).not.toContain("private-");
  for (const id of ["dormant-a", "dormant-b"]) {
    expect(
      await provider(host).acquire({ ...request, hostId: id }),
    ).toMatchObject({ headers: { authorization: `private-${id}` } });
  }
});

it("leaves plaintext intact after a failed secret migration and retries next initialization", async () => {
  await expect(
    setup(async (host) => {
      await host.bb.storage.kv.set(key, {
        connectMachineId: "old-device",
        grant: {
          id: request.hostId,
          serverUrl: credential.serverUrl,
          headers: { authorization: "old-private" },
        },
      });
      vi.spyOn(host.bb.storage.experimental_secrets, "set").mockRejectedValue(
        new Error("Secret write failed"),
      );
    }),
  ).rejects.toThrow("Secret write failed");
  const host = hosts.at(-1)!;
  expect(host.harness.registrations.serverAccessProviders.size).toBe(0);
  expect(JSON.stringify(await host.bb.storage.kv.get(key))).toContain(
    "old-private",
  );
  vi.restoreAllMocks();
  const restarted = await host.harness.lifecycle.reload(async (bb) => {
    Object.assign(bb.storage.kv, host.bb.storage.kv);
    await registerServerAccess(bb, tunnel);
  });
  hosts.push(restarted);
  expect(JSON.stringify(await restarted.bb.storage.kv.get(key))).not.toContain(
    "old-private",
  );
  expect(await provider(restarted).acquire(request)).toMatchObject({
    headers: { authorization: "old-private" },
  });
});

it.each(["expired", "valid", "legacy"])(
  "renews only definitively unconsumed expired or undated intents: %s",
  async (age) => {
    const host = await setup(undefined, {
      machineAccessSecrets: JSON.stringify({
        [request.hostId]: {
          intent: {
            key: request.key,
            hostId: request.hostId,
            code: "OLD-CODE",
            serverUrl: credential.serverUrl,
            ...(age === "legacy"
              ? {}
              : {
                  expiresAt: Date.now() + (age === "expired" ? -1000 : 600000),
                }),
          },
        },
      }),
    });
    const issued: string[] = [];
    const redeemed: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "GET")
          return Response.json({ consumed: false, machineId: null });
        if (String(input).endsWith("/machine-code")) {
          issued.push("NEW-CODE");
          return Response.json({
            code: "NEW-CODE",
            expiresInMs: 600000,
            serverUrl: credential.serverUrl,
          });
        }
        expect(String(input)).toContain("/redeem-machine");
        redeemed.push(JSON.parse(String(init?.body)).code);
        return Response.json({
          credential: "new-private",
          machineId: "new-device",
          serverUrl: credential.serverUrl,
        });
      }),
    );
    await expect(provider(host).acquire(request)).resolves.toMatchObject({
      headers: { "x-bb-connect-machine": "new-private" },
    });
    expect(issued).toEqual(age === "valid" ? [] : ["NEW-CODE"]);
    expect(redeemed).toEqual([age === "valid" ? "OLD-CODE" : "NEW-CODE"]);
    expect(await host.bb.storage.kv.get(key)).toEqual({
      connectMachineId: "new-device",
      grantId: request.hostId,
    });
  },
);

it.each(["invalid-url", "invalid-headers", "unexpected-headers"])(
  "scrubs malformed legacy payloads among valid and migrated records: %s",
  async (kind) => {
    const warnings = vi.fn();
    const valid = {
      connectMachineId: "valid-device",
      grant: {
        id: "valid",
        serverUrl: credential.serverUrl,
        headers: { authorization: "valid-private" },
      },
    };
    const migrated = {
      connectMachineId: "migrated-device",
      grantId: "migrated",
    };
    const bad =
      kind === "unexpected-headers"
        ? { ...migrated, headers: { authorization: "malformed-private" } }
        : {
            connectMachineId: "cloud-id",
            grant: {
              id: "bad",
              serverUrl:
                kind === "invalid-url" ? "invalid" : credential.serverUrl,
              headers:
                kind === "invalid-headers"
                  ? ["malformed-private"]
                  : { authorization: "malformed-private" },
            },
          };
    const host = await setup(async (host) => {
      vi.spyOn(host.bb.log, "warn").mockImplementation(warnings);
      await host.bb.storage.kv.set("server-access-grant:valid", valid);
      await host.bb.storage.kv.set("server-access-grant:migrated", migrated);
      await host.bb.storage.kv.set("server-access-grant:bad", bad);
    });
    expect(
      JSON.stringify(databases.at(-1)!.select().from(pluginKv).all()),
    ).not.toContain("private");
    expect(
      await host.bb.storage.kv.get("server-access-grant:migrated"),
    ).toEqual(migrated);
    expect(await host.bb.storage.kv.get("server-access-grant:bad")).toEqual({
      grantId: "bad",
      connectMachineId: bad.connectMachineId,
      quarantined: true,
    });
    expect(warnings).toHaveBeenCalledWith(
      "Malformed legacy access record scrubbed; cleanup requires attention",
    );
    expect(JSON.stringify(warnings.mock.calls)).not.toContain("private");
    expect(await provider(host).experimental_attention?.()).toBe(
      "1 legacy access records need attention",
    );
    expect(await provider(host).availability()).toEqual({
      status: "available",
      serverUrl: credential.serverUrl,
    });
    expect(
      await provider(host).acquire({ ...request, hostId: "valid" }),
    ).toEqual(valid.grant);
    await expect(
      provider(host).acquire({ ...request, hostId: "bad" }),
    ).rejects.toThrow("Legacy access record needs attention");
    const restarted = await host.harness.lifecycle.reload(async (bb) => {
      Object.assign(bb.storage.kv, host.bb.storage.kv);
      await registerServerAccess(bb, tunnel);
    });
    hosts.push(restarted);
    expect(await provider(restarted).experimental_attention?.()).toBe(
      "1 legacy access records need attention",
    );
  },
);
