import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { accountPoolConfigSchema, type PoolProvider } from "./contracts.js";
import { createHub, type AccountPoolHub } from "./hub.js";
import {
  AccountStore,
  HubTokenStore,
  PoolAffinityStore,
  QUOTA_MIGRATIONS,
  QuotaStore,
} from "./store.js";

const MINUTE = 60_000;
const ROUTE = "/api/v1/plugins/account-pool/http";
const REFRESH_URL = "https://oauth.invalid/token";
const USAGE_URL = "https://usage.invalid/usage";
const UPSTREAM_URL = "https://upstream.invalid";
const REJECTED = "OAuth refresh failed with HTTP 400. invalid_grant.";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

function testJwt(payload: object): string {
  return [
    Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "signature",
  ].join(".");
}

async function createPool(provider: PoolProvider, refreshFailureStatus = 400) {
  const dataDir = await fs.mkdtemp(
    path.join(tmpdir(), "bb-account-pool-rejection-"),
  );
  const host = createFakePluginHost({ pluginId: "account-pool", dataDir });
  const database = host.bb.storage.database();
  host.bb.storage.migrate(database, QUOTA_MIGRATIONS);
  const secretsDir = path.join(dataDir, "secrets");
  let time = 1_800_000_000_000;
  const now = () => time;
  const stores = () => ({
    accounts: new AccountStore(host.bb.storage.kv, secretsDir),
    quotas: new QuotaStore(database),
    affinity: new PoolAffinityStore(database),
    hubTokens: new HubTokenStore(secretsDir, now),
  });
  const initial = stores();
  await initial.accounts.initialize();
  const addAccount = (
    name: string,
    priority: number,
    accessToken: string,
    refreshToken: string,
    ttl: number,
  ) =>
    initial.accounts.add(
      {
        provider,
        kind: "oauth",
        label: name,
        email: null,
        accountUuid: null,
        ...(provider === "codex" ? { codexAccountId: name } : {}),
        subscriptionType: null,
        rateLimitTier: null,
        enabled: true,
        priority,
      },
      { kind: "oauth", accessToken, refreshToken, expiresAt: time + ttl },
    );
  const account = await addAccount(
    "synthetic-account",
    100,
    "access-original",
    "refresh-original",
    10 * MINUTE,
  );
  const refreshTokens: string[] = [];
  const authorizations: string[] = [];
  const accepted = new Set<string>();
  const unavailable = new Set<string>();
  const issued = new Map<string, string>();
  const rejectedAccessTokens = new Set<string>();
  let beforeRefreshResponse = async (_refreshToken: string) => {};
  let accountsChanged = 0;
  const transport: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url === REFRESH_URL) {
      const { refresh_token } = z
        .object({ refresh_token: z.string() })
        .parse(JSON.parse(String(init?.body)));
      refreshTokens.push(refresh_token);
      await beforeRefreshResponse(refresh_token);
      if (accepted.has(refresh_token)) {
        const accessToken = testJwt({
          exp: Math.floor(time / 1_000) + 3_600,
          sub: refresh_token,
        });
        issued.set(refresh_token, accessToken);
        return Response.json({
          access_token: accessToken,
          refresh_token: `next-${refresh_token}`,
          expires_in: 3_600,
        });
      }
      const status = unavailable.has(refresh_token)
        ? 503
        : refreshFailureStatus;
      return Response.json(
        { error: status === 400 ? "invalid_grant" : "temporarily_unavailable" },
        { status },
      );
    }
    if (url === USAGE_URL) return Response.json({});
    if (url.startsWith(`${UPSTREAM_URL}/`)) {
      const authorization = new Headers(init?.headers).get("authorization");
      authorizations.push(authorization ?? "");
      return rejectedAccessTokens.has(
        authorization?.replace(/^Bearer /u, "") ?? "",
      )
        ? Response.json(
            { error: { message: "invalid access token" } },
            { status: 401 },
          )
        : Response.json({ id: "synthetic-response" });
    }
    throw new Error(`Unexpected network destination ${url}.`);
  };
  const startHub = async (
    current: ReturnType<typeof stores>,
  ): Promise<{ hub: AccountPoolHub; stop: () => Promise<void> }> => {
    const hub = createHub({
      ...current,
      now,
      fetch: transport,
      getSettings: () =>
        accountPoolConfigSchema.parse({
          anthropicUpstreamBaseUrl: UPSTREAM_URL,
          codexUpstreamBaseUrl: UPSTREAM_URL,
        }),
      refreshUrl: REFRESH_URL,
      codexRefreshUrl: REFRESH_URL,
      usageUrl: USAGE_URL,
      codexUsageUrl: USAGE_URL,
      onAccountsChanged: () => {
        accountsChanged += 1;
      },
    });
    const controller = new AbortController();
    const running = hub.start(controller.signal);
    await hub.refreshUsage();
    return {
      hub,
      stop: async () => {
        controller.abort();
        await running;
      },
    };
  };
  let active = await startHub(initial);
  cleanups.push(async () => {
    await active.stop();
    await host.harness.lifecycle.dispose();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  const token = await initial.hubTokens.forHost("synthetic-host");
  const route = provider === "claude" ? "/v1/messages" : "/v1/responses";
  return {
    account,
    accounts: initial.accounts,
    kv: host.bb.storage.kv,
    refreshTokens,
    authorizations,
    accepted,
    unavailable,
    issued,
    rejectedAccessTokens,
    accountsChanged: () => accountsChanged,
    advance: (milliseconds: number) => {
      time += milliseconds;
    },
    error: () => initial.quotas.get(account.id).error,
    tick: () => active.hub.refreshUsage(),
    restart: async () => {
      await active.stop();
      active = await startHub(stores());
    },
    beforeRefreshResponse: (hook: (refreshToken: string) => Promise<void>) => {
      beforeRefreshResponse = hook;
    },
    replaceSecret: (accessToken: string, refreshToken: string, ttl: number) =>
      initial.accounts.writeSecret(account.id, {
        kind: "oauth",
        accessToken,
        refreshToken,
        expiresAt: time + ttl,
      }),
    addFallbackAccount: (
      accessToken: string,
      refreshToken: string,
      ttl: number,
    ) =>
      addAccount(
        "fallback-synthetic-account",
        200,
        accessToken,
        refreshToken,
        ttl,
      ),
    request: async () => {
      const response = await active.hub.handle(
        new Request(`https://hub.invalid${ROUTE}${route}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(
            provider === "claude"
              ? {
                  model: "claude-sonnet-4-5",
                  max_tokens: 1,
                  messages: [{ role: "user", content: "ok" }],
                }
              : { model: "gpt-5", input: "ok" },
          ),
        }),
        provider,
        route,
      );
      await response.text();
      return response.status;
    },
  };
}

describe.each(["claude", "codex"] as const)(
  "%s refresh token rejected by the token endpoint",
  (provider) => {
    it("sends a rejected refresh token at most once from the background and errors the account after expiry", async () => {
      const pool = await createPool(provider);
      const changes = pool.accountsChanged();
      pool.advance(7 * MINUTE);
      await pool.tick();
      expect(pool.refreshTokens).toEqual(["refresh-original"]);
      expect(pool.error()).toBeNull();
      expect(pool.accountsChanged()).toBe(changes);

      pool.advance(5 * MINUTE);
      await pool.tick();
      expect(pool.refreshTokens).toEqual(["refresh-original"]);
      expect(pool.error()).toBe(REJECTED);
      expect(pool.accountsChanged()).toBe(changes + 1);

      pool.advance(5 * MINUTE);
      await pool.tick();
      expect(await pool.request()).toBe(429);
      expect(pool.refreshTokens).toEqual(["refresh-original"]);
      expect(pool.authorizations).toEqual([]);
      expect(pool.accountsChanged()).toBe(changes + 1);
    });

    it("does not replay a rejected refresh token after a hub restart", async () => {
      const pool = await createPool(provider);
      pool.advance(7 * MINUTE);
      await pool.tick();
      expect(pool.refreshTokens).toEqual(["refresh-original"]);

      await pool.restart();
      expect(pool.refreshTokens).toEqual(["refresh-original"]);
      expect(await pool.request()).toBe(200);
      pool.advance(5 * MINUTE);
      await pool.tick();

      expect(pool.refreshTokens).toEqual(["refresh-original"]);
      expect(pool.error()).toBe(REJECTED);
    });

    it("errors the account without a refresh replay when upstream rejects the access token", async () => {
      const pool = await createPool(provider);
      pool.advance(7 * MINUTE);
      expect(await pool.request()).toBe(200);
      const changes = pool.accountsChanged();

      pool.rejectedAccessTokens.add("access-original");
      expect(await pool.request()).toBe(401);

      expect(pool.refreshTokens).toEqual(["refresh-original"]);
      expect(pool.error()).toBe(REJECTED);
      expect(pool.accountsChanged()).toBe(changes + 1);
    });

    it("moves the request to the next account when upstream rejects the kept access token", async () => {
      const pool = await createPool(provider);
      await pool.addFallbackAccount(
        "access-fallback",
        "refresh-fallback",
        60 * MINUTE,
      );
      pool.advance(7 * MINUTE);
      expect(await pool.request()).toBe(200);

      pool.rejectedAccessTokens.add("access-original");
      expect(await pool.request()).toBe(200);

      expect(pool.refreshTokens).toEqual(["refresh-original"]);
      expect(pool.authorizations).toEqual([
        "Bearer access-original",
        "Bearer access-original",
        "Bearer access-fallback",
      ]);
      expect(pool.error()).toBe(REJECTED);
    });

    it("uses a credential replaced during the rejected refresh instead of erroring", async () => {
      const pool = await createPool(provider);
      pool.advance(11 * MINUTE);
      pool.beforeRefreshResponse(() =>
        pool.replaceSecret(
          "access-replacement",
          "refresh-replacement",
          60 * MINUTE,
        ),
      );

      expect(await pool.request()).toBe(200);

      expect(pool.refreshTokens).toEqual(["refresh-original"]);
      expect(pool.authorizations).toEqual(["Bearer access-replacement"]);
      expect(pool.error()).toBeNull();
    });

    it("recovers an errored account on the next background tick after its refresh token is replaced", async () => {
      const pool = await createPool(provider);
      pool.advance(7 * MINUTE);
      await pool.tick();
      pool.advance(5 * MINUTE);
      await pool.tick();
      expect(pool.error()).toBe(REJECTED);
      const changes = pool.accountsChanged();

      pool.accepted.add("refresh-replacement");
      await pool.replaceSecret(
        "access-replacement",
        "refresh-replacement",
        MINUTE,
      );
      pool.advance(5 * MINUTE);
      await pool.tick();

      expect(pool.refreshTokens).toEqual([
        "refresh-original",
        "refresh-replacement",
      ]);
      expect(pool.error()).toBeNull();
      expect(pool.accountsChanged()).toBe(changes + 1);
      expect(await pool.request()).toBe(200);
      expect(pool.authorizations).toEqual([
        `Bearer ${pool.issued.get("refresh-replacement")}`,
      ]);
    });

    it.each([400, 503])(
      "serves a replaced login whose refresh fails with HTTP %i while its access token is valid",
      async (status) => {
        const pool = await createPool(provider);
        pool.advance(7 * MINUTE);
        await pool.tick();
        pool.advance(5 * MINUTE);
        await pool.tick();
        expect(pool.error()).toBe(REJECTED);

        if (status === 503) pool.unavailable.add("refresh-replacement");
        pool.advance(5 * MINUTE);
        await pool.replaceSecret(
          "access-replacement",
          "refresh-replacement",
          2 * MINUTE,
        );
        await pool.tick();

        expect(pool.refreshTokens).toEqual([
          "refresh-original",
          "refresh-replacement",
        ]);
        expect(pool.error()).toBeNull();
        expect(await pool.request()).toBe(200);
        expect(pool.authorizations).toEqual(["Bearer access-replacement"]);
      },
    );

    it("adopts a replaced credential that is not due for refresh without contacting the token endpoint", async () => {
      const pool = await createPool(provider);
      pool.advance(7 * MINUTE);
      await pool.tick();
      pool.advance(5 * MINUTE);
      await pool.tick();
      expect(pool.error()).toBe(REJECTED);

      await pool.replaceSecret(
        "access-replacement",
        "refresh-replacement",
        60 * MINUTE,
      );
      pool.advance(5 * MINUTE);
      await pool.tick();

      expect(pool.refreshTokens).toEqual(["refresh-original"]);
      expect(pool.error()).toBeNull();
      expect(await pool.request()).toBe(200);
      expect(pool.authorizations).toEqual(["Bearer access-replacement"]);
    });

    it("keeps serving and retrying after a transient refresh failure", async () => {
      const pool = await createPool(provider, 503);
      pool.advance(7 * MINUTE);
      expect(await pool.request()).toBe(200);
      expect(pool.authorizations).toEqual(["Bearer access-original"]);
      expect(pool.error()).toBeNull();

      pool.advance(5 * MINUTE);
      await pool.tick();

      expect(pool.refreshTokens).toEqual([
        "refresh-original",
        "refresh-original",
      ]);
      expect(pool.error()).toBeNull();
    });
  },
);

it("remembers only a fingerprint of a rejected refresh token and forgets it with the account", async () => {
  const pool = await createPool("claude");
  const keysBefore = await pool.kv.list("");
  const storedValues = async () =>
    Promise.all(
      (await pool.kv.list("")).map(async (key) =>
        JSON.stringify(await pool.kv.get(key)),
      ),
    );
  pool.advance(7 * MINUTE);
  await pool.tick();

  const fingerprint = createHash("sha256")
    .update("refresh-original")
    .digest("hex");
  const values = await storedValues();
  expect(values.filter((value) => value.includes(fingerprint))).toHaveLength(1);
  expect(values.join("\n")).not.toContain("refresh-original");

  expect(await pool.accounts.remove(pool.account.id)).toBe(true);
  expect(await pool.kv.list("")).toEqual(keysBefore);
});
