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
  accountPoolConfigSchema,
  accountPoolConfigSetInputSchema,
  codexLoginPollSchema,
  codexLoginStartSchema,
  statusSchema,
  type AccountSummary,
} from "./contracts.js";
import { z } from "zod";
import type {
  ImportedClaudeCredentials,
  ImportedCodexCredentials,
} from "./credentials.js";
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

async function resolveCodexToken(
  host: ReturnType<typeof createFakePluginHost>,
): Promise<{ token: string; baseUrl: string }> {
  const entries = await host.harness.behavior.resolveProviderEnv("codex", {
    threadId: "thread-codex",
    projectId: "project-one",
    hostId: "host-one",
  });
  const token = entries.find((entry) => entry.name === "CODEX_POOL_AUTH_TOKEN");
  const baseUrl = entries.find(
    (entry) => entry.name === "CODEX_OPENAI_BASE_URL",
  );
  if (token === undefined || typeof token.value !== "string") {
    throw new Error("Codex Account Pool token was not resolved.");
  }
  if (baseUrl === undefined || typeof baseUrl.value !== "object") {
    throw new Error("Codex Account Pool base URL was not resolved.");
  }
  return { token: token.value, baseUrl: baseUrl.value.serverPath };
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
    accountUuid: "11111111-1111-4111-8111-111111111111",
    ...overrides,
  };
}

function testJwt(payload: object): string {
  return [
    Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "signature",
  ].join(".");
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
    sdk: sdkStubs(),
  });
  await host.bb.storage.kv.set("config", {
    anthropicUpstreamBaseUrl: args.upstreamUrl,
  });
  const plugin = createAccountPoolPlugin({
    usageUrl: "data:application/json,{}",
    ...args.options,
  });
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

const completedResponseSchema = z
  .object({
    type: z.literal("response.completed"),
    response: z
      .object({ id: z.string(), output: z.array(z.json()).default([]) })
      .passthrough(),
  })
  .passthrough();

