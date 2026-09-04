import fs from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  accountSchema,
  accountSecretSchema,
  accountSummarySchema,
  statusSchema,
  type AccountSummary,
} from "./contracts.js";
import { z } from "zod";
import type { ImportedClaudeCredentials } from "./credentials.js";
import { HubTokenStore } from "./store.js";
import {
  createAccountPoolPlugin,
  helloResponse,
  type AccountPoolPluginOptions,
} from "./server.js";

type UpstreamHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void | Promise<void>;

interface Upstream {
  url: string;
  close: () => Promise<void>;
}

interface Fixture {
  dataDir: string;
  host: ReturnType<typeof createFakePluginHost>;
  service: ReturnType<
    ReturnType<typeof createFakePluginHost>["harness"]["behavior"]["runService"]
  >;
  key: string;
  account: AccountSummary;
}

const cleanups: Array<() => Promise<void>> = [];

function sdkStubs() {
  return {
    hosts: {
      list: async () => [
        {
          id: "host-one",
          name: "One",
        },
        {
          id: "host-two",
          name: "Two",
        },
      ],
    },
    system: {
      providerStates: async () => ({ providers: [] }),
    },
    plugins: {
      list: async () => ({
        plugins: [{ id: "account-pool", enabled: true }],
      }),
    },
  };
}

