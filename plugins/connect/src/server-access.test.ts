import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  type FakePluginHost,
} from "@get-bb/plugin-sdk/testing";
import { registerServerAccess } from "./server-access.js";

const credential = {
  serverUrl: "https://test.getbb.app",
  handle: "test",
  credential: "bbcred_private_server",
};
const tunnel = {
  getCredential: () => credential,
  status: () => ({ paired: true }),
};
const request = {
  key: "launch-key",
  hostId: "host-pending",
  signal: new AbortController().signal,
};
const key = "server-access-grant:host-pending";
const hosts: FakePluginHost[] = [];
function setup() {
  const host = createFakePluginHost({
    pluginId: "connect",
    sdk: { hosts: { get: async () => ({ connectMachineId: null }) } },
  });
  hosts.push(host);
  registerServerAccess(host.bb, tunnel);
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
  it("persists redemption before enrollment and revokes after restart", async () => {
    const api = cloud();
    const original = setup();
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
    hosts.push(restarted);
    expect(await provider(restarted).acquire(request)).toEqual(grant);
    expect(api.fetchMock).toHaveBeenCalledTimes(2);
    await provider(restarted).release({ key: request.key, grantId: grant.id });
    expect(api.active()).toBe(false);
    expect(await restarted.bb.storage.kv.get(key)).toBeUndefined();
  });
  it("retains the device ID on revoke failure and retries after restart", async () => {
    const api = cloud();
    const original = setup();
    await provider(original).acquire(request);
    api.failRevoke(true);
    await expect(
      provider(original).release({ key: request.key, grantId: request.hostId }),
    ).rejects.toThrow("503");
    const restarted = await original.harness.lifecycle.reload((bb) =>
      registerServerAccess(bb, tunnel),
    );
    hosts.push(restarted);
    api.failRevoke(false);
    await provider(restarted).release({
      key: request.key,
      grantId: request.hostId,
    });
    expect(api.active()).toBe(false);
    expect(await restarted.bb.storage.kv.get(key)).toBeUndefined();
  });
  it("retains the device ID when pairing is unavailable", async () => {
    cloud();
    const host = setup();
    await provider(host).acquire(request);
    registerServerAccess(host.bb, { ...tunnel, getCredential: () => null });
    await expect(
      provider(host).release({ key: request.key, grantId: request.hostId }),
    ).rejects.toThrow("Pair this bb instance");
    expect(await host.bb.storage.kv.get(key)).toMatchObject({
      connectMachineId: "cloud-id",
    });
  });
});
