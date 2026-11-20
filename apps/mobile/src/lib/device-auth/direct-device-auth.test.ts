import { createDpopProof } from "@bb/sdk/dpop";
import { describe, expect, it } from "vitest";
import type {
  DeviceAccessRecord,
  DeviceAccessStore,
} from "./device-access-store";
import { createDeviceSigner, generateDevicePrivateJwk } from "./device-key";
import {
  ACCESS_TOKEN_RENEW_MARGIN_MS,
  createDirectDeviceAuth,
  DeviceAccessRevokedError,
  redeemDevicePairing,
} from "./direct-device-auth";
import { createDeviceAuthRegistry } from "./registry";
import {
  createFakeDpopServer,
  FAKE_SERVER_URL,
  nodeDeviceCrypto,
  verifyProof,
} from "./fake-dpop-server";

function memoryStore(): DeviceAccessStore & {
  records: Map<string, DeviceAccessRecord>;
} {
  const records = new Map<string, DeviceAccessRecord>();
  return {
    records,
    read: async (id) => records.get(id) ?? null,
    write: async (id, record) => {
      records.set(id, record);
    },
    remove: async (id) => {
      records.delete(id);
    },
  };
}

async function pairedAuth(clock: { now: number }) {
  const server = createFakeDpopServer({
    validCode: "ABCDE-FGHJK",
    now: () => clock.now,
  });
  const redeemed = await redeemDevicePairing({
    serverUrl: FAKE_SERVER_URL,
    code: "ABCDE-FGHJK",
    label: "bb mobile on test",
    crypto: nodeDeviceCrypto,
    fetchImpl: server.fetch,
  });
  if (!redeemed.ok) throw new Error(redeemed.error);
  const store = memoryStore();
  const auth = createDirectDeviceAuth({
    profileId: "p1",
    serverUrl: FAKE_SERVER_URL,
    record: redeemed.record,
    store,
    crypto: nodeDeviceCrypto,
    baseFetch: server.fetch,
    now: () => clock.now,
  });
  return { server, store, auth, record: redeemed.record };
}

describe("device key", () => {
  it("signs proofs that node:crypto verifies against the published key, binding method, URL and token", async () => {
    const signer = createDeviceSigner(
      generateDevicePrivateJwk(),
      nodeDeviceCrypto,
    );
    const url = `${FAKE_SERVER_URL}/api/v1/projects?limit=5`;
    const proof = await createDpopProof({
      signer,
      method: "get",
      url,
      accessToken: "bbt_1",
    });
    expect(
      verifyProof(proof, { method: "GET", url, accessToken: "bbt_1" }),
    ).toMatchObject({ ok: true });
    expect(
      verifyProof(proof, { method: "GET", url, accessToken: "bbt_2" }),
    ).toEqual({ ok: false, reason: "ath" });
    expect(
      verifyProof(proof, {
        method: "POST",
        url,
        accessToken: "bbt_1",
      }),
    ).toEqual({ ok: false, reason: "htm" });
  });
});

describe("direct device auth", () => {
  it("pairs with a proof, then signs every request with the same key", async () => {
    const clock = { now: 1_000_000 };
    const { server, auth } = await pairedAuth(clock);
    const pairedKey = server.boundThumbprint;
    const response = await auth.fetch(
      `${FAKE_SERVER_URL}/api/v1/system/config`,
    );
    expect(response.status).toBe(200);
    expect(server.boundThumbprint).toBe(pairedKey);
  });

  it("renews shortly before the access token expires and persists the new token", async () => {
    const clock = { now: 1_000_000 };
    const { server, store, auth, record } = await pairedAuth(clock);
    clock.now = record.accessTokenExpiresAt - ACCESS_TOKEN_RENEW_MARGIN_MS / 2;
    await auth.fetch(`${FAKE_SERVER_URL}/api/v1/system/config`);
    expect(server.calls).toContain("POST /api/v1/access/token");
    expect(store.records.get("p1")?.accessToken).not.toBe(record.accessToken);
  });

  it("renews once when the server says the token expired, then retries the request", async () => {
    const clock = { now: 1_000_000 };
    const { server, auth } = await pairedAuth(clock);
    server.expireTokens();
    const response = await auth.fetch(
      `${FAKE_SERVER_URL}/api/v1/system/config`,
    );
    expect(response.status).toBe(200);
    expect(
      server.calls.filter((call) => call === "POST /api/v1/access/token"),
    ).toHaveLength(1);
  });

  it("retries a rejected proof once with a fresh one", async () => {
    const clock = { now: 1_000_000 };
    const { server, auth } = await pairedAuth(clock);
    server.rejectNextProofs(1);
    const response = await auth.fetch(
      `${FAKE_SERVER_URL}/api/v1/system/config`,
    );
    expect(response.status).toBe(200);
  });

  it("reports a revoked device and stops minting browser sessions", async () => {
    const clock = { now: 1_000_000 };
    const { server, auth } = await pairedAuth(clock);
    let revoked = 0;
    auth.onRevoked(() => {
      revoked += 1;
    });
    server.revoke();
    await expect(auth.mintBrowserSession()).rejects.toBeInstanceOf(
      DeviceAccessRevokedError,
    );
    expect(revoked).toBe(1);
  });

  it("opens the realtime socket with a ticket and a proof bound to it, never the access token", async () => {
    const clock = { now: 1_000_000 };
    const { record, auth } = await pairedAuth(clock);
    const socketUrl = new URL(
      await auth.websocketUrl("ws://192.168.1.20:38886/ws"),
    );
    expect(socketUrl.searchParams.get("wsTicket")).toBe("bbt_ticket");
    expect(socketUrl.href).not.toContain(record.accessToken);
    expect(
      verifyProof(socketUrl.searchParams.get("dpop"), {
        method: "GET",
        url: "http://192.168.1.20:38886/ws",
        accessToken: "bbt_ticket",
      }),
    ).toMatchObject({ ok: true });
  });
});

describe("device auth registry", () => {
  it("finds a sign-in saved before its profile existed, so a new profile never starts signed out", async () => {
    const clock = { now: Date.UTC(2026, 10, 19) };
    const { server, store, record } = await pairedAuth(clock);
    await store.write(record.credentialId, record);
    const registry = createDeviceAuthRegistry({
      store,
      crypto: nodeDeviceCrypto,
      baseFetch: server.fetch,
      now: () => clock.now,
    });
    const auth = await registry.forProfile({
      id: "profile-created-after-pairing",
      mode: "direct",
      serverUrl: FAKE_SERVER_URL,
      label: "LAN",
      createdAt: clock.now,
      access: { credentialId: record.credentialId },
    });
    expect(auth?.credentialId).toBe(record.credentialId);
  });
});