async function resolveToken(
  host: ReturnType<typeof createFakePluginHost>,
  hostId = "host-one",
  threadId = "thread-one",
): Promise<string> {
  const entries = await host.harness.behavior.resolveProviderEnv(
    "claude-code",
    { threadId, projectId: "project-one", hostId },
  );
  const token = entries.find((entry) => entry.name === "ANTHROPIC_AUTH_TOKEN");
  if (token === undefined || typeof token.value !== "string") {
    throw new Error("Account Pool token was not resolved.");
  }
  return token.value;
}

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function startUpstream(handler: UpstreamHandler): Promise<Upstream> {
  const server = http.createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch((error) => {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : String(error));
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Fake upstream did not bind a TCP port.");
  }
  const url = `http://127.0.0.1:${address.port}`;
  return {
    url,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function importedCredentials(
  overrides: Partial<ImportedClaudeCredentials> = {},
): ImportedClaudeCredentials {
  return {
    accessToken: "oauth-access",
    refreshToken: "oauth-refresh",
    expiresAt: Date.now() + 60 * 60 * 1_000,
    subscriptionType: "max",
    rateLimitTier: "max_5x",
    email: "pool@example.com",
    ...overrides,
  };
}

async function createFixture(args: {
  upstreamUrl: string;
  options?: AccountPoolPluginOptions;
  source?: "api-key" | "import";
  apiKey?: string;
  priority?: number;
}): Promise<Fixture> {
  const dataDir = await mkdtemp(path.join(tmpdir(), "bb-account-pool-"));
  const host = createFakePluginHost({
    pluginId: "account-pool",
    dataDir,
    settings: {
      upstreamBaseUrl: args.upstreamUrl,
      switchThreshold: 0.98,
    },
    sdk: sdkStubs(),
  });
  const plugin = createAccountPoolPlugin(args.options);
  await plugin(host.bb);
  const accountMetadata = accountSchema.parse(
    await host.harness.behavior.callRpc("account.add", {
      provider: "claude",
      source:
        args.source === "import"
          ? { kind: "import" }
          : { kind: "api-key", apiKey: args.apiKey ?? "sk-account" },
      label: null,
      priority: args.priority ?? 100,
    }),
  );
  const service = host.harness.behavior.runService("hub");
  await vi.waitFor(async () => {
    const result = await host.harness.behavior.runCli(["status", "--json"]);
    expect(result.exitCode).toBe(0);
    expect(statusSchema.parse(JSON.parse(result.stdout)).accepting).toBe(true);
  });
  const statusResult = await host.harness.behavior.runCli(["status", "--json"]);
  const status = statusSchema.parse(JSON.parse(statusResult.stdout));
  const account = status.accounts.find(
    (candidate) => candidate.id === accountMetadata.id,
  );
  if (account === undefined) throw new Error("Added account was not listed.");
  cleanups.push(async () => {
    service.controller.abort();
    await service.done;
    await host.harness.lifecycle.dispose();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  return { dataDir, host, service, key: await resolveToken(host), account };
}

function authHeaders(key: string): Record<string, string> {
  return {
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
  };
}

async function addApiAccount(
  fixture: Fixture,
  apiKey: string,
  priority = 100,
): Promise<AccountSummary> {
  const added = accountSchema.parse(
    await fixture.host.harness.behavior.callRpc("account.add", {
      provider: "claude",
      source: { kind: "api-key", apiKey },
      label: apiKey,
      priority,
    }),
  );
  const list = z
    .array(accountSummarySchema)
    .parse(await fixture.host.harness.behavior.callRpc("account.list", null));
  const found = list.find((account) => account.id === added.id);
  if (found === undefined) throw new Error("Added account was not listed.");
  return found;
}

describe("Account Pool plugin", () => {
  it("prunes token files for unenrolled hosts on startup and status", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "bb-pool-prune-"));
    const secretDir = path.join(
      dataDir,
      "plugins",
      "account-pool",
      "secrets",
      "accounts",
    );
    const seededTokens = new HubTokenStore(secretDir);
    await seededTokens.initialize();
    await seededTokens.forHost("host-gone");
    const goneTokenFile = path.join(secretDir, "hub-token-host-gone.json");
    await expect(fs.access(goneTokenFile)).resolves.toBeUndefined();
    const host = createFakePluginHost({
      pluginId: "account-pool",
      dataDir,
      sdk: sdkStubs(),
    });
    await createAccountPoolPlugin()(host.bb);
    cleanups.push(async () => {
      await host.harness.lifecycle.dispose();
      await fs.rm(dataDir, { recursive: true, force: true });
    });
    await expect(fs.access(goneTokenFile)).rejects.toThrow();
    await host.harness.behavior.callRpc("account.add", {
      provider: "claude",
      source: { kind: "api-key", apiKey: "sk-account" },
      label: null,
      priority: 100,
    });
    await resolveToken(host, "host-two", "thread-two");
    const hostTwoTokenFile = path.join(secretDir, "hub-token-host-two.json");
    await expect(fs.access(hostTwoTokenFile)).resolves.toBeUndefined();
    host.harness.sdk.stub("hosts.list", async () => [
      { id: "host-one", name: "One" },
    ]);
    const status = statusSchema.parse(
      await host.harness.behavior.callRpc("status", null),
    );
    expect(status.hosts).toEqual([]);
    await expect(fs.access(hostTwoTokenFile)).rejects.toThrow();
  });

  it("uses a single-process token cache and throttles last-use file writes", async () => {
    let now = 1_000;
    const dataDir = await mkdtemp(path.join(tmpdir(), "bb-pool-tokens-"));
    cleanups.push(() => fs.rm(dataDir, { recursive: true, force: true }));
    const tokens = new HubTokenStore(dataDir, () => now);
    await tokens.initialize();
    const token = await tokens.forHost("host-one");
    const tokenFile = path.join(dataDir, "hub-token-host-one.json");
    await fs.writeFile(
      tokenFile,
      `${JSON.stringify({
        hostId: "host-one",
        value: "A".repeat(43),
        mintedAt: now,
        lastUsedAt: null,
        previous: [],
      })}\n`,
    );
    const writeFile = vi.spyOn(fs, "writeFile");
    try {
      expect(await tokens.authenticate(token)).toBe("host-one");
      now += 30_000;
      expect(await tokens.authenticate(token)).toBe("host-one");
      expect(await tokens.authenticate("A".repeat(43))).toBeNull();
      expect(writeFile).toHaveBeenCalledTimes(1);
      now += 30_000;
      expect(await tokens.authenticate(token)).toBe("host-one");
      expect(writeFile).toHaveBeenCalledTimes(2);
    } finally {
      writeFile.mockRestore();
    }
  });

  it("forwards the next request after adding the first account through the CLI", async () => {
    let forwarded = 0;
    const upstream = await startUpstream(async (request, response) => {
      forwarded += 1;
      await readRequestBody(request);
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"forwarded":true}');
    });
    cleanups.push(upstream.close);
    const dataDir = await mkdtemp(
      path.join(tmpdir(), "bb-account-pool-empty-"),
    );
    const host = createFakePluginHost({
      pluginId: "account-pool",
      dataDir,
      settings: { upstreamBaseUrl: upstream.url, switchThreshold: 0.98 },
      sdk: sdkStubs(),
    });
    await createAccountPoolPlugin()(host.bb);
    const service = host.harness.behavior.runService("hub");
    cleanups.push(async () => {
      service.controller.abort();
      await service.done;
      await host.harness.lifecycle.dispose();
      await fs.rm(dataDir, { recursive: true, force: true });
    });
    const statusResult = await host.harness.behavior.runCli([
      "status",
      "--json",
    ]);
    const status = statusSchema.parse(JSON.parse(statusResult.stdout));
    expect(status.accepting).toBe(true);
    expect(status.hosts).toEqual([]);
    expect(
      await host.harness.behavior.resolveProviderEnv("claude-code", {
        threadId: "thread-empty",
        projectId: "project-one",
        hostId: "host-one",
      }),
    ).toEqual([]);
    await expect(
      host.harness.behavior.resolveProviderEnvHealth("claude-code", {
        hostId: "host-one",
      }),
    ).resolves.toBeNull();
    expect(host.harness.inspection.needsConfigurationMessages).toEqual([
      "Add and enable a Claude account with `bb pool account add`.",
    ]);
    const hello = helloResponse();
    expect(hello.status).toBe(200);
    const added = await host.harness.behavior.runCli([
      "account",
      "add",
      "--provider",
      "claude",
      "--api-key",
      "sk-cli-secret",
      "--label",
      "CLI account",
      "--priority",
      "7",
    ]);
    expect(added.exitCode).toBe(0);
    expect(added.stdout).not.toContain("sk-cli-secret");
    expect(added.stdout).not.toContain("reload");
    const key = await resolveToken(host, "host-one", "thread-empty");
    const forwardedResponse = await host.harness.behavior.fetchHttp(
      "POST",
      "/v1/messages",
      { headers: authHeaders(key), body: "{}" },
    );
    expect(forwardedResponse.status).toBe(200);
    expect(await forwardedResponse.text()).toBe('{"forwarded":true}');
    expect(forwarded).toBe(1);
  });

  it("exposes every account CLI operation", async () => {
    const upstream = await startUpstream(async (request, response) => {
      await readRequestBody(request);
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
    cleanups.push(upstream.close);
    const fixture = await createFixture({ upstreamUrl: upstream.url });
    const help = await fixture.host.harness.behavior.runCli([
      "account",
      "add",
      "--help",
    ]);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("--login");
    expect(help.stdout).toContain("account login-complete");
    expect(help.stdout).toContain("--code-stdin");
    expect(help.stdout).toContain("--api-key-stdin");
    expect(help.stdout).toContain("Unsafe: exposes the key");
    const list = await fixture.host.harness.behavior.runCli([
      "account",
      "list",
      "--json",
    ]);
    const listed = z
      .object({ accounts: z.array(accountSummarySchema) })
      .strict()
      .parse(JSON.parse(list.stdout));
    const account = listed.accounts[0];
    if (account === undefined) throw new Error("CLI account was not listed.");
    expect(account).toMatchObject({ label: "Claude API key", priority: 100 });
    expect(
      (
        await fixture.host.harness.behavior.runCli([
          "account",
          "disable",
          account.id,
        ])
      ).exitCode,
    ).toBe(0);
    expect(
      z
        .array(accountSummarySchema)
        .parse(
          await fixture.host.harness.behavior.callRpc("account.list", null),
        )[0]?.status,
    ).toBe("disabled");
    expect(
      (
        await fixture.host.harness.behavior.runCli([
          "account",
          "enable",
          account.id,
        ])
      ).exitCode,
    ).toBe(0);
    const publicStatus = statusSchema.parse(
      JSON.parse(
        (await fixture.host.harness.behavior.runCli(["status", "--json"]))
          .stdout,
      ),
    );
    expect(publicStatus.accepting).toBe(true);
    expect(publicStatus.hosts).toEqual([
      expect.objectContaining({ hostId: "host-one", hostName: "One" }),
    ]);
    expect(publicStatus).not.toHaveProperty("hubKey");
    expect(JSON.stringify(publicStatus)).not.toContain(fixture.key);
    const counted = await fixture.host.harness.behavior.fetchHttp(
      "POST",
      "/v1/messages/count_tokens",
      { headers: authHeaders(fixture.key), body: "{}" },
    );
    expect(counted.status).toBe(200);
    expect(await counted.text()).toBe("{}");
    expect(
      (
        await fixture.host.harness.behavior.runCli([
          "account",
          "remove",
          account.id,
        ])
      ).exitCode,
    ).toBe(0);
    expect(
      await fixture.host.harness.behavior.callRpc("account.list", null),
    ).toEqual([]);
  });

  it("exposes manual Claude login over RPC and the two-step CLI", async () => {
    const tokenBodies: object[] = [];
    const oauth = await startUpstream(async (request, response) => {
      if (request.url === "/token") {
        tokenBodies.push(
          JSON.parse((await readRequestBody(request)).toString()),
        );
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            access_token: "login-access",
            refresh_token: "login-refresh",
            expires_in: 3600,
          }),
        );
        return;
      }
      if (request.url === "/profile") {
        expect(request.headers.authorization).toBe("Bearer login-access");
        expect(request.headers["anthropic-beta"]).toBe("oauth-2025-04-20");
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            account: {
              email: "login@example.com",
              display_name: "Logged-in Claude",
              has_claude_pro: true,
              rate_limit_tier: "default_claude_pro",
            },
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    cleanups.push(oauth.close);
    const dataDir = await mkdtemp(path.join(tmpdir(), "bb-pool-login-rpc-"));
    const host = createFakePluginHost({
      pluginId: "account-pool",
      dataDir,
      sdk: sdkStubs(),
    });
    await createAccountPoolPlugin({
      oauthAuthorizeUrl: `${oauth.url}/authorize`,
      oauthTokenUrl: `${oauth.url}/token`,
      oauthProfileUrl: `${oauth.url}/profile`,
    })(host.bb);
    cleanups.push(async () => {
      await host.harness.lifecycle.dispose();
      await fs.rm(dataDir, { recursive: true, force: true });
    });
    const started = z
      .object({ sessionId: z.string().uuid(), authorizeUrl: z.string().url() })
      .strict()
      .parse(await host.harness.behavior.callRpc("login.start", null));
    const state = new URL(started.authorizeUrl).searchParams.get("state");
    if (state === null) throw new Error("Login start did not return state.");
    const account = accountSchema.parse(
      await host.harness.behavior.callRpc("login.complete", {
        sessionId: started.sessionId,
        pasted: `login-code#${state}`,
      }),
    );
    expect(account).toMatchObject({
      label: "Logged-in Claude",
      email: "login@example.com",
      subscriptionType: "pro",
      rateLimitTier: "default_claude_pro",
      kind: "oauth",
      enabled: true,
    });
    expect(tokenBodies).toHaveLength(1);
    expect(tokenBodies[0]).toMatchObject({
      code: "login-code",
      state,
      grant_type: "authorization_code",
      redirect_uri: "https://console.anthropic.com/oauth/code/callback",
      client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
    });
    const secret = accountSecretSchema.parse(
      JSON.parse(
        await fs.readFile(
          path.join(
            dataDir,
            "plugins",
            "account-pool",
            "secrets",
            "accounts",
            `account-${account.id}.json`,
          ),
          "utf8",
        ),
      ),
    );
    expect(secret).toMatchObject({
      kind: "oauth",
      accessToken: "login-access",
      refreshToken: "login-refresh",
    });
    expect(host.harness.inspection.realtimeSignals).toContainEqual({
      channel: "accounts-changed",
      payload: {},
    });

    const cliStarted = await host.harness.behavior.runCli([
      "account",
      "add",
      "--provider",
      "claude",
      "--login",
    ]);
    expect(cliStarted.exitCode).toBe(0);
    expect(cliStarted.stdout).toContain("Open this URL to sign in to Claude:");
    expect(cliStarted.stdout).toContain("account login-complete");
    expect(cliStarted.stdout).toContain("--code-stdin");
    const sessionId = cliStarted.stdout.match(/Session ID: ([0-9a-f-]+)/u)?.[1];
    const authorizeUrl = cliStarted.stdout.match(
      /Open this URL to sign in to Claude:\n([^\n]+)/u,
    )?.[1];
    if (sessionId === undefined || authorizeUrl === undefined) {
      throw new Error("CLI login start did not return its session and URL.");
    }
    const cliState = new URL(authorizeUrl).searchParams.get("state");
    if (cliState === null) throw new Error("CLI login start omitted state.");
    const cliCompleted = await host.harness.behavior.runCli([
      "account",
      "login-complete",
      "--session",
      sessionId,
      "--code",
      `cli-code#${cliState}`,
    ]);
    expect(cliCompleted).toMatchObject({
      exitCode: 0,
      stdout: expect.stringContaining("Added Logged-in Claude"),
    });
    expect(tokenBodies).toHaveLength(2);
    expect(tokenBodies[1]).toMatchObject({ code: "cli-code", state: cliState });
  });

  it("resolves distinct secret machine tokens and honors per-thread bypass", async () => {
    const upstream = await startUpstream(async (request, response) => {
      await readRequestBody(request);
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
    cleanups.push(upstream.close);
    const fixture = await createFixture({ upstreamUrl: upstream.url });
    const first = await fixture.host.harness.behavior.resolveProviderEnv(
      "claude-code",
      {
        threadId: "thread-one",
        projectId: "project-one",
        hostId: "host-one",
      },
    );
    expect(first).toEqual([
      {
        name: "ANTHROPIC_BASE_URL",
        value: { serverPath: "/api/v1/plugins/account-pool/http" },
        reason: "Routed through the Account Pool hub",
        secret: false,
      },
      {
        name: "ANTHROPIC_AUTH_TOKEN",
        value: fixture.key,
        reason: "Account Pool hub token for this machine",
        secret: true,
      },
      {
        name: "ENABLE_TOOL_SEARCH",
        value: "true",
        reason:
          "Claude Code turns tool search off behind a custom base URL; the hub forwards tool_reference blocks",
        secret: false,
      },
    ]);
    await expect(
      fixture.host.harness.behavior.resolveProviderEnvHealth("claude-code", {
        hostId: "host-one",
      }),
    ).resolves.toEqual({
      label: "Proxied",
      statusMessage: "Credentials are provided by the Account Pool hub.",
    });
    const secondToken = await resolveToken(
      fixture.host,
      "host-two",
      "thread-two",
    );
    expect(secondToken).not.toBe(fixture.key);
    expect(
      await fixture.host.harness.behavior.callRpc("bypass.set", {
        threadId: "thread-one",
        bypassed: true,
      }),
    ).toEqual({ threadId: "thread-one", bypassed: true });
    expect(
      await fixture.host.harness.behavior.resolveProviderEnv("claude-code", {
        threadId: "thread-one",
        projectId: "project-one",
        hostId: "host-one",
      }),
    ).toEqual([]);
    const off = await fixture.host.harness.behavior.runCli([
      "bypass",
      "thread-one",
      "--off",
    ]);
    expect(off.exitCode).toBe(0);
    expect(await resolveToken(fixture.host)).toBe(fixture.key);
  });

  it("withholds env and proxied health when an enabled account secret is missing", async () => {
    const upstream = await startUpstream(async (request, response) => {
      await readRequestBody(request);
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
    cleanups.push(upstream.close);
    const fixture = await createFixture({ upstreamUrl: upstream.url });
    const accountSecretFile = path.join(
      fixture.dataDir,
      "plugins",
      "account-pool",
      "secrets",
      "accounts",
      `account-${fixture.account.id}.json`,
    );
    await fs.rm(accountSecretFile);
    await expect(
      fixture.host.harness.behavior.resolveProviderEnv("claude-code", {
        threadId: "thread-without-secret",
        projectId: "project-one",
        hostId: "host-one",
      }),
    ).resolves.toEqual([]);
    await expect(
      fixture.host.harness.behavior.resolveProviderEnvHealth("claude-code", {
        hostId: "host-one",
      }),
    ).resolves.toBeNull();
  });

  it("rotates a machine token with a ten-minute grace window", async () => {
    let now = 1_000;
    const upstream = await startUpstream(async (request, response) => {
      await readRequestBody(request);
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
    cleanups.push(upstream.close);
    const fixture = await createFixture({
      upstreamUrl: upstream.url,
      options: { now: () => now },
    });
    const first = await fixture.host.harness.behavior.fetchHttp(
      "POST",
      "/v1/messages",
      { headers: authHeaders(fixture.key), body: "{}" },
    );
    expect(first.status).toBe(200);
    await first.text();
    now = 2_000;
    const rotate = await fixture.host.harness.behavior.runCli([
      "token",
      "rotate",
      "--machine",
      "One",
    ]);
    expect(rotate.exitCode).toBe(0);
    expect(rotate.stdout).not.toContain(fixture.key);
    const nextKey = await resolveToken(fixture.host);
    expect(nextKey).not.toBe(fixture.key);
    now += 9 * 60 * 1_000;
    const grace = await fixture.host.harness.behavior.fetchHttp(
      "POST",
      "/v1/messages",
      { headers: authHeaders(fixture.key), body: "{}" },
    );
    expect(grace.status).toBe(200);
    await grace.text();
    now = 2_000 + 10 * 60 * 1_000 + 1;
    const expired = await fixture.host.harness.behavior.fetchHttp(
      "POST",
      "/v1/messages",
      { headers: authHeaders(fixture.key), body: "{}" },
    );
    expect(expired.status).toBe(401);
    const current = await fixture.host.harness.behavior.fetchHttp(
      "POST",
      "/v1/messages",
      { headers: authHeaders(nextKey), body: "{}" },
    );
    expect(current.status).toBe(200);
    await current.text();
    const tokenFile = path.join(
      fixture.dataDir,
      "plugins",
      "account-pool",
      "secrets",
      "accounts",
      "hub-token-host-one.json",
    );
    expect(await fs.readFile(tokenFile, "utf8")).not.toContain(fixture.key);
    const status = statusSchema.parse(
      await fixture.host.harness.behavior.callRpc("status", null),
    );
    expect(status.hosts).toEqual([
      {
        hostId: "host-one",
        hostName: "One",
        mintedAt: 2_000,
        lastUsedAt: now,
      },
    ]);
    expect(JSON.stringify(status)).not.toContain(fixture.key);
    expect(JSON.stringify(status)).not.toContain(nextKey);
  });

  it("reports routed threads without local login and logs them on disable", async () => {
    const upstream = await startUpstream(async (request, response) => {
      await readRequestBody(request);
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
    cleanups.push(upstream.close);
    const fixture = await createFixture({ upstreamUrl: upstream.url });
    await resolveToken(fixture.host, "host-two", "thread-two");
    fixture.host.harness.sdk.stub(
      "system.providerStates",
      async ({ hostId }) => ({
        providers: [
          {
            providerId: "claude-code",
            status: hostId === "host-one" ? "unauthenticated" : "ready",
            planLabel: null,
          },
        ],
      }),
    );
    const status = statusSchema.parse(
      await fixture.host.harness.behavior.callRpc("status", null),
    );
    expect(status.routedThreadsWithoutLocalLogin).toEqual([
      {
        threadId: "thread-one",
        hostId: "host-one",
        hostName: "One",
        routedAt: expect.any(Number),
        localClaudeStatus: "unauthenticated",
      },
    ]);
    fixture.host.harness.sdk.stub("plugins.list", async () => ({
      plugins: [{ id: "account-pool", enabled: false }],
    }));
    await fixture.host.harness.lifecycle.dispose();
    expect(fixture.host.harness.inspection.logEntries).toContainEqual({
      level: "warn",
      message:
        "Account Pool disabled with 1 recently routed thread on machines without a local Claude login. Run bb pool status before disabling to inspect them.",
    });
  });

  it("does not fail disposal when disable inspection rejects", async () => {
    const upstream = await startUpstream(async (request, response) => {
      await readRequestBody(request);
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
    cleanups.push(upstream.close);
    const fixture = await createFixture({ upstreamUrl: upstream.url });
    fixture.host.harness.sdk.stub("plugins.list", async () => {
      throw new Error("plugin list unavailable");
    });
    await expect(fixture.host.harness.lifecycle.dispose()).resolves.toBe(
      undefined,
    );
    expect(fixture.host.harness.inspection.logEntries).toContainEqual({
      level: "debug",
      message:
        "Account Pool disable inspection skipped: plugin list unavailable",
    });
  });

  it("bounds disable inspection when provider states hang", async () => {
    const upstream = await startUpstream(async (request, response) => {
      await readRequestBody(request);
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
    cleanups.push(upstream.close);
    const fixture = await createFixture({
      upstreamUrl: upstream.url,
      options: { disposeTimeoutMs: 10 },
    });
    fixture.host.harness.sdk.stub("plugins.list", async () => ({
      plugins: [{ id: "account-pool", enabled: false }],
    }));
    fixture.host.harness.sdk.stub(
      "system.providerStates",
      () => new Promise(() => {}),
    );
    await expect(fixture.host.harness.lifecycle.dispose()).resolves.toBe(
      undefined,
    );
    expect(fixture.host.harness.inspection.logEntries).toContainEqual({
      level: "debug",
      message: "Account Pool disable inspection timed out.",
    });
  });

  it("keeps proxied routed hosts visible in status", async () => {
    const upstream = await startUpstream(async (request, response) => {
      await readRequestBody(request);
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
    cleanups.push(upstream.close);
    const fixture = await createFixture({ upstreamUrl: upstream.url });
    fixture.host.harness.sdk.stub("system.providerStates", async () => ({
      providers: [
        {
          providerId: "claude-code",
          status: "ready",
          planLabel: "Proxied",
        },
      ],
    }));
    const status = statusSchema.parse(
      await fixture.host.harness.behavior.callRpc("status", null),
    );
    expect(status.routedThreadsWithoutLocalLogin).toEqual([
      {
        threadId: "thread-one",
        hostId: "host-one",
        hostName: "One",
        routedAt: expect.any(Number),
        localClaudeStatus: "proxied",
      },
    ]);
  });

  it("requires a machine token and forwards a streaming SSE response byte for byte", async () => {
    const seen: {
      url: string;
      authorization: string | undefined;
      clientApiKey: string | undefined;
      beta: string | undefined;
      version: string | undefined;
      userAgent: string | undefined;
      app: string | undefined;
      stainlessRetry: string | undefined;
      cookie: string | undefined;
      gateMachineId: string | undefined;
      forwarded: string | undefined;
      cfRay: string | undefined;
      body: Buffer;
    }[] = [];
    const first = Buffer.from('event: message_start\ndata: {"one":1}\n\n');
    const second = Buffer.from('event: message_stop\ndata: {"two":2}\n\n');
    const upstream = await startUpstream(async (request, response) => {
      seen.push({
        url: request.url ?? "",
        authorization: request.headers.authorization,
        clientApiKey: request.headers["x-api-key"]?.toString(),
        beta: request.headers["anthropic-beta"]?.toString(),
        version: request.headers["anthropic-version"]?.toString(),
        userAgent: request.headers["user-agent"]?.toString(),
        app: request.headers["x-app"]?.toString(),
        stainlessRetry: request.headers["x-stainless-retry-count"]?.toString(),
        cookie: request.headers.cookie,
        gateMachineId: request.headers["x-bb-gate-machine-id"]?.toString(),
        forwarded: request.headers.forwarded,
        cfRay: request.headers["cf-ray"]?.toString(),
        body: await readRequestBody(request),
      });
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "anthropic-ratelimit-unified-5h-utilization": "0.25",
        "anthropic-ratelimit-unified-5h-reset": "4102444800",
        "anthropic-ratelimit-unified-5h-status": "allowed",
        "anthropic-ratelimit-unified-7d-utilization": "0.5",
        "anthropic-ratelimit-unified-7d-reset": "4102448400",
        "anthropic-ratelimit-unified-7d-status": "allowed",
        "anthropic-ratelimit-unified-representative-claim": "claim-a",
        "anthropic-ratelimit-unified-status": "rejected",
        "anthropic-ratelimit-unified-overage-status": "rejected",
        "anthropic-ratelimit-unified-7d_oi-status": "rejected",
        "anthropic-ratelimit-unified-7d_oi-reset": "4102452000",
      });
      response.write(first);
      setTimeout(() => response.end(second), 60);
    });
    cleanups.push(upstream.close);
    const fixture = await createFixture({
      upstreamUrl: upstream.url,
      source: "import",
      options: { importCredentials: async () => importedCredentials() },
    });
    const unauthorized = await fixture.host.harness.behavior.fetchHttp(
      "POST",
      "/v1/messages",
      { headers: { "content-type": "application/json" }, body: "{}" },
    );
    expect(unauthorized.status).toBe(401);
    expect(seen).toHaveLength(0);
    const body = Buffer.from('{"model":"claude-test","stream":true}');
    const response = await fixture.host.harness.behavior.fetchHttp(
      "POST",
      "/v1/messages?beta=true",
      {
        headers: {
          ...authHeaders(fixture.key),
          "x-api-key": "client-key-must-not-forward",
          "anthropic-beta": "feature-a,feature-b",
          "user-agent": "claude-code-test",
          "x-app": "cli",
          "x-stainless-retry-count": "2",
          cookie: "bb_session=browser-secret",
          "x-bb-gate-machine-id": "machine-stable-id",
          forwarded: "for=192.0.2.1",
          "cf-ray": "edge-request-id",
          "accept-encoding": "gzip",
        },
        body,
      },
    );
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error("Expected an SSE response body.");
    const firstRead = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("First SSE chunk was buffered.")),
          30,
        ),
      ),
    ]);
    expect(firstRead.done).toBe(false);
    expect(Buffer.from(firstRead.value ?? []).equals(first)).toBe(true);
    const remaining: Buffer[] = [];
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      remaining.push(Buffer.from(chunk.value));
    }
    expect(
      Buffer.concat([Buffer.from(firstRead.value ?? []), ...remaining]),
    ).toEqual(Buffer.concat([first, second]));
    expect(seen).toEqual([
      {
        url: "/v1/messages?beta=true",
        authorization: "Bearer oauth-access",
        clientApiKey: undefined,
        beta: "feature-a,feature-b",
        version: "2023-06-01",
        userAgent: "claude-code-test",
        app: "cli",
        stainlessRetry: "2",
        cookie: undefined,
        gateMachineId: undefined,
        forwarded: undefined,
        cfRay: undefined,
        body,
      },
    ]);
    const accounts = z
      .array(accountSummarySchema)
      .parse(await fixture.host.harness.behavior.callRpc("account.list", null));
    expect(accounts[0]).toMatchObject({
      fiveHourUtilization: 0.25,
      sevenDayUtilization: 0.5,
      fiveHourStatus: "allowed",
      sevenDayStatus: "allowed",
      representativeClaim: "claim-a",
      bucketExhaustion: { "7d_oi": 4_102_452_000_000 },
    });
    expect(fixture.host.harness.inspection.registrations.httpRoutes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "HEAD",
          path: "/api/hello",
          auth: "none",
        }),
      ]),
    );
  });

  it("errors a failed non-SSE stream without appending an SSE frame", async () => {
    const partial = Buffer.from('{"partial":');
    const upstream = await startUpstream(async (request, response) => {
      await readRequestBody(request);
      response.writeHead(200, { "content-type": "application/json" });
      response.write(partial);
      setTimeout(() => response.destroy(new Error("upstream failed")), 30);
    });
    cleanups.push(upstream.close);
    const fixture = await createFixture({ upstreamUrl: upstream.url });
    const response = await fixture.host.harness.behavior.fetchHttp(
      "POST",
      "/v1/messages",
      { headers: authHeaders(fixture.key), body: "{}" },
    );
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error("Expected a streaming body.");
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(Buffer.from(first.value ?? [])).toEqual(partial);
    await expect(reader.read()).rejects.toThrow();
  });

  it("skips threshold-exhausted accounts and rotates quota rejections", async () => {
    const keys: string[] = [];
    let requestNumber = 0;
    const upstream = await startUpstream((request, response) => {
      requestNumber += 1;
      keys.push(request.headers["x-api-key"]?.toString() ?? "");
      if (requestNumber === 1) {
        response.writeHead(200, {
          "content-type": "application/json",
          "anthropic-ratelimit-unified-5h-utilization": "0.99",
          "anthropic-ratelimit-unified-5h-reset": "4102444800",
          "anthropic-ratelimit-unified-5h-status": "allowed",
        });
        response.end('{"first":true}');
        return;
      }
      if (requestNumber === 2) {
        response.writeHead(429, {
          "content-type": "application/json",
          "anthropic-ratelimit-unified-5h-status": "rejected",
          "anthropic-ratelimit-unified-5h-reset": "4102444800",
        });
        response.end('{"rejected":true}');
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"rotated":true}');
    });
    cleanups.push(upstream.close);
    const fixture = await createFixture({
      upstreamUrl: upstream.url,
      apiKey: "sk-one",
    });
    await addApiAccount(fixture, "sk-two");
    await addApiAccount(fixture, "sk-three");
    const first = await fixture.host.harness.behavior.fetchHttp(
      "POST",
      "/v1/messages",
      {
        headers: authHeaders(fixture.key),
        body: "{}",
      },
    );
    expect(first.status).toBe(200);
    await first.text();
    const rotated = await fixture.host.harness.behavior.fetchHttp(
      "POST",
      "/v1/messages",
      {
        headers: authHeaders(fixture.key),
        body: "{}",
      },
    );
    expect(rotated.status).toBe(200);
    expect(await rotated.text()).toBe('{"rotated":true}');
    expect(keys).toEqual(["sk-one", "sk-two", "sk-three"]);
  });

  it("paces a per-minute 429 on the same account without rotating", async () => {
    const keys: string[] = [];
    const times: number[] = [];
    const upstream = await startUpstream((request, response) => {
      keys.push(request.headers["x-api-key"]?.toString() ?? "");
      times.push(Date.now());
      if (keys.length === 1) {
        response.writeHead(429, {
          "content-type": "application/json",
          "retry-after": "0.04",
        });
        response.end('{"minute":true}');
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"retried":true}');
    });
    cleanups.push(upstream.close);
    const fixture = await createFixture({
      upstreamUrl: upstream.url,
      apiKey: "sk-one",
    });
    await addApiAccount(fixture, "sk-two");
    const response = await fixture.host.harness.behavior.fetchHttp(
      "POST",
      "/v1/messages",
      {
        headers: authHeaders(fixture.key),
        body: "{}",
      },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"retried":true}');
    expect(keys).toEqual(["sk-one", "sk-one"]);
    expect((times[1] ?? 0) - (times[0] ?? 0)).toBeGreaterThanOrEqual(30);
  });

  it("serializes refresh, writes new tokens with 0600 mode, and uses them", async () => {
    let refreshCalls = 0;
    const authorizations: Array<string | undefined> = [];
    const upstream = await startUpstream(async (request, response) => {
      if (request.url === "/oauth/token") {
        refreshCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            access_token: "oauth-new",
            refresh_token: "refresh-new",
            expires_in: 3600,
          }),
        );
        return;
      }
      authorizations.push(request.headers.authorization);
      await readRequestBody(request);
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
    cleanups.push(upstream.close);
    const fixture = await createFixture({
      upstreamUrl: upstream.url,
      source: "import",
      options: {
        importCredentials: async () =>
          importedCredentials({ expiresAt: Date.now() + 1_000 }),
        refreshUrl: `${upstream.url}/oauth/token`,
      },
    });
    const requests = [1, 2].map(() =>
      fixture.host.harness.behavior.fetchHttp("POST", "/v1/messages", {
        headers: authHeaders(fixture.key),
        body: "{}",
      }),
    );
    const responses = await Promise.all(requests);
    await Promise.all(responses.map((response) => response.text()));
    expect(refreshCalls).toBe(1);
    expect(authorizations).toEqual(["Bearer oauth-new", "Bearer oauth-new"]);
    const secretPath = path.join(
      fixture.dataDir,
      "plugins",
      "account-pool",
      "secrets",
      "accounts",
      `account-${fixture.account.id}.json`,
    );
    const secret = accountSecretSchema.parse(
      JSON.parse(await fs.readFile(secretPath, "utf8")),
    );
    expect(secret).toMatchObject({
      kind: "oauth",
      accessToken: "oauth-new",
      refreshToken: "refresh-new",
    });
    expect((await fs.stat(secretPath)).mode & 0o777).toBe(0o600);
  });

  it("marks refresh and upstream authorization failures as account errors", async () => {
    const upstream = await startUpstream((request, response) => {
      if (request.url === "/oauth/token") {
        response.writeHead(401, { "content-type": "application/json" });
        response.end("{}");
        return;
      }
      response.writeHead(401, { "content-type": "application/json" });
      response.end('{"error":{"message":"bad account"}}');
    });
    cleanups.push(upstream.close);
    const refreshFixture = await createFixture({
      upstreamUrl: upstream.url,
      source: "import",
      options: {
        importCredentials: async () =>
          importedCredentials({ expiresAt: Date.now() + 1_000 }),
        refreshUrl: `${upstream.url}/oauth/token`,
      },
    });
    const refreshResponse =
      await refreshFixture.host.harness.behavior.fetchHttp(
        "POST",
        "/v1/messages",
        { headers: authHeaders(refreshFixture.key), body: "{}" },
      );
    expect(refreshResponse.status).toBe(429);
    const refreshAccounts = z
      .array(accountSummarySchema)
      .parse(
        await refreshFixture.host.harness.behavior.callRpc(
          "account.list",
          null,
        ),
      );
    expect(refreshAccounts[0]?.status).toBe("error");
    expect(refreshAccounts[0]?.error).toContain("OAuth refresh failed");

    const authFixture = await createFixture({ upstreamUrl: upstream.url });
    const authResponse = await authFixture.host.harness.behavior.fetchHttp(
      "POST",
      "/v1/messages",
      { headers: authHeaders(authFixture.key), body: "{}" },
    );
    expect(authResponse.status).toBe(401);
    await authResponse.text();
    const authAccounts = z
      .array(accountSummarySchema)
      .parse(
        await authFixture.host.harness.behavior.callRpc("account.list", null),
      );
    expect(authAccounts[0]?.status).toBe("error");
    expect(authAccounts[0]?.error).toContain("bad account");
  });

  it("drains completed streams and aborts a stuck stream after the stop deadline", async () => {
    const upstream = await startUpstream((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write("data: started\n\n");
    });
    cleanups.push(upstream.close);
    const fixture = await createFixture({
      upstreamUrl: upstream.url,
      options: { drainTimeoutMs: 40 },
    });
    const response = await fixture.host.harness.behavior.fetchHttp(
      "POST",
      "/v1/messages",
      {
        headers: authHeaders(fixture.key),
        body: "{}",
      },
    );
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error("Expected a streaming body.");
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe("data: started\n\n");
    const startedAt = Date.now();
    fixture.service.controller.abort();
    await fixture.service.done;
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(30);
    const stopped = await reader.read();
    expect(new TextDecoder().decode(stopped.value)).toContain(
      "Account Pool stopped",
    );
    const rejected = await fixture.host.harness.behavior.fetchHttp(
      "POST",
      "/v1/messages",
      { headers: authHeaders(fixture.key), body: "{}" },
    );
    expect(rejected.status).toBe(503);
  });
});
