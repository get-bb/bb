import { describe, expect, it } from "vitest";
import {
  gateAudienceForServer,
  generateGateKeyPair,
  importGateKeySet,
  importGateSigningKey,
  parseGateKeySet,
  signGateAssertion,
  verifyGateAssertion,
  type SignGateAssertionInput,
} from "../src/next.js";

const NOW = 1_800_000_000;

function input(overrides: Partial<SignGateAssertionInput> = {}) {
  return {
    audience: gateAudienceForServer("srv_1"),
    subject: "usr_1",
    kind: "session" as const,
    method: "post",
    pathAndQuery: "/api/v1/threads?x=1",
    target: null,
    oauth: null,
    nowSeconds: NOW,
    ...overrides,
  };
}

async function setup() {
  const pair = await generateGateKeyPair("k1");
  const keySet = parseGateKeySet(
    JSON.parse(JSON.stringify({ keys: [pair.publicKey] })),
  );
  if (keySet === null) throw new Error("key set did not parse");
  const keys = await importGateKeySet(keySet);
  const signingKey = await importGateSigningKey(pair.privateJwk);
  return { keys, signingKey };
}

function verifyInput(keys: ReadonlyMap<string, CryptoKey>) {
  return {
    keys,
    audience: gateAudienceForServer("srv_1"),
    method: "POST",
    pathAndQuery: "/api/v1/threads?x=1",
    nowSeconds: NOW + 10,
  };
}

describe("gate assertions", () => {
  it("carries public assertions for unauthenticated install paths", async () => {
    const { keys, signingKey } = await setup();
    const token = await signGateAssertion(
      signingKey,
      input({
        kind: "public",
        subject: "",
        method: "GET",
        pathAndQuery: "/install.sh",
      }),
    );
    const result = await verifyGateAssertion(token, {
      ...verifyInput(keys),
      method: "GET",
      pathAndQuery: "/install.sh",
    });
    expect(result).toMatchObject({
      ok: true,
      claims: { kind: "public", sub: "" },
    });
  });

  it("round-trips through a serialized key set and private JWK", async () => {
    const { keys, signingKey } = await setup();
    const token = await signGateAssertion(signingKey, input());
    const result = await verifyGateAssertion(token, verifyInput(keys));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.sub).toBe("usr_1");
      expect(result.claims.htm).toBe("POST");
    }
  });

  it("refuses another server, method or path", async () => {
    const { keys, signingKey } = await setup();
    const token = await signGateAssertion(signingKey, input());
    const base = verifyInput(keys);
    await expect(
      verifyGateAssertion(token, {
        ...base,
        audience: gateAudienceForServer("srv_2"),
      }),
    ).resolves.toEqual({ ok: false, reason: "wrong_audience" });
    await expect(
      verifyGateAssertion(token, { ...base, method: "DELETE" }),
    ).resolves.toEqual({ ok: false, reason: "wrong_method" });
    await expect(
      verifyGateAssertion(token, { ...base, pathAndQuery: "/api/v1/threads" }),
    ).resolves.toEqual({ ok: false, reason: "wrong_path" });
  });

  it("refuses expired, tampered and foreign-key tokens", async () => {
    const { keys, signingKey } = await setup();
    const token = await signGateAssertion(signingKey, input());
    const base = verifyInput(keys);
    await expect(
      verifyGateAssertion(token, { ...base, nowSeconds: NOW + 60 + 31 }),
    ).resolves.toEqual({ ok: false, reason: "expired" });
    const [payload = "", signature = ""] = token.split(".");
    const claims = JSON.parse(
      atob(payload.replace(/-/gu, "+").replace(/_/gu, "/")),
    );
    const forged = btoa(JSON.stringify({ ...claims, sub: "usr_2" }))
      .replace(/\+/gu, "-")
      .replace(/\//gu, "_")
      .replace(/=+$/u, "");
    await expect(
      verifyGateAssertion(`${forged}.${signature}`, base),
    ).resolves.toEqual({ ok: false, reason: "bad_signature" });
    const other = await generateGateKeyPair("k1");
    const foreign = await signGateAssertion(other.signingKey, input());
    await expect(verifyGateAssertion(foreign, base)).resolves.toEqual({
      ok: false,
      reason: "bad_signature",
    });
    await expect(verifyGateAssertion("nope", base)).resolves.toEqual({
      ok: false,
      reason: "malformed",
    });
  });
});
