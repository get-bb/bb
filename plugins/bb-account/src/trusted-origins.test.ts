import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  type FakePluginHost,
} from "@get-bb/plugin-sdk/testing";
import { createBbAccountPlugin } from "./plugin.js";
import { CREDENTIAL_KV_KEY } from "./store.js";
import { StubGetbb } from "./testing/stub-getbb.js";

const origin = "https://bb.example.test";
let stub: StubGetbb;
let attemptedUrls: string[];
const hosts: FakePluginHost[] = [];

beforeEach(async () => {
  stub = await StubGetbb.start();
  attemptedUrls = [];
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("BB_ACCOUNT_TRUSTED_ORIGINS", origin);
  const send = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input);
      attemptedUrls.push(url.href);
      if (url.origin !== origin) throw new Error("unexpected test egress");
      return send(new URL(url.pathname + url.search, stub.apexUrl), init);
    },
  );
});

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.dispose();
  await stub.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function load() {
  const host = createFakePluginHost({ pluginId: "bb-account" });
  hosts.push(host);
  await createBbAccountPlugin()(host.bb);
  return host;
}

describe("operator-trusted account origins", () => {
  it("redeems through the default production plugin and real account HTTP endpoints", async () => {
    const host = await load();
    stub.issueRedeemCode("SELF-HOST");
    const result = await host.harness.runCli([
      "login",
      "--code",
      "SELF-HOST",
      "--base-url",
      origin,
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      state: "signed-in",
      account: { userId: "usr_1", baseUrl: origin },
    });
    expect(stub.requestsTo("/api/connect/redeem")).toHaveLength(1);
    expect(stub.requestsTo("/api/account/me")).toHaveLength(1);
    expect(await host.bb.storage.kv.get(CREDENTIAL_KV_KEY)).toMatchObject({
      baseUrl: origin,
    });
  });

  it.each([
    "https://evil.test",
    "https://bb.example.test.evil.test",
    "http://bb.example.test",
  ])(
    "denies untrusted account redemption before fetch: %s",
    async (baseUrl) => {
      const host = await load();
      stub.issueRedeemCode("STILL-VALID");
      await expect(
        host.harness.callRpc("redeemCode", { code: "STILL-VALID", baseUrl }),
      ).rejects.toThrow("can't sign in");
      expect(attemptedUrls).toEqual([]);
      expect(stub.requests).toEqual([]);
      await expect(
        host.harness.callRpc("redeemCode", {
          code: "STILL-VALID",
          baseUrl: origin,
        }),
      ).resolves.toMatchObject({ state: "signed-in" });
    },
  );

  it.each([
    "https://evil.test",
    "https://bb.example.test.evil.test",
    "http://bb.example.test",
  ])("denies untrusted browser sign-in before fetch: %s", async (baseUrl) => {
    const host = await load();
    await expect(
      host.harness.callRpc("login.start", { baseUrl }),
    ).rejects.toThrow("can't sign in");
    expect(attemptedUrls).toEqual([]);
    expect(stub.requests).toEqual([]);
  });

  it.each([
    [`${origin}/path`, "must be an origin"],
    [`${origin}?`, "must be an origin"],
    [`${origin}#`, "must be an origin"],
    [`${origin}/../`, "must be an origin"],
    ["https://user:password@bb.example.test", "must not contain credentials"],
  ])(
    "rejects non-origin account redemption before fetch: %s",
    async (baseUrl, error) => {
      const host = await load();
      await expect(
        host.harness.callRpc("redeemCode", { code: "UNUSED", baseUrl }),
      ).rejects.toThrow(error);
      expect(attemptedUrls).toEqual([]);
      expect(stub.requests).toEqual([]);
    },
  );

  it("captures trust at activation instead of accepting a later environment change", async () => {
    vi.stubEnv("BB_ACCOUNT_TRUSTED_ORIGINS", undefined);
    const host = await load();
    vi.stubEnv("BB_ACCOUNT_TRUSTED_ORIGINS", origin);
    await expect(
      host.harness.callRpc("redeemCode", { code: "UNUSED", baseUrl: origin }),
    ).rejects.toThrow("can't sign in");
    expect(attemptedUrls).toEqual([]);
    expect(stub.requests).toEqual([]);
  });

  it("does not make a trusted origin the default login site", async () => {
    const host = await load();
    const result = await host.harness.runCli(["login", "--code", "UNUSED"]);
    expect(result.exitCode).toBe(1);
    expect(attemptedUrls).toEqual(["https://getbb.app/api/connect/redeem"]);
    expect(stub.requests).toEqual([]);
  });
});

describe("trusted account HTTP boundaries", () => {
  it("rejects invalid operator configuration before loading or making a request", async () => {
    vi.stubEnv("BB_ACCOUNT_TRUSTED_ORIGINS", `${origin},http://unsafe.test`);
    await expect(load()).rejects.toThrow("BB_ACCOUNT_TRUSTED_ORIGINS must be");
    expect(attemptedUrls).toEqual([]);
    expect(stub.requests).toEqual([]);
  });

  it("starts browser approval at the configured origin and refuses a foreign verification link", async () => {
    const host = await load();
    const reply = {
      deviceCode: "test-device",
      userCode: "TEST-CODE",
      expiresAt: Date.now() + 59_000,
      intervalMs: 30_000,
    };
    stub.route("POST", "/api/account/link/start", () => ({
      status: 200,
      body: { ...reply, verificationUrl: `${origin}/link?code=TEST-CODE` },
    }));
    await expect(
      host.harness.callRpc("login.start", { baseUrl: origin }),
    ).resolves.toMatchObject({
      state: "pending",
      verificationUrl: `${origin}/link?code=TEST-CODE`,
    });
    stub.route("POST", "/api/account/link/start", () => ({
      status: 200,
      body: { ...reply, verificationUrl: "https://untrusted.test/link" },
    }));
    await expect(
      host.harness.callRpc("login.start", { baseUrl: origin }),
    ).rejects.toThrow("unavailable");
    expect(stub.requestsTo("/api/account/link/start")).toHaveLength(2);
    expect(attemptedUrls).toEqual([
      `${origin}/api/account/link/start`,
      `${origin}/api/account/link/start`,
    ]);
  });

  it("does not follow a redirect when redeeming a code", async () => {
    const host = await load();
    stub.route("POST", "/api/connect/redeem", () => ({
      status: 302,
      headers: { location: `${stub.apexUrl}/unexpected` },
    }));
    const result = await host.harness.runCli([
      "login",
      "--code",
      "NO-REDIRECT",
      "--base-url",
      origin,
    ]);
    expect(result.exitCode).toBe(1);
    expect(stub.requests.map((r) => r.path)).toEqual(["/api/connect/redeem"]);
    expect(await host.bb.storage.kv.get(CREDENTIAL_KV_KEY)).toBeUndefined();
  });
});
