import fs from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  accountSchema,
  accountSummarySchema,
  loginStartSchema,
  statusSchema,
  type Account,
  type LoginTarget,
} from "./contracts.js";
import { createAccountPoolPlugin } from "./server.js";
import { AccountStore } from "./store.js";

const UPSTREAM = "https://anthropic.test";
const AUTH = "https://auth.test";
const CODEX_AUTH = "https://codex-auth.test";

interface Identity {
  uuid: string;
  email: string;
}

interface CodexIdentity {
  accountId: string;
  email: string;
}

interface Grant {
  access: string;
  refresh: string;
}

const ME: Identity = {
  uuid: "11111111-1111-4111-8111-111111111111",
  email: "me@example.com",
};
const SPOUSE: Identity = {
  uuid: "22222222-2222-4222-8222-222222222222",
  email: "spouse@example.com",
};

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

function jwt(payload: object): string {
  return [
    Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "signature",
  ].join(".");
}

class FakeProviders {
  private issued = 0;
  private readonly refreshTokens = new Map<
    string,
    { identity: Identity; spent: boolean }
  >();
  private readonly accessTokens = new Map<string, Identity>();
  nextClaudeLogin: Identity | null = null;
  nextCodexLogin: CodexIdentity | null = null;
  readonly upstreamAuthorizations: string[] = [];
  readonly usageAuthorizations: string[] = [];
  refreshRequests = 0;

  grant(identity: Identity): Grant {
    this.issued += 1;
    const access = `access-${this.issued}`;
    const refresh = `refresh-${this.issued}`;
    this.accessTokens.set(access, identity);
    this.refreshTokens.set(refresh, { identity, spent: false });
    return { access, refresh };
  }

  refresh(refreshToken: string): Grant | null {
    this.refreshRequests += 1;
    const entry = this.refreshTokens.get(refreshToken);
    if (entry === undefined || entry.spent) return null;
    entry.spent = true;
    return this.grant(entry.identity);
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const bearer =
      request.headers.get("authorization")?.replace(/^Bearer /u, "") ?? "";
    if (url.origin === AUTH && url.pathname === "/token") {
      const body = z
        .object({
          grant_type: z.string(),
          refresh_token: z.string().optional(),
        })
        .passthrough()
        .parse(await request.json());
      const issued =
        body.grant_type === "authorization_code"
          ? this.nextClaudeLogin === null
            ? null
            : this.grant(this.nextClaudeLogin)
          : body.refresh_token === undefined
            ? null
            : this.refresh(body.refresh_token);
      return issued === null
        ? Response.json({ error: "invalid_grant" }, { status: 400 })
        : Response.json({
            access_token: issued.access,
            refresh_token: issued.refresh,
            expires_in: 28_800,
          });
    }
    if (url.origin === AUTH && url.pathname === "/profile") {
      const identity = this.accessTokens.get(bearer);
      return identity === undefined
        ? new Response(null, { status: 401 })
        : Response.json({
            account: {
              uuid: identity.uuid,
              email: identity.email,
              has_claude_max: true,
            },
          });
    }
    if (url.origin === AUTH && url.pathname === "/usage") {
      this.usageAuthorizations.push(bearer);
      return Response.json({
        five_hour: { utilization: 42, resets_at: "4102444800" },
      });
    }
    if (url.origin === UPSTREAM && url.pathname === "/v1/messages") {
      if (!this.accessTokens.has(bearer)) {
        return Response.json({ type: "error" }, { status: 401 });
      }
      this.upstreamAuthorizations.push(bearer);
      return Response.json({ id: "message" });
    }
    if (url.origin === CODEX_AUTH) {
      if (url.pathname === "/api/accounts/deviceauth/usercode") {
        return Response.json({
          device_auth_id: "device",
          user_code: "ABCD-1234",
          interval: 1,
          expires_in: 600,
        });
      }
      if (url.pathname === "/api/accounts/deviceauth/token") {
        return Response.json({
          authorization_code: "authorization",
          code_challenge: "challenge",
          code_verifier: "verifier",
        });
      }
      if (url.pathname === "/oauth/token" && this.nextCodexLogin !== null) {
        this.issued += 1;
        return Response.json({
          access_token: jwt({ exp: 4_102_444_800 }),
          refresh_token: `codex-refresh-${this.issued}`,
          id_token: jwt({
            email: this.nextCodexLogin.email,
            "https://api.openai.com/auth": {
              chatgpt_account_id: this.nextCodexLogin.accountId,
            },
          }),
        });
      }
    }
    if (url.pathname === "/codex-usage") return Response.json({});
    throw new Error(`Unexpected request to ${request.url}`);
  };
}

