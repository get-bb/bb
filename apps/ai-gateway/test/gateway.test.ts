import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  aiGlobalUsageDay,
  aiRequestLog,
  aiUsageDay,
  schema,
  server,
  sha256Hex,
  user,
} from "@bb/connect-db";
import {
  connectDbMigrationFiles,
  readConnectDbMigration,
} from "@bb/connect-db/testing";
import type { GatewayConfig } from "../src/config.js";
import {
  COMPLETE_PATH,
  MAX_PROMPT_BYTES,
  USAGE_PATH,
  type GatewayDeps,
  routeGatewayRequest,
} from "../src/gateway.js";
import { RESERVE_MICROS, pruneAiUsage, utcDay } from "../src/metering.js";

const MODELS = [
  "nvidia/nemotron-3.5-lightning",
  "inception/mercury-2.5",
  "openai/gpt-oss-20b",
];
const NOON = Date.UTC(2026, 8, 22, 12);

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;
let clock: number;

interface UpstreamCall {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
  signal: AbortSignal | null;
}

type UpstreamHandler = (call: UpstreamCall) => Promise<Response> | Response;

function okCompletion(costCredits: number, text = "Fix the login flow") {
  return Response.json({
    id: "gen-1",
    model: MODELS[0],
    choices: [{ message: { role: "assistant", content: text } }],
    usage: { prompt_tokens: 120, completion_tokens: 6, cost: costCredits },
  });
}

function harness(
  over: {
    config?: Partial<GatewayConfig>;
    upstream?: UpstreamHandler;
    allow?: () => boolean;
    upstreamTimeoutMs?: number;
  } = {},
) {
  const calls: UpstreamCall[] = [];
  const upstream = over.upstream ?? (() => okCompletion(0.00085));
  const deps: GatewayDeps = {
    db,
    config: {
      dailyBudgetMicros: 2_000_000,
      globalDailyBudgetMicros: 50_000_000,
      models: MODELS,
      upstreamBaseUrl: "https://openrouter.test/api/v1",
      apiKey: "sk-or-test",
      ...over.config,
    },
    rateLimiter: {
      limit: async () => ({ success: over.allow ? over.allow() : true }),
    },
    fetch: async (url, init) => {
      const bodyText = typeof init.body === "string" ? init.body : "{}";
      const call: UpstreamCall = {
        url,
        headers: new Headers(init.headers),
        body: JSON.parse(bodyText),
        signal: init.signal ?? null,
      };
      calls.push(call);
      return upstream(call);
    },
    now: () => clock,
    upstreamTimeoutMs: over.upstreamTimeoutMs ?? 8_000,
  };
  return { deps, calls };
}

function complete(
  deps: GatewayDeps,
  body: unknown,
  headers: Record<string, string> = {
    authorization: "Bearer bbcred_u1",
    "x-bb-connect-machine": "bbcred_u1",
  },
) {
  return routeGatewayRequest(
    new Request(`https://getbb.app${COMPLETE_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    deps,
  );
}

function usage(deps: GatewayDeps, credential = "bbcred_u1") {
  return routeGatewayRequest(
    new Request(`https://getbb.app${USAGE_PATH}`, {
      headers: { authorization: `Bearer ${credential}` },
    }),
    deps,
  );
}

function usageRow(userId: string, day: string) {
  return db
    .select()
    .from(aiUsageDay)
    .where(and(eq(aiUsageDay.userId, userId), eq(aiUsageDay.day, day)))
    .get();
}

function globalRow(day: string) {
  return db
    .select()
    .from(aiGlobalUsageDay)
    .where(eq(aiGlobalUsageDay.day, day))
    .get();
}

async function seedServer(
  id: string,
  userId: string,
  label: string,
  credential: string,
  revokedAt: Date | null = null,
) {
  db.insert(server)
    .values({
      id,
      userId,
      name: label,
      subdomain: label,
      credentialHash: await sha256Hex(credential),
      revokedAt,
      createdAt: new Date(NOON),
    })
    .run();
}

beforeEach(async () => {
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  for (const file of connectDbMigrationFiles()) {
    sqlite.exec(readConnectDbMigration(file));
  }
  db = drizzle(sqlite, { schema });
  clock = NOON;
  for (const id of ["u1", "u2"]) {
    db.insert(user)
      .values({
        id,
        name: id,
        email: `${id}@example.com`,
        emailVerified: true,
        createdAt: new Date(NOON),
        updatedAt: new Date(NOON),
      })
      .run();
  }
  await seedServer("s1", "u1", "sawyer", "bbcred_u1");
  await seedServer("s1b", "u1", "sawyer-desktop", "bbcred_u1_desktop");
  await seedServer("s2", "u2", "other", "bbcred_u2");
  await seedServer("s3", "u1", "sawyer-old", "bbcred_revoked", new Date(NOON));
});

