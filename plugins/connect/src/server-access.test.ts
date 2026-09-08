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
const expiryKey = "server-access-expiry:host-pending";
const hosts: FakePluginHost[] = [];

function setup(connectMachineId: string | null = null) {
  const host = createFakePluginHost({
    pluginId: "connect",
    sdk: { hosts: { get: async () => ({ connectMachineId }) } },
  });
  hosts.push(host);
  registerServerAccess(host.bb, tunnel);
  return host;
}

function provider(host: FakePluginHost) {
  const result =
    host.harness.registrations.serverAccessProviders.get("connect");
  if (!result) throw new Error("Connect access provider was not registered");
  return result;
}

function codeResponse() {
  return Response.json({
    code: "PRIVATE-CODE",
    expiresInMs: 600_000,
    serverUrl: credential.serverUrl,
  });
}

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Connect machine access release", () => {
  it("warns after restart when redemption happened before enrollment and cannot be revoked", async () => {
    const now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    let redeemedCredentialActive = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/machine-code")) return codeResponse();
      if (String(input).endsWith("/redeem-machine")) {
        redeemedCredentialActive = true;
        return Response.json({
          credential: "bbcm_private",
          machineId: "cloud-id",
        });
      }
      throw new Error("Unexpected Cloud request");
    });
    vi.stubGlobal("fetch", fetchMock);
    const original = setup();
    const grant = await provider(original).acquire(request);
    const expiry = await original.bb.storage.kv.get(expiryKey);
    expect(expiry).toEqual({ expiresAt: expect.any(Number) });
    expect(JSON.stringify(expiry)).not.toContain("PRIVATE-CODE");
    await fetch("https://getbb.app/api/connect/redeem-machine");
    const restarted = await original.harness.lifecycle.reload((bb) => {
      registerServerAccess(bb, tunnel);
    });
    hosts.push(restarted);
    await provider(restarted).release({ key: request.key, grantId: grant.id });
    expect(redeemedCredentialActive).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(restarted.harness.logEntries).toEqual([
      {
        level: "warn",
        message: expect.stringContaining(
          "Code expiry does not revoke a credential already redeemed",
        ),
      },
    ]);
    expect(restarted.harness.logEntries[0]?.message).toContain(
      `Any unredeemed code expires by ${new Date(now + 600_000).toISOString()}`,
    );
    expect(JSON.stringify(restarted.harness.logEntries)).not.toMatch(
      /PRIVATE-CODE|bbcred_private|bbcm_private/,
    );
    expect(await restarted.bb.storage.kv.get(expiryKey)).toBeUndefined();
  });

  it("retains known-machine revocation failures across restart and retries them", async () => {
    let failRevoke = true;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/machine-code")) return codeResponse();
        expect(String(input)).toBe(
          "https://getbb.app/api/connect/revoke-machine",
        );
        expect(JSON.parse(String(init?.body))).toEqual({
          machineId: "cloud-id",
        });
        return failRevoke
          ? new Response(null, { status: 503 })
          : Response.json({ ok: true });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const original = setup("cloud-id");
    await provider(original).acquire(request);
    await expect(
      provider(original).release({ key: request.key, grantId: request.hostId }),
    ).rejects.toThrow("503");
    expect(await original.bb.storage.kv.get(expiryKey)).toBeDefined();
    const restarted = await original.harness.lifecycle.reload((bb) => {
      registerServerAccess(bb, tunnel);
    });
    hosts.push(restarted);
    failRevoke = false;
    await provider(restarted).release({
      key: request.key,
      grantId: request.hostId,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(await restarted.bb.storage.kv.get(expiryKey)).toBeUndefined();
    expect(restarted.harness.logEntries).toEqual([]);
  });

  it("does not downgrade known-machine revocation when pairing is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => codeResponse()),
    );
    const host = setup("cloud-id");
    await provider(host).acquire(request);
    registerServerAccess(host.bb, { ...tunnel, getCredential: () => null });
    await expect(
      provider(host).release({ key: request.key, grantId: request.hostId }),
    ).rejects.toThrow("Pair this bb instance");
    expect(await host.bb.storage.kv.get(expiryKey)).toBeDefined();
    expect(host.harness.logEntries).toEqual([]);
  });

  it("warns with unknown expiry for legacy grants without minting another code", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const host = setup();
    await provider(host).release({ key: request.key, grantId: request.hostId });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(host.harness.logEntries[0]?.message).toContain(
      "expiry of this grant's unredeemed code is unavailable",
    );
  });
});