function completedResponse(value: string | Uint8Array | undefined) {
  if (typeof value !== "string")
    throw new Error("Expected a text WebSocket frame.");
  return completedResponseSchema.parse(JSON.parse(value));
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

const EMPTY_USAGE_URL = "data:application/json,{}";
const CODEX_USAGE_STUB_URL = "https://usage.example/wham/usage";

describe("Account Pool config schema", () => {
  it("fills defaults and rejects invalid URLs and thresholds", () => {
    expect(accountPoolConfigSchema.parse({})).toEqual({
      anthropicUpstreamBaseUrl: "https://api.anthropic.com",
      codexUpstreamBaseUrl: "https://chatgpt.com/backend-api/codex",
      switchThreshold: 0.98,
    });
    expect(
      accountPoolConfigSetInputSchema.safeParse({
        anthropicUpstreamBaseUrl: "ftp://example.com",
      }).success,
    ).toBe(false);
    expect(
      accountPoolConfigSetInputSchema.safeParse({ switchThreshold: 0 }).success,
    ).toBe(false);
    expect(
      accountPoolConfigSetInputSchema.safeParse({ switchThreshold: 1.01 })
        .success,
    ).toBe(false);
  });
});

describe("Account Pool plugin", () => {
  it("reads and updates one full config record through RPC and CLI", async () => {
    const dataDir = await mkdtemp(
      path.join(tmpdir(), "bb-account-pool-config-"),
    );
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

    expect(
      accountPoolConfigSchema.parse(
        await host.harness.behavior.callRpc("config.get", null),
      ),
    ).toEqual(accountPoolConfigSchema.parse({}));
    const cliGet = await host.harness.behavior.runCli(["config"]);
    expect(cliGet.exitCode).toBe(0);
    expect(cliGet.stdout).toContain(
      "anthropicUpstreamBaseUrl: https://api.anthropic.com",
    );
    expect(cliGet.stdout).toContain(
      "codexUpstreamBaseUrl: https://chatgpt.com/backend-api/codex",
    );
    expect(cliGet.stdout).toContain("switchThreshold: 0.98");

    const cliSet = await host.harness.behavior.runCli([
      "config",
      "set",
      "switchThreshold",
      "0.75",
    ]);
    expect(cliSet.exitCode).toBe(0);
    expect(cliSet.stdout).toContain("switchThreshold: 0.75");
    const updated = accountPoolConfigSchema.parse(
      await host.harness.behavior.callRpc("config.set", {
        anthropicUpstreamBaseUrl: "http://127.0.0.1:9000",
      }),
    );
    expect(updated).toEqual({
      anthropicUpstreamBaseUrl: "http://127.0.0.1:9000",
      codexUpstreamBaseUrl: "https://chatgpt.com/backend-api/codex",
      switchThreshold: 0.75,
    });
    expect(
      accountPoolConfigSchema.parse(await host.bb.storage.kv.get("config")),
    ).toEqual(updated);
    expect(host.harness.inspection.realtimeSignals).toContainEqual({
      channel: "config-changed",
      payload: {},
    });
  });

  it("imports, refreshes, and routes Codex HTTP and WebSocket sessions by provider", async () => {
    const seen: Array<{
      path: string;
      authorization: string | undefined;
      accountId: string | undefined;
      body: string;
    }> = [];
    const modelRequests: string[] = [];
    let responseNumber = 0;
    const futureToken = `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1_000) + 3_600 })).toString("base64url")}.signature`;
    const upstream = await startUpstream(async (request, response) => {
      const body = (await readRequestBody(request)).toString("utf8");
      if (request.url === "/oauth") {
        const parsed = z
          .object({
            client_id: z.literal("app_EMoamEEZ73f0CkXaXp7hrann"),
            grant_type: z.literal("refresh_token"),
            refresh_token: z.string(),
          })
          .parse(JSON.parse(body));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            access_token: futureToken,
            refresh_token: `next-${parsed.refresh_token}`,
            id_token: "next-id-token",
          }),
        );
        return;
      }
      if (request.url === "/usage") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            plan_type: "pro",
            rate_limit: {
              allowed: true,
              limit_reached: false,
              primary_window: {
                used_percent: 48,
                limit_window_seconds: 604_800,
                reset_after_seconds: 180_092,
                reset_at: 4_102_452_000,
              },
              secondary_window: null,
            },
          }),
        );
        return;
      }
      if (request.url === "/models") {
        modelRequests.push(
          request.headers["chatgpt-account-id"]?.toString() ?? "",
        );
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"data":[]}');
        return;
      }
      responseNumber += 1;
      seen.push({
        path: request.url ?? "",
        authorization: request.headers.authorization,
        accountId: z
          .string()
          .optional()
          .parse(request.headers["chatgpt-account-id"]),
        body,
      });
      if (responseNumber === 1) {
        response.writeHead(200, {
          "content-type": "application/json",
          "x-codex-primary-used-percent": "25",
          "x-codex-primary-window-minutes": "300",
          "x-codex-primary-reset-after-seconds": "3600",
          "x-codex-secondary-used-percent": "40",
          "x-codex-secondary-window-minutes": "10080",
          "x-codex-secondary-reset-after-seconds": "86400",
        });
        response.end('{"id":"http-response"}');
        return;
      }
      if (responseNumber === 2) {
        response.writeHead(429, {
          "content-type": "application/json",
          "x-codex-primary-used-percent": "100",
        });
        response.end('{"error":{"message":"quota exhausted"}}');
        return;
      }
      const id = `response-${responseNumber}`;
      response.writeHead(200, {
        "content-type": "text/event-stream",
      });
      response.end(
        `event: response.created\ndata: ${JSON.stringify({
          type: "response.created",
          response: { id },
        })}\n\nevent: response.completed\ndata: ${JSON.stringify({
          type: "response.completed",
          response: {
            id,
            output: [{ type: "message", id: `message-${responseNumber}` }],
          },
        })}\n\ndata: [DONE]\n\n`,
      );
    });
    cleanups.push(upstream.close);
    const dataDir = await mkdtemp(
      path.join(tmpdir(), "bb-account-pool-codex-"),
    );
    let imported = 0;
    const importCodexCredentials =
      async (): Promise<ImportedCodexCredentials> => {
        imported += 1;
        return {
          accessToken: "expired-token",
          refreshToken: `refresh-${imported}`,
          idToken: "id-token",
          accountId: `chatgpt-account-${imported}`,
          email: `codex-${imported}@example.com`,
          expiresAt: Date.now() - 1,
        };
      };
    const host = createFakePluginHost({
      pluginId: "account-pool",
      dataDir,
      sdk: sdkStubs(),
    });
    await host.bb.storage.kv.set("config", {
      anthropicUpstreamBaseUrl: upstream.url,
      codexUpstreamBaseUrl: upstream.url,
    });
    await createAccountPoolPlugin({
      codexRefreshUrl: `${upstream.url}/oauth`,
      codexUsageUrl: `${upstream.url}/usage`,
      importCodexCredentials,
      usageUrl: "data:application/json,{}",
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
    await host.harness.behavior.callRpc("account.add", {
      provider: "claude",
      source: { kind: "api-key", apiKey: "claude-key" },
      label: "Claude first",
      priority: 0,
    });
    const importedByCli = await host.harness.behavior.runCli([
      "account",
      "add",
      "--provider",
      "codex",
      "--import",
    ]);
    expect(importedByCli.exitCode).toBe(0);
    await host.harness.behavior.callRpc("account.add", {
      provider: "codex",
      source: { kind: "import" },
      label: null,
      priority: 100,
    });
    const accountTable = await host.harness.behavior.runCli([
      "account",
      "list",
    ]);
    expect(accountTable.stdout).toContain("Provider");
    expect(accountTable.stdout).toContain("codex");
    expect(accountTable.stdout).toContain("7d=48% 2100-01-01T02:00:00.000Z");
    expect(accountTable.stdout).not.toContain("5h=");
    const routed = await resolveCodexToken(host);
    expect(routed.baseUrl).toBe("/api/v1/plugins/account-pool/http/v1");
    await expect(
      host.harness.behavior.resolveProviderEnvHealth("codex", {
        hostId: "host-one",
      }),
    ).resolves.toEqual({
      label: "Proxied",
      statusMessage: "Credentials are provided by the Account Pooler hub.",
    });
    const httpResponse = await host.harness.behavior.fetchHttp(
      "POST",
      "/v1/responses",
      {
        headers: {
          authorization: "Bearer local-codex-token",
          "x-bb-account-pool-token": routed.token,
          "content-type": "application/json",
          "openai-beta": "responses=experimental",
        },
        body: JSON.stringify({ model: "gpt-5", input: [] }),
      },
    );
    expect(httpResponse.status).toBe(200);
    expect(await httpResponse.json()).toEqual({ id: "http-response" });
    const modelsResponse = await host.harness.behavior.fetchHttp(
      "GET",
      "/v1/models",
      {
        headers: { "x-bb-account-pool-token": routed.token },
      },
    );
    expect(await modelsResponse.json()).toEqual({ data: [] });
    expect(modelRequests).toHaveLength(1);
    expect(modelRequests[0]).toMatch(/^chatgpt-account-[12]$/u);
    expect(seen[0]).toMatchObject({
      path: "/responses",
      authorization: `Bearer ${futureToken}`,
      accountId: "chatgpt-account-1",
    });
    const socket = await host.harness.experimental_openWebSocket(
      "/v1/responses",
      {
        headers: {
          "x-bb-account-pool-token": routed.token,
          "openai-beta": "responses_websockets",
        },
      },
    );
    await socket.receive(
      JSON.stringify({
        type: "response.create",
        generate: false,
        input: [{ type: "message", id: "prefix" }],
      }),
    );
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
    const prewarm = completedResponse(socket.sent[0]);
    await socket.receive(
      JSON.stringify({
        type: "response.create",
        previous_response_id: prewarm.response.id,
        model: "gpt-5",
        input: [{ type: "message", id: "delta-one" }],
      }),
    );
    await vi.waitFor(() => expect(socket.sent).toHaveLength(3));
    expect(JSON.parse(String(socket.sent[1]))).toMatchObject({
      type: "response.created",
    });
    const first = completedResponse(socket.sent[2]);
    await socket.receive(
      JSON.stringify({
        type: "response.create",
        previous_response_id: first.response.id,
        model: "gpt-5",
        input: [{ type: "message", id: "delta-two" }],
      }),
    );
    await vi.waitFor(() => expect(socket.sent).toHaveLength(5));
    expect(socket.sent.map((frame) => JSON.parse(String(frame)).type)).toEqual([
      "response.completed",
      "response.created",
      "response.completed",
      "response.created",
      "response.completed",
    ]);
    expect(seen[1]?.accountId).not.toBe(seen[2]?.accountId);
    expect(seen[2]?.accountId).toBe(seen[3]?.accountId);
    expect(JSON.parse(seen[3]?.body ?? "{}").input).toEqual([
      { type: "message", id: "prefix" },
      { type: "message", id: "delta-one" },
      { type: "message", id: "message-3" },
      { type: "message", id: "delta-two" },
    ]);
    await socket.close(1000, "done");
    const status = statusSchema.parse(
      await host.harness.behavior.callRpc("status.get", null),
    );
    const firstCodex = status.accounts.find(
      (account) => account.codexAccountId === "chatgpt-account-1",
    );
    expect(seen[1]?.accountId).toBe("chatgpt-account-1");
    expect(firstCodex).toMatchObject({
      provider: "codex",
      status: "exhausted",
      fiveHourUtilization: null,
      sevenDayUtilization: null,
      familyWeekly: { other: null },
      limitWindows: [
        {
          slot: "primary",
          windowMinutes: 300,
          utilization: 1,
          status: "rejected",
          source: "header",
        },
        {
          slot: "secondary",
          windowMinutes: 10_080,
          utilization: 0.4,
          status: null,
          source: "header",
        },
      ],
    });
    expect(
      status.accounts.find(
        (account) => account.codexAccountId === seen[2]?.accountId,
      ),
    ).toMatchObject({
      provider: "codex",
      status: "ready",
      limitWindows: [
        {
          slot: "primary",
          windowMinutes: 10_080,
          utilization: 0.48,
          status: "allowed",
          source: "usage",
        },
      ],
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
            `account-${firstCodex?.id}.json`,
          ),
          "utf8",
        ),
      ),
    );
    expect(secret).toMatchObject({
      accessToken: futureToken,
      refreshToken: "next-refresh-1",
      idToken: "next-id-token",
    });
  });

  it("fails an unknown Codex WebSocket response id and closes with 1011", async () => {
    const dataDir = await mkdtemp(
      path.join(tmpdir(), "bb-account-pool-codex-unknown-"),
    );
    const host = createFakePluginHost({
      pluginId: "account-pool",
      dataDir,
      sdk: sdkStubs(),
    });
    await createAccountPoolPlugin({
      codexUsageUrl: EMPTY_USAGE_URL,
      importCodexCredentials: async () => ({
        accessToken: "access",
        refreshToken: "refresh",
        idToken: null,
        accountId: "account",
        email: null,
        expiresAt: null,
      }),
    })(host.bb);
    const service = host.harness.behavior.runService("hub");
    cleanups.push(async () => {
      service.controller.abort();
      await service.done;
      await host.harness.lifecycle.dispose();
      await fs.rm(dataDir, { recursive: true, force: true });
    });
    await host.harness.behavior.callRpc("account.add", {
      provider: "codex",
      source: { kind: "import" },
      label: null,
      priority: 100,
    });
    const { token } = await resolveCodexToken(host);
    const rejected = await host.harness.experimental_openWebSocket(
      "/v1/responses",
      { headers: { "x-bb-account-pool-token": "invalid" } },
    );
    expect(rejected.closeCalls).toEqual([
      {
        code: 1008,
        reason: "invalid Account Pooler token",
      },
    ]);
    const socket = await host.harness.experimental_openWebSocket(
      "/v1/responses",
      {
        headers: { "x-bb-account-pool-token": token },
      },
    );
    await socket.receive(
      JSON.stringify({
        type: "response.create",
        previous_response_id: "missing",
        input: [],
      }),
    );
    await vi.waitFor(() => expect(socket.closeCalls).toHaveLength(1));
    expect(JSON.parse(String(socket.sent[0]))).toMatchObject({
      type: "response.failed",
      response: { error: { code: "unknown_previous_response_id" } },
    });
    expect(socket.closeCalls).toEqual([
      { code: 1011, reason: "unknown previous_response_id" },
    ]);
  });

  it("cancels a Codex upstream read when its WebSocket closes", async () => {
    const dataDir = await mkdtemp(
      path.join(tmpdir(), "bb-account-pool-codex-cancel-"),
    );
    let upstreamReadCanceled = false;
    const upstreamFetch = async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      if (String(input) === CODEX_USAGE_STUB_URL) return Response.json({});
      const signal = init?.signal;
      if (signal === undefined || signal === null) {
        throw new Error("Expected the upstream request to carry a signal.");
      }
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'event: response.created\ndata: {"type":"response.created","response":{"id":"streaming"}}\n\n',
            ),
          );
          signal.addEventListener(
            "abort",
            () => {
              upstreamReadCanceled = true;
              controller.error(signal.reason);
            },
            { once: true },
          );
        },
      });
      return new Response(body, {
        headers: { "content-type": "text/event-stream" },
      });
    };
    const host = createFakePluginHost({
      pluginId: "account-pool",
      dataDir,
      sdk: sdkStubs(),
    });
    await host.bb.storage.kv.set("config", {
      codexUpstreamBaseUrl: "https://example.com",
    });
    await createAccountPoolPlugin({
      fetch: upstreamFetch,
      codexUsageUrl: CODEX_USAGE_STUB_URL,
      importCodexCredentials: async () => ({
        accessToken: "access",
        refreshToken: "refresh",
        idToken: null,
        accountId: "account",
        email: null,
        expiresAt: null,
      }),
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
    await host.harness.behavior.callRpc("account.add", {
      provider: "codex",
      source: { kind: "import" },
      label: null,
      priority: 100,
    });
    const { token } = await resolveCodexToken(host);
    const socket = await host.harness.experimental_openWebSocket(
      "/v1/responses",
      { headers: { "x-bb-account-pool-token": token } },
    );
    await socket.receive(
      JSON.stringify({
        type: "response.create",
        model: "gpt-5",
        input: [],
      }),
    );
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
    await socket.close(1000, "interrupted");
    await vi.waitFor(async () => {
      expect(upstreamReadCanceled).toBe(true);
      expect(
        statusSchema.parse(
          await host.harness.behavior.callRpc("status.get", null),
        ).inFlight,
      ).toBe(0);
    });
    expect(socket.sent).toHaveLength(1);
  });

  it("releases a Codex request when an upstream SSE event is malformed", async () => {
    const dataDir = await mkdtemp(
      path.join(tmpdir(), "bb-account-pool-codex-malformed-"),
    );
    let upstreamReadCanceled = false;
    const upstreamFetch = async (
      input: string | URL | Request,
    ): Promise<Response> => {
      if (String(input) === CODEX_USAGE_STUB_URL) return Response.json({});
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: {\n\n"));
        },
        cancel() {
          upstreamReadCanceled = true;
        },
      });
      return new Response(body, {
        headers: { "content-type": "text/event-stream" },
      });
    };
    const host = createFakePluginHost({
      pluginId: "account-pool",
      dataDir,
      sdk: sdkStubs(),
    });
    await host.bb.storage.kv.set("config", {
      codexUpstreamBaseUrl: "https://example.com",
    });
    await createAccountPoolPlugin({
      fetch: upstreamFetch,
      codexUsageUrl: CODEX_USAGE_STUB_URL,
      importCodexCredentials: async () => ({
        accessToken: "access",
        refreshToken: "refresh",
        idToken: null,
        accountId: "account",
        email: null,
        expiresAt: null,
      }),
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
    await host.harness.behavior.callRpc("account.add", {
      provider: "codex",
      source: { kind: "import" },
      label: null,
      priority: 100,
    });
    const { token } = await resolveCodexToken(host);
    const socket = await host.harness.experimental_openWebSocket(
      "/v1/responses",
      { headers: { "x-bb-account-pool-token": token } },
    );
    await socket.receive(
      JSON.stringify({
        type: "response.create",
        model: "gpt-5",
        input: [],
      }),
    );
    await vi.waitFor(async () => {
      expect(JSON.parse(String(socket.sent[0]))).toMatchObject({
        type: "response.failed",
        response: { error: { code: "proxy_error" } },
      });
      expect(upstreamReadCanceled).toBe(true);
      const statusResult = await host.harness.behavior.runCli([
        "status",
        "--json",
      ]);
      expect(statusResult.exitCode).toBe(0);
      expect(statusSchema.parse(JSON.parse(statusResult.stdout)).inFlight).toBe(
        0,
      );
    });
  });

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
      await host.harness.behavior.callRpc("status.get", null),
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
      sdk: sdkStubs(),
    });
    await host.bb.storage.kv.set("config", {
      anthropicUpstreamBaseUrl: upstream.url,
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
      "Add and enable a Claude or Codex account with `bb pool account add`.",
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
              uuid: "22222222-2222-4222-8222-222222222222",
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
      usageUrl: "data:application/json,{}",
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

  it("exposes Codex device login over RPC and the two-step CLI", async () => {
    let holdTokenPoll = false;
    let markTokenPollStarted: () => void = () => {};
    const tokenPollStarted = new Promise<void>((resolve) => {
      markTokenPollStarted = resolve;
    });
    let releaseTokenPoll: () => void = () => {};
    const tokenPollRelease = new Promise<void>((resolve) => {
      releaseTokenPoll = resolve;
    });
    const auth = await startUpstream(async (request, response) => {
      await readRequestBody(request);
      response.setHeader("content-type", "application/json");
      if (request.url === "/api/accounts/deviceauth/usercode") {
        response.end(
          JSON.stringify({
            device_auth_id: "device-secret",
            user_code: "ABCD-1234",
            interval: "1",
            expires_in: 600,
          }),
        );
        return;
      }
      if (request.url === "/api/accounts/deviceauth/token") {
        if (holdTokenPoll) {
          markTokenPollStarted();
          await tokenPollRelease;
        }
        response.end(
          JSON.stringify({
            authorization_code: "authorization-secret",
            code_challenge: "challenge-secret",
            code_verifier: "verifier-secret",
          }),
        );
        return;
      }
      if (request.url === "/oauth/token") {
        response.end(
          JSON.stringify({
            access_token: testJwt({ exp: 2_000_000_000 }),
            refresh_token: "refresh-secret",
            id_token: testJwt({
              email: "codex@example.com",
              "https://api.openai.com/auth": {
                chatgpt_account_id: "chatgpt-account-1",
              },
            }),
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end("{}");
    });
    cleanups.push(auth.close);
    const dataDir = await mkdtemp(path.join(tmpdir(), "bb-pool-codex-login-"));
    const host = createFakePluginHost({
      pluginId: "account-pool",
      dataDir,
      sdk: sdkStubs(),
    });
    await createAccountPoolPlugin({
      codexAuthBaseUrl: auth.url,
      codexUsageUrl: EMPTY_USAGE_URL,
      usageUrl: "data:application/json,{}",
    })(host.bb);
    cleanups.push(async () => {
      await host.harness.lifecycle.dispose();
      await fs.rm(dataDir, { recursive: true, force: true });
    });

    const started = codexLoginStartSchema.parse(
      await host.harness.behavior.callRpc("codexLogin.start", null),
    );
    expect(started).toMatchObject({
      verificationUri: `${auth.url}/codex/device`,
      userCode: "ABCD-1234",
      intervalMs: 1_000,
    });
    expect(
      codexLoginPollSchema.parse(
        await host.harness.behavior.callRpc("codexLogin.poll", {
          sessionId: started.sessionId,
        }),
      ),
    ).toEqual({ status: "pending" });
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const completed = codexLoginPollSchema.parse(
      await host.harness.behavior.callRpc("codexLogin.poll", {
        sessionId: started.sessionId,
      }),
    );
    expect(completed).toMatchObject({
      status: "complete",
      account: {
        provider: "codex",
        codexAccountId: "chatgpt-account-1",
        email: "codex@example.com",
      },
    });

    const cliStarted = await host.harness.behavior.runCli([
      "account",
      "add",
      "--provider",
      "codex",
      "--login",
    ]);
    expect(cliStarted).toMatchObject({
      exitCode: 0,
      stdout: expect.stringContaining("Open this URL to sign in to Codex:"),
    });
    expect(cliStarted.stdout).toContain("Enter this code: ABCD-1234");
    expect(cliStarted.stdout).toContain("account login-poll --session");
    const sessionId = cliStarted.stdout.match(/Session ID: ([0-9a-f-]+)/u)?.[1];
    if (sessionId === undefined) {
      throw new Error("Codex CLI login start omitted its session ID.");
    }
    const cliCompleted = await host.harness.behavior.runCli([
      "account",
      "login-poll",
      "--session",
      sessionId,
    ]);
    expect(cliCompleted).toMatchObject({
      exitCode: 0,
      stdout: expect.stringContaining("Added codex@example.com"),
    });
    const cancelledStart = await host.harness.behavior.runCli([
      "account",
      "add",
      "--provider",
      "codex",
      "--login",
    ]);
    const cancelledSessionId = cancelledStart.stdout.match(
      /Session ID: ([0-9a-f-]+)/u,
    )?.[1];
    if (cancelledSessionId === undefined) {
      throw new Error("Codex CLI login start omitted its session ID.");
    }
    holdTokenPoll = true;
    const controller = new AbortController();
    const cancelledPoll = host.harness.behavior.runCli(
      ["account", "login-poll", "--session", cancelledSessionId],
      { signal: controller.signal },
    );
    await tokenPollStarted;
    controller.abort(new Error("cancelled by test"));
    expect(
      codexLoginPollSchema.parse(
        await host.harness.behavior.callRpc("codexLogin.poll", {
          sessionId: cancelledSessionId,
        }),
      ),
    ).toEqual({
      status: "error",
      message: "Login session was not found. Start again.",
    });
    releaseTokenPoll();
    expect(await cancelledPoll).toMatchObject({ exitCode: 1 });
    expect(host.harness.inspection.logEntries.join("\n")).not.toMatch(
      /device-secret|ABCD-1234|authorization-secret|verifier-secret|refresh-secret/u,
    );
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
        reason: "Routed through the Account Pooler hub",
        secret: false,
      },
      {
        name: "ANTHROPIC_AUTH_TOKEN",
        value: fixture.key,
        reason: "Account Pooler hub token for this machine",
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
      statusMessage: "Credentials are provided by the Account Pooler hub.",
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
      await fixture.host.harness.behavior.callRpc("status.get", null),
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
      await fixture.host.harness.behavior.callRpc("status.get", null),
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
        "Account Pooler disabled with 1 recently routed thread on machines without a local Claude login. Run bb pool status before disabling to inspect them.",
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
        "Account Pooler disable inspection skipped: plugin list unavailable",
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
      message: "Account Pooler disable inspection timed out.",
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
      await fixture.host.harness.behavior.callRpc("status.get", null),
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
    const body = Buffer.from('{"model":"claude-fable-5","stream":true}');
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
      familyWeekly: {
        fable: {
          utilization: null,
          resetAt: 4_102_452_000_000,
          status: "rejected",
          observedAt: expect.any(Number),
          source: "header",
        },
      },
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

  it("applies config threshold changes live and rotates quota rejections", async () => {
    const keys: string[] = [];
    let requestNumber = 0;
    const upstream = await startUpstream((request, response) => {
      requestNumber += 1;
      keys.push(request.headers["x-api-key"]?.toString() ?? "");
      if (requestNumber === 1) {
        response.writeHead(200, {
          "content-type": "application/json",
          "anthropic-ratelimit-unified-5h-utilization": "0.75",
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
    expect(
      accountPoolConfigSchema.parse(
        await fixture.host.harness.behavior.callRpc("config.set", {
          switchThreshold: 0.7,
        }),
      ).switchThreshold,
    ).toBe(0.7);
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

  it("routes around a Fable-spent account while retaining it for Opus", async () => {
    const keys: string[] = [];
    const upstream = await startUpstream(async (request, response) => {
      keys.push(request.headers["x-api-key"]?.toString() ?? "");
      await readRequestBody(request);
      if (keys.length === 1) {
        response.writeHead(200, {
          "content-type": "application/json",
          "anthropic-ratelimit-unified-5h-status": "allowed",
          "anthropic-ratelimit-unified-7d-status": "allowed",
          "anthropic-ratelimit-unified-7d_oi-utilization": "0.99",
          "anthropic-ratelimit-unified-7d_oi-reset": "4102452000",
          "anthropic-ratelimit-unified-7d_oi-status": "allowed",
        });
      } else {
        response.writeHead(200, { "content-type": "application/json" });
      }
      response.end("{}");
    });
    cleanups.push(upstream.close);
    const fixture = await createFixture({
      upstreamUrl: upstream.url,
      apiKey: "sk-one",
    });
    await addApiAccount(fixture, "sk-two");

    for (const model of [
      "claude-fable-5",
      "claude-fable-5",
      "claude-opus-4-1",
    ]) {
      const response = await fixture.host.harness.behavior.fetchHttp(
        "POST",
        "/v1/messages",
        {
          headers: authHeaders(fixture.key),
          body: JSON.stringify({ model }),
        },
      );
      expect(response.status).toBe(200);
      await response.text();
    }

    expect(keys).toEqual(["sk-one", "sk-two", "sk-one"]);
  });

  it("rotates a family-only 429 without exhausting other families", async () => {
    const keys: string[] = [];
    const upstream = await startUpstream(async (request, response) => {
      keys.push(request.headers["x-api-key"]?.toString() ?? "");
      await readRequestBody(request);
      if (keys.length === 1) {
        response.writeHead(429, {
          "content-type": "application/json",
          "anthropic-ratelimit-unified-5h-status": "allowed",
          "anthropic-ratelimit-unified-7d-status": "allowed",
          "anthropic-ratelimit-unified-7d_oi-reset": "4102452000",
          "anthropic-ratelimit-unified-7d_oi-status": "rejected",
        });
        response.end('{"rejected":true}');
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
    cleanups.push(upstream.close);
    const fixture = await createFixture({
      upstreamUrl: upstream.url,
      apiKey: "sk-one",
    });
    await addApiAccount(fixture, "sk-two");

    const fable = await fixture.host.harness.behavior.fetchHttp(
      "POST",
      "/v1/messages",
      {
        headers: authHeaders(fixture.key),
        body: JSON.stringify({ model: "claude-fable-5" }),
      },
    );
    expect(fable.status).toBe(200);
    await fable.text();
    const opus = await fixture.host.harness.behavior.fetchHttp(
      "POST",
      "/v1/messages",
      {
        headers: authHeaders(fixture.key),
        body: JSON.stringify({ model: "claude-opus-4-1" }),
      },
    );
    expect(opus.status).toBe(200);
    await opus.text();

    expect(keys).toEqual(["sk-one", "sk-two", "sk-one"]);
    const accounts = z
      .array(accountSummarySchema)
      .parse(await fixture.host.harness.behavior.callRpc("account.list", null));
    expect(accounts[0]).toMatchObject({
      status: "ready",
      familyWeekly: {
        fable: { status: "rejected", source: "header" },
      },
    });
  });

  it("refreshes usage on import and routes from its family observations", async () => {
    const authorizations: Array<string | undefined> = [];
    const usageCalls = new Map<string, number>();
    const upstream = await startUpstream(async (request, response) => {
      if (request.url === "/usage") {
        const authorization = request.headers.authorization;
        usageCalls.set(
          authorization ?? "",
          (usageCalls.get(authorization ?? "") ?? 0) + 1,
        );
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            five_hour: { utilization: 10, resets_at: "4102444800" },
            seven_day: { utilization: 20, resets_at: "4102448400" },
            limits: [
              {
                kind: "weekly_scoped",
                group: "weekly",
                percent: authorization === "Bearer oauth-a" ? 100 : 0,
                resets_at: "4102452000",
                scope: { model: { display_name: "Fable" } },
              },
            ],
          }),
        );
        return;
      }
      if (request.url === "/profile") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            account: { uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
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
    const imports = [
      importedCredentials({
        accessToken: "oauth-a",
        accountUuid: null,
      }),
      importedCredentials({
        accessToken: "oauth-b",
        accountUuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }),
    ];
    let importIndex = 0;
    const fixture = await createFixture({
      upstreamUrl: upstream.url,
      source: "import",
      options: {
        usageUrl: `${upstream.url}/usage`,
        oauthProfileUrl: `${upstream.url}/profile`,
        importCredentials: async () => {
          const imported = imports[importIndex];
          importIndex += 1;
          if (imported === undefined) throw new Error("No import fixture.");
          return imported;
        },
      },
    });
    const second = accountSchema.parse(
      await fixture.host.harness.behavior.callRpc("account.add", {
        provider: "claude",
        source: { kind: "import" },
        label: "second",
        priority: 100,
      }),
    );
    expect(usageCalls).toEqual(
      new Map([
        ["Bearer oauth-a", 1],
        ["Bearer oauth-b", 1],
      ]),
    );
    await fixture.host.harness.behavior.callRpc("account.disable", {
      id: second.id,
    });
    await fixture.host.harness.behavior.callRpc("account.enable", {
      id: second.id,
    });
    expect(usageCalls.get("Bearer oauth-a")).toBe(1);
    expect(usageCalls.get("Bearer oauth-b")).toBe(2);
    const listed = await fixture.host.harness.behavior.runCli([
      "account",
      "list",
    ]);
    expect(listed.stdout).toContain("Fable");
    expect(listed.stdout).toContain("100% rejected");
    expect(listed.stdout).toContain("0% allowed");
    const accounts = z
      .array(accountSummarySchema)
      .parse(await fixture.host.harness.behavior.callRpc("account.list", null));
    expect(accounts[0]?.accountUuid).toBe(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );

    for (const model of ["claude-fable-5", "claude-opus-4-1"]) {
      const response = await fixture.host.harness.behavior.fetchHttp(
        "POST",
        "/v1/messages",
        {
          headers: authHeaders(fixture.key),
          body: JSON.stringify({ model }),
        },
      );
      expect(response.status).toBe(200);
      await response.text();
    }

    expect(authorizations).toEqual(["Bearer oauth-b", "Bearer oauth-a"]);
  });

  it("rewrites both known metadata account UUID formats", async () => {
    const bodies: Buffer[] = [];
    const upstream = await startUpstream(async (request, response) => {
      bodies.push(await readRequestBody(request));
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
    cleanups.push(upstream.close);
    const accountUuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const oldUuid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const fixture = await createFixture({
      upstreamUrl: upstream.url,
      source: "import",
      options: {
        importCredentials: async () => importedCredentials({ accountUuid }),
      },
    });
    const inputs = [
      JSON.stringify({
        model: "claude-fable-5",
        metadata: {
          user_id: JSON.stringify({
            device_id: "device",
            account_uuid: oldUuid,
          }),
        },
      }),
      JSON.stringify({
        model: "claude-fable-5",
        metadata: {
          user_id: `user_hash_account_${oldUuid}_session_cccccccc-cccc-4ccc-8ccc-cccccccccccc`,
        },
      }),
    ];
    for (const body of inputs) {
      const response = await fixture.host.harness.behavior.fetchHttp(
        "POST",
        "/v1/messages",
        { headers: authHeaders(fixture.key), body },
      );
      await response.text();
    }
    expect(bodies).toHaveLength(2);
    expect(bodies.every((body) => body.toString().includes(accountUuid))).toBe(
      true,
    );
    expect(bodies.every((body) => !body.toString().includes(oldUuid))).toBe(
      true,
    );
  });

  it("preserves request bytes when an account UUID rewrite cannot apply", async () => {
    const bodies: Buffer[] = [];
    const upstream = await startUpstream(async (request, response) => {
      bodies.push(await readRequestBody(request));
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
    cleanups.push(upstream.close);
    const fixture = await createFixture({ upstreamUrl: upstream.url });
    const inputs = [
      JSON.stringify({
        model: "claude-fable-5",
        metadata: {
          user_id: JSON.stringify({
            account_uuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          }),
        },
      }),
      '{ "model": "claude-fable-5", "messages": [] }',
      "not-json-at-all",
    ];
    for (const body of inputs) {
      const response = await fixture.host.harness.behavior.fetchHttp(
        "POST",
        "/v1/messages",
        { headers: authHeaders(fixture.key), body },
      );
      await response.text();
    }
    expect(bodies.map((body) => body.toString())).toEqual(inputs);
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

  it("suppresses env and health only for the provider whose routing is off", async () => {
    const upstream = await startUpstream((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
    cleanups.push(upstream.close);
    const fixture = await createFixture({
      upstreamUrl: upstream.url,
      options: {
        codexUsageUrl: EMPTY_USAGE_URL,
        importCodexCredentials: async () => ({
          accessToken: "codex-access",
          refreshToken: "codex-refresh",
          idToken: "codex-id",
          accountId: "chatgpt-account",
          email: "codex@example.com",
          expiresAt: Date.now() + 60_000,
        }),
      },
    });
    await fixture.host.harness.behavior.callRpc("account.add", {
      provider: "codex",
      source: { kind: "import" },
      label: null,
      priority: 100,
    });
    const disabled = await fixture.host.harness.behavior.runCli([
      "routing",
      "claude",
      "--off",
    ]);
    expect(disabled).toMatchObject({ exitCode: 0 });
    await expect(
      fixture.host.harness.behavior.resolveProviderEnv("claude-code", {
        threadId: "thread-off",
        projectId: "project-one",
        hostId: "host-one",
      }),
    ).resolves.toEqual([]);
    await expect(
      fixture.host.harness.behavior.resolveProviderEnvHealth("claude-code", {
        hostId: "host-one",
      }),
    ).resolves.toBeNull();
    await expect(resolveCodexToken(fixture.host)).resolves.toMatchObject({
      baseUrl: "/api/v1/plugins/account-pool/http/v1",
    });
    const result = statusSchema.parse(
      await fixture.host.harness.behavior.callRpc("status.get", null),
    );
    expect(result.routing).toEqual({ claude: false, codex: true });
  });

  it("records the selected account's last-use time and host", async () => {
    const upstream = await startUpstream((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
    cleanups.push(upstream.close);
    let now = 1_800_000_000_000;
    const fixture = await createFixture({
      upstreamUrl: upstream.url,
      options: { now: () => now },
    });
    const changedCount = () =>
      fixture.host.harness.inspection.realtimeSignals.filter(
        (signal) => signal.channel === "accounts-changed",
      ).length;
    const baseline = changedCount();
    const forward = async (key: string) => {
      const response = await fixture.host.harness.behavior.fetchHttp(
        "POST",
        "/v1/messages",
        { headers: authHeaders(key), body: "{}" },
      );
      await response.text();
    };
    await forward(fixture.key);
    expect(changedCount()).toBe(baseline + 1);
    now += 1_000;
    await forward(fixture.key);
    expect(changedCount()).toBe(baseline + 1);
    const secondHostKey = await resolveToken(
      fixture.host,
      "host-two",
      "thread-two",
    );
    await forward(secondHostKey);
    expect(changedCount()).toBe(baseline + 2);
    const result = statusSchema.parse(
      await fixture.host.harness.behavior.callRpc("status.get", null),
    );
    expect(result.accounts[0]).toMatchObject({
      lastUsedAt: now,
      lastUsedHostId: "host-two",
      lastUsedHostName: "Two",
    });
  });

  it("sets priority, refreshes one account, and returns status over RPC", async () => {
    const upstream = await startUpstream((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
    cleanups.push(upstream.close);
    const fixture = await createFixture({ upstreamUrl: upstream.url });
    const priority = z.object({ account: accountSchema.nullable() }).parse(
      await fixture.host.harness.behavior.callRpc("account.setPriority", {
        accountId: fixture.account.id,
        priority: 42,
      }),
    );
    expect(priority.account?.priority).toBe(42);
    const refreshed = z
      .object({ account: accountSummarySchema.nullable() })
      .parse(
        await fixture.host.harness.behavior.callRpc("account.refreshUsage", {
          accountId: fixture.account.id,
        }),
      );
    expect(refreshed.account?.id).toBe(fixture.account.id);
    expect(
      statusSchema.parse(
        await fixture.host.harness.behavior.callRpc("status.get", null),
      ).accounts[0]?.priority,
    ).toBe(42);
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
      "Account Pooler stopped",
    );
    const rejected = await fixture.host.harness.behavior.fetchHttp(
      "POST",
      "/v1/messages",
      { headers: authHeaders(fixture.key), body: "{}" },
    );
    expect(rejected.status).toBe(503);
  });
});