afterEach(() => {
  sqlite.close();
});

describe("POST /api/ai/v1/complete", () => {
  it("sends the fixed OpenRouter request and meters the reported cost", async () => {
    const { deps, calls } = harness();
    const prompt = "Write a title for: fix the login redirect loop";
    const response = await complete(deps, { prompt });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      text: "Fix the login flow",
      model: MODELS[0],
      usage: {
        costMicros: 850,
        spentTodayMicros: 850,
        limitMicros: 2_000_000,
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://openrouter.test/api/v1/chat/completions",
    );
    expect(calls[0].headers.get("authorization")).toBe("Bearer sk-or-test");
    expect(calls[0].headers.get("http-referer")).toBe("https://getbb.app");
    expect(calls[0].headers.get("x-title")).toBe("bb");
    expect(calls[0].body).toEqual({
      model: MODELS[0],
      models: MODELS.slice(1),
      messages: [{ role: "user", content: prompt }],
      max_tokens: 128,
      temperature: 0.2,
      reasoning: { effort: "none" },
      provider: { zdr: true, data_collection: "deny", sort: "latency" },
      user: await sha256Hex("u1"),
      stream: false,
    });

    const day = utcDay(NOON);
    expect(usageRow("u1", day)).toEqual({
      userId: "u1",
      day,
      spentMicros: 850,
      reservedMicros: 0,
      requests: 1,
    });
    expect(globalRow(day)).toEqual({
      day,
      spentMicros: 850,
      reservedMicros: 0,
    });
    const logs = db.select().from(aiRequestLog).all();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      userId: "u1",
      serverId: "s1",
      model: MODELS[0],
      promptTokens: 120,
      completionTokens: 6,
      costMicros: 850,
      outcome: "ok",
    });
    expect(JSON.stringify(logs)).not.toContain("login redirect");
    expect(JSON.stringify(logs)).not.toContain("Fix the login flow");
  });

  it("omits the fallback list when only one model is configured", async () => {
    const { deps, calls } = harness({ config: { models: [MODELS[0]] } });
    const response = await complete(deps, { prompt: "Write a title" });

    expect(response.status).toBe(200);
    expect(calls[0].body).toMatchObject({ model: MODELS[0] });
    expect(calls[0].body).not.toHaveProperty("models");
  });

  it("accepts the credential in either auth header", async () => {
    const { deps } = harness();
    expect(
      (
        await complete(
          deps,
          { prompt: "a" },
          { authorization: "Bearer bbcred_u1" },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await complete(
          deps,
          { prompt: "a" },
          { "x-bb-connect-machine": "bbcred_u1" },
        )
      ).status,
    ).toBe(200);
  });

  it("rejects revoked, unknown, and missing credentials", async () => {
    const { deps, calls } = harness();
    const attempts: Record<string, string>[] = [
      { authorization: "Bearer bbcred_revoked" },
      { "x-bb-connect-machine": "bbcred_unknown" },
      {},
    ];
    for (const headers of attempts) {
      const response = await complete(deps, { prompt: "a" }, headers);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        error: { code: "unauthorized" },
      });
    }
    expect(calls).toHaveLength(0);
  });

  it("caps the prompt at 48 KB of UTF-8 and validates the body", async () => {
    const { deps, calls } = harness();
    expect(
      (await complete(deps, { prompt: "a".repeat(MAX_PROMPT_BYTES) })).status,
    ).toBe(200);
    for (const body of [
      { prompt: "a".repeat(MAX_PROMPT_BYTES + 1) },
      { prompt: "é".repeat(MAX_PROMPT_BYTES / 2 + 1) },
      { prompt: "" },
      { prompt: 42 },
      {},
      "not json",
    ]) {
      const response = await complete(deps, body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "invalid_request" },
      });
    }
    expect(calls).toHaveLength(1);
    expect(usageRow("u1", utcDay(NOON))?.reservedMicros).toBe(0);
  });

  it("never overshoots the budget with concurrent requests at the limit", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { deps, calls } = harness({
      config: { dailyBudgetMicros: 5 * RESERVE_MICROS },
      upstream: async () => {
        await gate;
        return okCompletion(0.004);
      },
    });
    const statuses: number[] = [];
    const pending = Array.from({ length: 12 }, () =>
      complete(deps, { prompt: "title please" }).then((response) => {
        statuses.push(response.status);
        return response;
      }),
    );
    await vi.waitFor(() => {
      expect(calls).toHaveLength(5);
      expect(statuses).toHaveLength(7);
    });
    const day = utcDay(NOON);
    expect(statuses.every((status) => status === 402)).toBe(true);
    expect(usageRow("u1", day)?.reservedMicros).toBe(5 * RESERVE_MICROS);
    release();
    await Promise.all(pending);
    expect(statuses.filter((status) => status === 200)).toHaveLength(5);
    expect(statuses.filter((status) => status === 402)).toHaveLength(7);
    expect(calls).toHaveLength(5);
    expect(usageRow("u1", day)).toMatchObject({
      spentMicros: 20_000,
      reservedMicros: 0,
      requests: 5,
    });
    expect(globalRow(day)).toMatchObject({
      spentMicros: 20_000,
      reservedMicros: 0,
    });
  });

  it("answers 402 with the next UTC midnight once the daily budget is spent", async () => {
    clock = Date.UTC(2026, 8, 22, 23, 59, 59, 500);
    const { deps, calls } = harness();
    db.insert(aiUsageDay)
      .values({
        userId: "u1",
        day: "2026-09-22",
        spentMicros: 2_000_000 - RESERVE_MICROS + 1,
      })
      .run();
    const response = await complete(deps, { prompt: "a" });
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({
      error: {
        code: "budget_exhausted",
        message: "daily limit reached",
        resetsAt: Date.UTC(2026, 8, 23),
      },
    });
    expect(calls).toHaveLength(0);

    const otherServer = await complete(
      deps,
      { prompt: "a" },
      { authorization: "Bearer bbcred_u1_desktop" },
    );
    expect(otherServer.status).toBe(402);
    expect(
      (
        await complete(
          deps,
          { prompt: "a" },
          { authorization: "Bearer bbcred_u2" },
        )
      ).status,
    ).toBe(200);
  });

  it("starts a fresh budget at UTC midnight and settles on the reserving day", async () => {
    clock = Date.UTC(2026, 8, 22, 23, 59, 59, 900);
    const { deps } = harness({
      upstream: () => {
        clock = Date.UTC(2026, 8, 23, 0, 0, 0, 200);
        return okCompletion(0.001);
      },
    });
    db.insert(aiUsageDay)
      .values({ userId: "u1", day: "2026-09-22", spentMicros: 1_990_000 })
      .run();

    expect((await complete(deps, { prompt: "a" })).status).toBe(200);
    expect(usageRow("u1", "2026-09-22")).toMatchObject({
      spentMicros: 1_991_000,
      reservedMicros: 0,
    });
    expect(usageRow("u1", "2026-09-23")).toBeUndefined();

    expect((await complete(deps, { prompt: "a" })).status).toBe(200);
    expect(usageRow("u1", "2026-09-23")).toMatchObject({
      spentMicros: 1_000,
      reservedMicros: 0,
      requests: 1,
    });
    const usageResponse = await usage(deps);
    expect(await usageResponse.json()).toEqual({
      day: "2026-09-23",
      spentMicros: 1_000,
      limitMicros: 2_000_000,
      resetsAt: Date.UTC(2026, 8, 24),
    });
  });

  it("answers 503 when the global cap is reached and releases the user reserve", async () => {
    const { deps, calls } = harness({
      config: { globalDailyBudgetMicros: RESERVE_MICROS },
      upstream: () => okCompletion(0.003),
    });
    expect((await complete(deps, { prompt: "a" })).status).toBe(200);
    const blocked = await complete(
      deps,
      { prompt: "a" },
      { authorization: "Bearer bbcred_u2" },
    );
    expect(blocked.status).toBe(503);
    expect(await blocked.json()).toMatchObject({
      error: { code: "unavailable" },
    });
    expect(calls).toHaveLength(1);
    const day = utcDay(NOON);
    expect(usageRow("u2", day)).toMatchObject({
      spentMicros: 0,
      reservedMicros: 0,
      requests: 0,
    });
    expect(globalRow(day)).toMatchObject({
      spentMicros: 3_000,
      reservedMicros: 0,
    });
  });

  it("answers 503 without calling upstream when no OpenRouter key is set", async () => {
    const { deps, calls } = harness({ config: { apiKey: null } });
    const response = await complete(deps, { prompt: "a" });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "unavailable" },
    });
    expect(calls).toHaveLength(0);
    expect(usageRow("u1", utcDay(NOON))).toBeUndefined();
  });

  it("releases the reserve on upstream failure and charges only billed cost", async () => {
    const responses = [
      () =>
        Response.json(
          { error: { code: 502, message: "provider down" } },
          { status: 502 },
        ),
      () =>
        Response.json({
          model: MODELS[1],
          choices: [],
          usage: { prompt_tokens: 10, completion_tokens: 0, cost: 0.0001 },
        }),
      () => {
        throw new TypeError("network");
      },
    ];
    let index = 0;
    const { deps } = harness({
      upstream: () => {
        const next = responses[index];
        index += 1;
        return next();
      },
    });
    for (let attempt = 0; attempt < responses.length; attempt += 1) {
      const response = await complete(deps, { prompt: "a" });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: { code: "unavailable" },
      });
    }
    expect(usageRow("u1", utcDay(NOON))).toMatchObject({
      spentMicros: 100,
      reservedMicros: 0,
      requests: 3,
    });
    expect(
      db
        .select({ outcome: aiRequestLog.outcome })
        .from(aiRequestLog)
        .all()
        .map((row) => row.outcome),
    ).toEqual(["upstream_error", "upstream_error", "upstream_error"]);
  });

  it("times out slow upstream calls with 504 and releases the reserve", async () => {
    const { deps } = harness({
      upstreamTimeoutMs: 20,
      upstream: ({ signal }) =>
        new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    });
    const response = await complete(deps, { prompt: "a" });
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({
      error: { code: "timeout" },
    });
    expect(usageRow("u1", utcDay(NOON))).toMatchObject({
      spentMicros: 0,
      reservedMicros: 0,
    });
    expect(db.select().from(aiRequestLog).get()?.outcome).toBe("timeout");
  });

  it("answers 429 when the per-account rate limiter refuses", async () => {
    const { deps, calls } = harness({ allow: () => false });
    const response = await complete(deps, { prompt: "a" });
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      error: { code: "rate_limited" },
    });
    expect(calls).toHaveLength(0);
    expect(usageRow("u1", utcDay(NOON))).toBeUndefined();
  });
});