async function startPool(providers: FakeProviders) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "bb-account-login-"));
  const host = createFakePluginHost({
    pluginId: "account-pool",
    dataDir,
    sdk: {
      hosts: { list: async () => [{ id: "host-one", name: "One" }] },
      threads: { events: { list: async () => [] } },
      system: { providerStates: async () => ({ providers: [] }) },
      plugins: {
        list: async () => ({
          plugins: [{ id: "account-pool", enabled: true }],
        }),
      },
    },
  });
  await host.bb.storage.kv.set("config", {
    anthropicUpstreamBaseUrl: UPSTREAM,
    codexUpstreamBaseUrl: UPSTREAM,
  });
  await createAccountPoolPlugin({
    fetch: providers.fetch,
    refreshUrl: `${AUTH}/token`,
    usageUrl: `${AUTH}/usage`,
    oauthAuthorizeUrl: `${AUTH}/authorize`,
    oauthTokenUrl: `${AUTH}/token`,
    oauthProfileUrl: `${AUTH}/profile`,
    codexAuthBaseUrl: CODEX_AUTH,
    codexUsageUrl: `${CODEX_AUTH}/codex-usage`,
  })(host.bb);
  const service = host.harness.behavior.runService("hub");
  cleanups.push(async () => {
    service.controller.abort();
    await service.done;
    await host.harness.lifecycle.dispose();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  await vi.waitFor(async () => {
    expect(
      statusSchema.parse(
        await host.harness.behavior.callRpc("status.get", null),
      ).accepting,
    ).toBe(true);
  });
  const store = new AccountStore(
    host.bb.storage.kv,
    path.join(dataDir, "plugins", "account-pool", "secrets", "accounts"),
  );
  return { host, store };
}

type Pool = Awaited<ReturnType<typeof startPool>>;

async function signInClaude(
  pool: Pool,
  providers: FakeProviders,
  identity: Identity,
  target: LoginTarget,
): Promise<Account> {
  const started = loginStartSchema.parse(
    await pool.host.harness.behavior.callRpc("login.start", target),
  );
  const state = new URL(started.authorizeUrl).searchParams.get("state");
  providers.nextClaudeLogin = identity;
  return accountSchema.parse(
    await pool.host.harness.behavior.callRpc("login.complete", {
      sessionId: started.sessionId,
      pasted: `code#${state}`,
    }),
  );
}

async function summary(pool: Pool, id: string) {
  const accounts = z
    .array(accountSummarySchema)
    .parse(await pool.host.harness.behavior.callRpc("account.list", null));
  const account = accounts.find((candidate) => candidate.id === id);
  if (account === undefined) throw new Error(`Account ${id} is not listed.`);
  return account;
}

async function sendMessage(pool: Pool, sessionId: string): Promise<number> {
  const entries = await pool.host.harness.behavior.resolveProviderEnv(
    "claude-code",
    { threadId: "thread-one", projectId: "project-one", hostId: "host-one" },
  );
  const token = entries.find((entry) => entry.name === "ANTHROPIC_AUTH_TOKEN");
  if (typeof token?.value !== "string") throw new Error("Pool is not routed.");
  const response = await pool.host.harness.behavior.fetchHttp(
    "POST",
    "/v1/messages",
    {
      headers: {
        authorization: `Bearer ${token.value}`,
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-1",
        metadata: {
          user_id: JSON.stringify({
            device_id: "device",
            session_id: sessionId,
          }),
        },
        messages: [],
      }),
    },
  );
  await response.text();
  return response.status;
}

