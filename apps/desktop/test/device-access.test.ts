import { createNodeDpopSigner, generateDpopPrivateJwk } from "@bb/sdk/node";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createDeviceCredentialStore,
  nextKeepAliveDelayMs,
  pairDevice,
  refreshDeviceSession,
  sendDpopRequest,
  type DeviceCredentialFs,
  type DeviceFetch,
  type StoredDeviceCredential,
} from "../src/device-access.js";
import type { SessionCookieJar } from "../src/local-server-access.js";

const ORIGIN = "https://box.tail1234.ts.net";

function memoryFs(): DeviceCredentialFs & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  return {
    files,
    async readFile(path) {
      const file = files.get(path);
      if (file === undefined) throw new Error("ENOENT");
      return file;
    },
    async rm(path) {
      files.delete(path);
    },
    async writeFile(path, data) {
      files.set(path, data);
    },
  };
}

const reversibleEncryption = {
  isEncryptionAvailable: () => true,
  encryptString: (plain: string) =>
    Buffer.from([...plain].reverse().join(""), "utf8"),
  decryptString: (encrypted: Buffer) =>
    [...encrypted.toString("utf8")].reverse().join(""),
};

function store(fs = memoryFs()) {
  return {
    fs,
    store: createDeviceCredentialStore({
      encryption: reversibleEncryption,
      fs,
      userDataPath: "/user-data",
    }),
  };
}