describe("GET /api/ai/v1/usage", () => {
  it("reports today's spend for the account across its servers", async () => {
    const { deps } = harness();
    await complete(deps, { prompt: "a" });
    const response = await usage(deps, "bbcred_u1_desktop");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      day: "2026-09-22",
      spentMicros: 850,
      limitMicros: 2_000_000,
      resetsAt: Date.UTC(2026, 8, 23),
    });
    const fresh = await usage(deps, "bbcred_u2");
    expect(await fresh.json()).toMatchObject({ spentMicros: 0 });
  });

  it("rejects unauthenticated usage reads", async () => {
    const { deps } = harness();
    const response = await usage(deps, "bbcred_revoked");
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "unauthorized" },
    });
  });
});

describe("routing", () => {
  it("rejects wrong methods and unknown paths", async () => {
    const { deps } = harness();
    const wrongMethod = await routeGatewayRequest(
      new Request(`https://getbb.app${COMPLETE_PATH}`),
      deps,
    );
    expect(wrongMethod.status).toBe(405);
    const unknown = await routeGatewayRequest(
      new Request("https://getbb.app/api/ai/v1/other"),
      deps,
    );
    expect(unknown.status).toBe(404);
  });
});

describe("pruneAiUsage", () => {
  it("deletes request logs and usage days older than 30 days", async () => {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.UTC(2026, 9, 30, 3, 17);
    const old = new Date(now - 31 * day);
    const recent = new Date(now - 29 * day);
    for (const [id, createdAt] of [
      ["old", old],
      ["recent", recent],
    ] as const) {
      db.insert(aiRequestLog)
        .values({
          id,
          userId: "u1",
          serverId: "s1",
          latencyMs: 1,
          outcome: "ok",
          createdAt,
        })
        .run();
    }
    db.insert(aiUsageDay)
      .values([
        { userId: "u1", day: utcDay(old.getTime()) },
        { userId: "u1", day: utcDay(recent.getTime()) },
      ])
      .run();

    await pruneAiUsage(db, now);

    expect(
      db
        .select({ id: aiRequestLog.id })
        .from(aiRequestLog)
        .all()
        .map((row) => row.id),
    ).toEqual(["recent"]);
    expect(
      db
        .select({ day: aiUsageDay.day })
        .from(aiUsageDay)
        .all()
        .map((row) => row.day),
    ).toEqual([utcDay(recent.getTime())]);
  });
});