describe("Account Pooler logins", () => {
  it("re-login replaces a refresh chain shared with this machine without touching the machine's chain", async () => {
    const providers = new FakeProviders();
    const pool = await startPool(providers);
    const machineLogin = providers.grant(ME);
    const shared = await pool.store.add(
      {
        provider: "claude",
        kind: "oauth",
        label: "Imported before sign-in was required",
        email: ME.email,
        accountUuid: ME.uuid,
        subscriptionType: "max",
        rateLimitTier: null,
        enabled: true,
        priority: 7,
      },
      {
        kind: "oauth",
        accessToken: machineLogin.access,
        refreshToken: machineLogin.refresh,
        expiresAt: Date.now() - 1_000,
      },
    );
    const machineRefreshed = providers.refresh(machineLogin.refresh);
    expect(machineRefreshed).not.toBeNull();

    expect(await sendMessage(pool, "session-shared")).not.toBe(200);
    expect((await summary(pool, shared.id)).error).toMatch(/HTTP 400/u);

    const refreshesBeforeLogin = providers.refreshRequests;
    const relogged = await signInClaude(pool, providers, ME, {
      kind: "relogin",
      accountId: shared.id,
    });
    expect(providers.refreshRequests).toBe(refreshesBeforeLogin);
    expect(relogged).toMatchObject({
      id: shared.id,
      label: "Imported before sign-in was required",
      priority: 7,
      enabled: true,
      createdAt: shared.createdAt,
    });
    expect((await summary(pool, shared.id)).error).toBeNull();
    const secret = await pool.store.readSecret(shared.id);
    if (secret.kind !== "oauth") throw new Error("Expected an OAuth secret.");
    expect(secret.refreshToken).not.toBe(machineRefreshed?.refresh);

    expect(await sendMessage(pool, "session-shared")).toBe(200);
    expect(providers.upstreamAuthorizations).toEqual([secret.accessToken]);
    expect(providers.refresh(secret.refreshToken)).not.toBeNull();
    expect(
      machineRefreshed === null
        ? null
        : providers.refresh(machineRefreshed.refresh),
    ).not.toBeNull();
  });

  it("re-login keeps id, priority, disabled state, pins, and quota for every account", async () => {
    const providers = new FakeProviders();
    const pool = await startPool(providers);
    const main = await signInClaude(pool, providers, ME, {
      kind: "add",
      label: "Main",
      priority: 1,
    });
    const started = await pool.host.harness.behavior.runCli([
      "account",
      "add",
      "--provider",
      "claude",
      "--login",
      "--label",
      "Reserve",
      "--priority",
      "8",
    ]);
    expect(started.exitCode).toBe(0);
    const sessionId = started.stdout.match(/Session ID: ([0-9a-f-]+)/u)?.[1];
    const authorizeUrl = started.stdout.match(
      /sign in to Claude:\n([^\n]+)/u,
    )?.[1];
    if (sessionId === undefined || authorizeUrl === undefined) {
      throw new Error("CLI login did not print its session.");
    }
    providers.nextClaudeLogin = SPOUSE;
    const completed = await pool.host.harness.behavior.runCli([
      "account",
      "login-complete",
      "--session",
      sessionId,
      "--code",
      `code#${new URL(authorizeUrl).searchParams.get("state")}`,
      "--json",
    ]);
    expect(completed.exitCode).toBe(0);
    const reserve = accountSchema.parse(
      z.object({ account: z.unknown() }).parse(JSON.parse(completed.stdout))
        .account,
    );
    expect(reserve).toMatchObject({ label: "Reserve", priority: 8 });
    await pool.host.harness.behavior.callRpc("account.disable", {
      id: reserve.id,
    });

    expect(await sendMessage(pool, "session-pinned")).toBe(200);
    const mainBefore = await summary(pool, main.id);
    expect(mainBefore.fiveHourUtilization).toBe(0.42);
    const reserveUsageCalls = () =>
      providers.usageAuthorizations.filter(
        (token) => !providers.upstreamAuthorizations.includes(token),
      ).length;
    const usageCallsBefore = reserveUsageCalls();

    const relogReserve = await signInClaude(pool, providers, SPOUSE, {
      kind: "relogin",
      accountId: reserve.id,
    });
    expect(relogReserve).toMatchObject({
      id: reserve.id,
      label: "Reserve",
      priority: 8,
      enabled: false,
    });
    expect(reserveUsageCalls()).toBe(usageCallsBefore);

    const relogMain = await signInClaude(pool, providers, ME, {
      kind: "relogin",
      accountId: main.id,
    });
    expect(relogMain).toMatchObject({
      id: main.id,
      label: "Main",
      priority: 1,
    });
    const mainSecret = await pool.store.readSecret(main.id);
    if (mainSecret.kind !== "oauth") throw new Error("Expected OAuth.");
    expect(await sendMessage(pool, "session-pinned")).toBe(200);
    expect(providers.upstreamAuthorizations.at(-1)).toBe(
      mainSecret.accessToken,
    );
    const mainAfter = await summary(pool, main.id);
    expect(mainAfter.fiveHourUtilization).toBe(0.42);
    expect(mainAfter.createdAt).toBe(mainBefore.createdAt);
    expect((await summary(pool, reserve.id)).status).toBe("disabled");
  });

  it("refuses a login for a different account and keeps the stored login", async () => {
    const providers = new FakeProviders();
    const pool = await startPool(providers);
    const main = await signInClaude(pool, providers, ME, {
      kind: "add",
      label: null,
      priority: 100,
    });
    const before = await pool.store.readSecret(main.id);
    const started = await pool.host.harness.behavior.runCli([
      "account",
      "login",
      main.id,
    ]);
    expect(started.exitCode).toBe(0);
    const sessionId = started.stdout.match(/Session ID: ([0-9a-f-]+)/u)?.[1];
    const authorizeUrl = started.stdout.match(
      /sign in to Claude:\n([^\n]+)/u,
    )?.[1];
    if (sessionId === undefined || authorizeUrl === undefined) {
      throw new Error("CLI login did not print its session.");
    }
    providers.nextClaudeLogin = SPOUSE;
    const completed = await pool.host.harness.behavior.runCli([
      "account",
      "login-complete",
      "--session",
      sessionId,
      "--code",
      `code#${new URL(authorizeUrl).searchParams.get("state")}`,
    ]);
    expect(completed.exitCode).toBe(1);
    expect(completed.stderr).toContain(
      "This login is for spouse@example.com, not me@example.com.",
    );
    expect(await pool.store.readSecret(main.id)).toEqual(before);
    expect(await summary(pool, main.id)).toMatchObject({
      email: ME.email,
      accountUuid: ME.uuid,
    });

    await pool.host.harness.behavior.callRpc("account.add", {
      provider: "claude",
      apiKey: "sk-ant-key",
      label: "Metered",
      priority: 200,
    });
    const apiKeyAccount = (
      await z
        .array(accountSummarySchema)
        .parse(await pool.host.harness.behavior.callRpc("account.list", null))
    ).find((account) => account.kind === "api-key");
    const apiKeyLogin = await pool.host.harness.behavior.runCli([
      "account",
      "login",
      apiKeyAccount?.id ?? "",
    ]);
    expect(apiKeyLogin.exitCode).toBe(1);
    expect(apiKeyLogin.stderr).toContain(
      "Metered uses an API key and has no login to renew.",
    );
  });

  it("re-logs a Codex account in place through the device flow and refuses another workspace", async () => {
    const providers = new FakeProviders();
    const pool = await startPool(providers);
    const account = await pool.store.add(
      {
        provider: "codex",
        kind: "oauth",
        label: "Work Codex",
        email: "codex@example.com",
        accountUuid: null,
        codexAccountId: "workspace-a",
        subscriptionType: null,
        rateLimitTier: null,
        enabled: true,
        priority: 3,
      },
      {
        kind: "oauth",
        accessToken: "stale-access",
        refreshToken: "stale-refresh",
        expiresAt: null,
      },
    );
    const relogin = async (identity: CodexIdentity) => {
      const started = await pool.host.harness.behavior.runCli([
        "account",
        "login",
        account.id,
      ]);
      expect(started.stdout).toContain("Enter this code: ABCD-1234");
      const sessionId = started.stdout.match(/Session ID: ([0-9a-f-]+)/u)?.[1];
      if (sessionId === undefined) throw new Error("No Codex session.");
      providers.nextCodexLogin = identity;
      return pool.host.harness.behavior.runCli([
        "account",
        "login-poll",
        "--session",
        sessionId,
      ]);
    };

    const refused = await relogin({
      accountId: "workspace-b",
      email: "codex@example.com",
    });
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain(
      "This login is for a different ChatGPT workspace than Work Codex.",
    );
    expect(await pool.store.readSecret(account.id)).toMatchObject({
      refreshToken: "stale-refresh",
    });

    const accepted = await relogin({
      accountId: "workspace-a",
      email: "codex@example.com",
    });
    expect(accepted).toMatchObject({
      exitCode: 0,
      stdout: expect.stringContaining("Signed in Work Codex"),
    });
    expect(await summary(pool, account.id)).toMatchObject({
      id: account.id,
      label: "Work Codex",
      priority: 3,
      enabled: true,
      codexAccountId: "workspace-a",
      error: null,
    });
    const secret = await pool.store.readSecret(account.id);
    expect(secret).toMatchObject({ kind: "oauth" });
    expect(secret).not.toMatchObject({ refreshToken: "stale-refresh" });
  });
});