function credential(
  overrides: Partial<StoredDeviceCredential> = {},
): StoredDeviceCredential {
  return {
    privateJwk: generateDpopPrivateJwk(),
    accessToken: "bbt_old",
    accessTokenExpiresAt: 10_000_000,
    credentialId: "acc_1",
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function proofPayload(proof: string | null): Record<string, unknown> {
  if (proof === null) throw new Error("expected a DPoP proof");
  return z
    .record(z.string(), z.unknown())
    .parse(
      JSON.parse(
        Buffer.from(proof.split(".")[1]!, "base64url").toString("utf8"),
      ),
    );
}

function cookieJar(): SessionCookieJar & {
  sets: Parameters<SessionCookieJar["set"]>[0][];
} {
  const sets: Parameters<SessionCookieJar["set"]>[0][] = [];
  return {
    sets,
    async get() {
      return [];
    },
    async set(details) {
      sets.push(details);
    },
  };
}

describe("device credential store", () => {
  it("keeps one encrypted key per origin and deletes the file once empty", async () => {
    const { fs, store: deviceStore } = store();
    const first = credential();
    await deviceStore.write(`${ORIGIN}/some/path`, first);
    await deviceStore.write(
      "http://192.168.1.5:38886",
      credential({ credentialId: "acc_2" }),
    );
    expect(await deviceStore.read(ORIGIN)).toEqual(first);
    expect(
      [...fs.files.values()][0]?.toString("utf8").includes(first.accessToken),
    ).toBe(false);
    await deviceStore.remove(ORIGIN);
    expect(await deviceStore.read(ORIGIN)).toBeNull();
    expect(
      (await deviceStore.read("http://192.168.1.5:38886"))?.credentialId,
    ).toBe("acc_2");
    await deviceStore.remove("http://192.168.1.5:38886");
    expect(fs.files.size).toBe(0);
  });
});

describe("keep-alive timing", () => {
  it("wakes for whichever comes first: token renewal or the WebView cookie re-mint", () => {
    expect(
      nextKeepAliveDelayMs({
        now: 0,
        accessTokenExpiresAt: 60 * 60_000,
        cookieExpiresAt: 60 * 60_000,
      }),
    ).toBe(45 * 60_000);
    expect(
      nextKeepAliveDelayMs({
        now: 0,
        accessTokenExpiresAt: 10 * 60_000,
        cookieExpiresAt: 60 * 60_000,
      }),
    ).toBe(9 * 60_000);
    expect(
      nextKeepAliveDelayMs({
        now: 0,
        accessTokenExpiresAt: 1_000,
        cookieExpiresAt: 60 * 60_000,
      }),
    ).toBe(5_000);
  });
});

describe("DPoP requests", () => {
  it("retries once with a fresh proof when the server rejects the proof", async () => {
    const fetchImpl = vi
      .fn<DeviceFetch>()
      .mockResolvedValueOnce(
        json({ code: "invalid_dpop_proof", message: "time_window" }, 401),
      )
      .mockResolvedValueOnce(json({ ok: true }));
    const response = await sendDpopRequest({
      accessToken: "bbt_live",
      bindAccessToken: true,
      fetchImpl,
      method: "GET",
      signer: createNodeDpopSigner(generateDpopPrivateJwk()),
      url: `${ORIGIN}/api/v1/projects`,
    });
    expect(response.status).toBe(200);
    const proofs = fetchImpl.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get("dpop"),
    );
    expect(proofs[0]).not.toBe(proofs[1]);
  });
});

describe("pairing and keeping a direct server sign-in alive", () => {
  it("pairs with a proof but no token, then stores the key with the bound token", async () => {
    const { store: deviceStore } = store();
    const fetchImpl = vi.fn<DeviceFetch>(async () =>
      json({
        kind: "device",
        credential: { id: "acc_9" },
        accessToken: "bbt_new",
        accessTokenExpiresAt: 3_600_000,
      }),
    );
    const result = await pairDevice({
      code: "ABCDE-FGHJK",
      fetchImpl,
      label: "bb desktop on mac",
      origin: ORIGIN,
      store: deviceStore,
    });
    expect(result.ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(`${ORIGIN}/api/v1/access/pairings/redeem`);
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBeNull();
    expect(proofPayload(headers.get("dpop"))).toMatchObject({
      htm: "POST",
      htu: `${ORIGIN}/api/v1/access/pairings/redeem`,
    });
    expect(await deviceStore.read(ORIGIN)).toMatchObject({
      accessToken: "bbt_new",
      credentialId: "acc_9",
    });
  });

  it("renews a nearly expired token without binding it, then mints a Secure WebView cookie bound to the new token", async () => {
    const { store: deviceStore } = store();
    await deviceStore.write(
      ORIGIN,
      credential({ accessTokenExpiresAt: 30_000 }),
    );
    const fetchImpl = vi.fn<DeviceFetch>(async (url) =>
      url.endsWith("/api/v1/access/token")
        ? json({
            accessToken: "bbt_renewed",
            accessTokenExpiresAt: 3_600_000,
            sessionExpiresAt: 99,
          })
        : json({
            token: "bbs_child",
            cookieName: "bb_session_443",
            expiresAt: 3_600_000,
          }),
    );
    const jar = cookieJar();
    const outcome = await refreshDeviceSession({
      cookieExpiresAt: null,
      cookieJar: jar,
      fetchImpl,
      now: () => 0,
      origin: ORIGIN,
      store: deviceStore,
    });
    expect(outcome).toEqual({
      kind: "active",
      accessTokenExpiresAt: 3_600_000,
      cookieExpiresAt: 3_600_000,
    });
    const [renewal, mint] = fetchImpl.mock.calls.map(
      ([, init]) => new Headers(init?.headers),
    );
    expect(renewal?.get("authorization")).toBe("DPoP bbt_old");
    expect(proofPayload(renewal?.get("dpop") ?? null).ath).toBeUndefined();
    expect(mint?.get("authorization")).toBe("DPoP bbt_renewed");
    expect(proofPayload(mint?.get("dpop") ?? null).ath).toEqual(
      expect.any(String),
    );
    expect(jar.sets).toEqual([
      expect.objectContaining({
        name: "bb_session_443",
        value: "bbs_child",
        httpOnly: true,
        secure: true,
        url: ORIGIN,
      }),
    ]);
  });

  it("forgets a revoked sign-in so the window asks for a new code", async () => {
    const { store: deviceStore } = store();
    await deviceStore.write(ORIGIN, credential({ accessTokenExpiresAt: 0 }));
    const fetchImpl = vi.fn<DeviceFetch>(async () =>
      json({ code: "unauthenticated", message: "revoked" }, 401),
    );
    const outcome = await refreshDeviceSession({
      cookieExpiresAt: null,
      cookieJar: cookieJar(),
      fetchImpl,
      now: () => 0,
      origin: ORIGIN,
      store: deviceStore,
    });
    expect(outcome).toEqual({ kind: "revoked" });
    expect(await deviceStore.read(ORIGIN)).toBeNull();
  });

  it("leaves a fresh cookie and token alone", async () => {
    const { store: deviceStore } = store();
    await deviceStore.write(ORIGIN, credential());
    const fetchImpl = vi.fn<DeviceFetch>();
    const outcome = await refreshDeviceSession({
      cookieExpiresAt: 60 * 60_000,
      cookieJar: cookieJar(),
      fetchImpl,
      now: () => 0,
      origin: ORIGIN,
      store: deviceStore,
    });
    expect(outcome.kind).toBe("active");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
