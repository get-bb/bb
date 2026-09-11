import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  type FakePluginHost,
} from "@get-bb/plugin-sdk/testing";
import {
  createServerAccessRecheck,
  registerServerAccess,
} from "./server-access.js";

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
async function setup(beforeInit?: (host: FakePluginHost) => Promise<void>) {
  const host = createFakePluginHost({
    pluginId: "connect",
    sdk: { hosts: { get: async () => ({ connectMachineId: null }) } },
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("Connect server-owned machine access", () => {
  it("declares picker copy", async () => {
    const host = await setup();
    expect(provider(host).description).toBe("Use a private getbb.app address.");
  });

  it("persists redemption before enrollment and revokes after restart", async () => {
    const api = cloud();
    const original = await setup();
    const grant = await provider(original).acquire(request);
    if ("status" in grant) throw new Error(grant.message);
    expect(grant).toEqual({
      id: request.hostId,
      serverUrl: credential.serverUrl,
      headers: { "x-bb-connect-machine": "bbcm_private" },
    });
    expect(await original.bb.storage.kv.get(key)).toMatchObject({
      result: { connectMachineId: "cloud-id" },
    });
    const restarted = await original.harness.lifecycle.reload((bb) =>
      registerServerAccess(bb, tunnel),
    );
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
    hosts.push(restarted);
    await expect(
      provider(restarted).release({
        key: request.key,
        hostId: request.hostId,
        grantId: request.hostId,
      }),
    ).rejects.toThrow("Pair this bb instance");
    expect(await restarted.bb.storage.kv.get(key)).toMatchObject({
      result: { connectMachineId: "cloud-id" },
    });
  });
});

it("does not redeem a code when persisting the pending record fails", async () => {
  const host = await setup();
  const api = cloud();
  vi.spyOn(host.bb.storage.kv, "set").mockRejectedValueOnce(
    new Error("KV write failed"),
  );
  await expect(provider(host).acquire(request)).rejects.toThrow(
    "KV write failed",
  );
  expect(api.fetchMock).toHaveBeenCalledOnce();
  expect(api.active()).toBe(false);
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
    await expect(provider(host).acquire(request)).resolves.toEqual({
      status: "failed",
      message:
        "Cloud device may need dashboard revocation: interrupted machine access acquisition",
    });
    if (available) {
      await provider(host).acquire(request);
      await provider(host).release({
        key: request.key,
        hostId: request.hostId,
        grantId: request.hostId,
      });
      expect(active.size).toBe(0);
    } else {
      await expect(provider(host).acquire(request)).resolves.toEqual({
        status: "failed",
        message:
          "Cloud device may need dashboard revocation: interrupted machine access acquisition; retry after Cloud lookup is available",
      });
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
        intent: { code: "CODE-1" },
      });
    }
    const storedValues = await Promise.all(
      (await host.bb.storage.kv.list()).map((key) =>
        host.bb.storage.kv.get(key),
      ),
    );
    expect(JSON.stringify(storedValues)).not.toContain("private-bearer");
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

it.each(["expired", "valid"])(
  "renews only definitively unconsumed expired intents: %s",
  async (age) => {
    const host = await setup(async (host) => {
      await host.bb.storage.kv.set(key, {
        intent: {
          key: request.key,
          hostId: request.hostId,
          code: "OLD-CODE",
          serverUrl: credential.serverUrl,
          expiresAt: Date.now() + (age === "expired" ? -1000 : 600000),
        },
      });
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
    expect(await host.bb.storage.kv.get(key)).toMatchObject({
      result: { connectMachineId: "new-device", grant: { id: request.hostId } },
    });
  },
);

describe("server access recheck", () => {
  it("tells core only when paired state or public URL changes", async () => {
    const host = await setup();
    const recheck = createServerAccessRecheck(host.bb);
    recheck({ paired: false, url: null });
    expect(host.harness.recheckCount).toBe(0);
    recheck({ paired: false, url: null });
    expect(host.harness.recheckCount).toBe(0);
    recheck({ paired: true, url: "https://test.getbb.app" });
    expect(host.harness.recheckCount).toBe(1);
    recheck({ paired: true, url: "https://test.getbb.app" });
    expect(host.harness.recheckCount).toBe(1);
    recheck({ paired: true, url: "https://renamed.getbb.app" });
    expect(host.harness.recheckCount).toBe(2);
    recheck({ paired: false, url: null });
    expect(host.harness.recheckCount).toBe(3);
  });
});

it("aborts pending code issuance and lets a later acquisition proceed", async () => {
  const host = await setup();
  const controller = new AbortController();
  let started = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal;
      if (!signal) throw new Error("Missing acquisition signal");
      started = true;
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    }),
  );
  const pending = provider(host).acquire({
    ...request,
    signal: controller.signal,
  });
  await vi.waitFor(() => expect(started).toBe(true));
  controller.abort(new Error("cancelled"));
  await expect(pending).rejects.toThrow("cancelled");
  expect(await host.bb.storage.kv.get(key)).toBeUndefined();
  const api = cloud();
  await provider(host).acquire(request);
  await provider(host).release({
    key: request.key,
    hostId: request.hostId,
    grantId: request.hostId,
  });
  expect(api.active()).toBe(false);
});

it("retains interrupted redemption intent and revokes the committed device", async () => {
  const host = await setup();
  const controller = new AbortController();
  let active = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/machine-code") && init?.method === "POST")
        return Response.json({
          code: "PENDING-CODE",
          expiresInMs: 600000,
          serverUrl: credential.serverUrl,
        });
      if (url.endsWith("/redeem-machine")) {
        const signal = init?.signal;
        if (!signal) throw new Error("Missing redemption signal");
        active = true;
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      }
      if (url.endsWith("/machine-code") && init?.method === "GET")
        return Response.json({ consumed: true, machineId: "committed-device" });
      expect(url).toContain("/revoke-machine");
      expect(JSON.parse(String(init?.body))).toEqual({
        machineId: "committed-device",
      });
      active = false;
      return Response.json({ ok: true });
    }),
  );
  const pending = provider(host).acquire({
    ...request,
    signal: controller.signal,
  });
  await vi.waitFor(() => expect(active).toBe(true));
  controller.abort(new Error("cancelled"));
  await expect(pending).rejects.toThrow("cancelled");
  expect(await host.bb.storage.kv.get(key)).toMatchObject({
    intent: { code: "PENDING-CODE" },
  });
  const restarted = await host.harness.lifecycle.reload((bb) =>
    registerServerAccess(bb, tunnel),
  );
  hosts.push(restarted);
  await provider(restarted).release({
    key: request.key,
    hostId: request.hostId,
    grantId: null,
  });
  expect(active).toBe(false);
  expect(await restarted.bb.storage.kv.get(key)).toBeUndefined();
});

it("keeps an unexpired acquisition intent until a late redemption can be ruled out", async () => {
  const host = await setup(async (host) => {
    await host.bb.storage.kv.set(key, {
      intent: {
        key: request.key,
        hostId: request.hostId,
        code: "UNSETTLED-CODE",
        expiresAt: Date.now() + 60_000,
        serverUrl: credential.serverUrl,
      },
    });
  });
  let consumed = false;
  let revoked = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "GET")
        return Response.json({
          consumed,
          machineId: consumed ? "late-device" : null,
        });
      revoked = true;
      return Response.json({ ok: true });
    }),
  );
  const release = { key: request.key, hostId: request.hostId, grantId: null };
  await expect(provider(host).release(release)).rejects.toThrow(
    "still unsettled",
  );
  expect(await host.bb.storage.kv.get(key)).toMatchObject({
    intent: { code: "UNSETTLED-CODE" },
  });
  consumed = true;
  await provider(host).release(release);
  expect(revoked).toBe(true);
  expect(await host.bb.storage.kv.get(key)).toBeUndefined();
});
