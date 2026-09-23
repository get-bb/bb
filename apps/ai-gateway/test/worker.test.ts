import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import {
  Miniflare,
  type Request as MiniflareRequest,
  Response as MiniflareResponse,
} from "miniflare";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "@bb/connect-db";
import { applyConnectDbMigrationsToD1 } from "@bb/connect-db/testing";

const CREDENTIAL = "bbcred_miniflare_server";
const NOW = Date.now();
const upstreamBodies: unknown[] = [];

async function bundleWorker(): Promise<string> {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../src/worker.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    target: "esnext",
    conditions: ["workerd", "worker", "browser"],
    write: false,
  });
  return result.outputFiles[0].text;
}

const VARS = {
  AI_DAILY_BUDGET_MICROS: "2000000",
  AI_MODELS: "nvidia/nemotron-3.5-lightning,inception/mercury-2.5",
  AI_UPSTREAM_BASE_URL: "https://openrouter.test/api/v1",
};

let upstreamGate: Promise<void> = Promise.resolve();

function gateway(script: string, bindings: Record<string, string>) {
  return new Miniflare({
    modules: true,
    script,
    compatibilityDate: "2026-06-11",
    d1Databases: { DB: "ai-gateway-test" },
    ratelimits: { AI_RATE_LIMITER: { simple: { limit: 60, period: 60 } } },
    bindings,
    outboundService: async (request: MiniflareRequest) => {
      upstreamBodies.push(await request.json());
      await upstreamGate;
      return new MiniflareResponse(
        JSON.stringify({
          model: "nvidia/nemotron-3.5-lightning",
          choices: [{ message: { role: "assistant", content: "A title" } }],
          usage: { prompt_tokens: 12, completion_tokens: 3, cost: 0.00001 },
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  });
}

let mf: Miniflare;
let unconfigured: Miniflare;
let tight: Miniflare;

async function seed(db: D1Database): Promise<void> {
  await applyConnectDbMigrationsToD1(db);
  await db
    .prepare(
      "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('u1', 'Sawyer', 'u1@example.com', 1, ?1, ?1)",
    )
    .bind(NOW)
    .run();
  await db
    .prepare(
      "INSERT INTO server (id, user_id, name, subdomain, credential_hash, created_at) VALUES ('s1', 'u1', 'default', 'sawyer', ?1, ?2)",
    )
    .bind(await sha256Hex(CREDENTIAL), NOW)
    .run();
}

beforeAll(async () => {
  const script = await bundleWorker();
  mf = gateway(script, { ...VARS, OPENROUTER_API_KEY: "sk-or-test" });
  unconfigured = gateway(script, VARS);
  tight = gateway(script, {
    ...VARS,
    AI_DAILY_BUDGET_MICROS: "25000",
    OPENROUTER_API_KEY: "sk-or-test",
  });
  for (const instance of [mf, unconfigured, tight]) {
    await seed((await instance.getD1Database("DB")) as unknown as D1Database);
  }
}, 60_000);

afterAll(async () => {
  await Promise.all([mf?.dispose(), unconfigured?.dispose(), tight?.dispose()]);
});

function complete(instance: Miniflare, prompt = "title please") {
  return instance.dispatchFetch("https://getbb.app/api/ai/v1/complete", {
    method: "POST",
    headers: {
      authorization: `Bearer ${CREDENTIAL}`,
      "x-bb-connect-machine": CREDENTIAL,
      "content-type": "application/json",
    },
    body: JSON.stringify({ prompt }),
  });
}

describe("bb-ai-gateway worker on D1", () => {
  it("completes, meters in D1, and reports usage", async () => {
    const response = await complete(mf);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      text: "A title",
      model: "nvidia/nemotron-3.5-lightning",
      usage: { costMicros: 10, spentTodayMicros: 10, limitMicros: 2_000_000 },
    });
    expect(upstreamBodies.at(-1)).toMatchObject({
      model: "nvidia/nemotron-3.5-lightning",
      models: ["inception/mercury-2.5"],
      max_tokens: 128,
    });

    const db = (await mf.getD1Database("DB")) as unknown as D1Database;
    const row = await db
      .prepare(
        "SELECT spent_micros, reserved_micros, requests FROM ai_usage_day WHERE user_id = 'u1'",
      )
      .first();
    expect(row).toEqual({ spent_micros: 10, reserved_micros: 0, requests: 1 });

    const usage = await mf.dispatchFetch("https://getbb.app/api/ai/v1/usage", {
      headers: { "x-bb-connect-machine": CREDENTIAL },
    });
    expect(usage.status).toBe(200);
    expect(await usage.json()).toMatchObject({
      spentMicros: 10,
      limitMicros: 2_000_000,
    });
  });

  it("rate limits an account at 60 completions a minute", async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 61; index += 1) {
      statuses.push((await complete(mf)).status);
    }
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(
      0,
    );
    const limited = await complete(mf);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({
      error: { code: "rate_limited" },
    });
    const db = (await mf.getD1Database("DB")) as unknown as D1Database;
    const logged = await db
      .prepare(
        "SELECT COUNT(*) AS refused FROM ai_request_log WHERE outcome = 'rate_limited' AND cost_micros = 0",
      )
      .first<{ refused: number }>();
    expect(logged?.refused).toBe(
      statuses.filter((status) => status === 429).length + 1,
    );
  }, 30_000);

  it("holds concurrent D1 reservations to the daily limit", async () => {
    let release: () => void = () => {};
    upstreamGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const before = upstreamBodies.length;
    const statuses: number[] = [];
    const pending = Array.from({ length: 8 }, () =>
      complete(tight).then((response) => {
        statuses.push(response.status);
        return response.arrayBuffer();
      }),
    );
    await vi.waitFor(() => {
      expect(upstreamBodies.length - before).toBe(5);
      expect(statuses).toHaveLength(3);
    });
    expect(statuses).toEqual([402, 402, 402]);
    release();
    await Promise.all(pending);
    expect(statuses.filter((status) => status === 200)).toHaveLength(5);
    const db = (await tight.getD1Database("DB")) as unknown as D1Database;
    expect(
      await db
        .prepare(
          "SELECT spent_micros, reserved_micros FROM ai_usage_day WHERE user_id = 'u1'",
        )
        .first(),
    ).toEqual({ spent_micros: 50, reserved_micros: 0 });
  });

  it("answers unavailable without an OpenRouter key", async () => {
    const response = await complete(unconfigured);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "unavailable" },
    });
  });

  it("prunes month-old metadata on the daily cron", async () => {
    const db = (await mf.getD1Database("DB")) as unknown as D1Database;
    const old = NOW - 40 * 24 * 60 * 60 * 1000;
    await db
      .prepare(
        "INSERT INTO ai_request_log (id, user_id, server_id, latency_ms, outcome, created_at) VALUES ('old', 'u1', 's1', 5, 'ok', ?1)",
      )
      .bind(old)
      .run();
    await db
      .prepare("INSERT INTO ai_usage_day (user_id, day) VALUES ('u1', ?1)")
      .bind(new Date(old).toISOString().slice(0, 10))
      .run();

    const worker = await mf.getWorker();
    await worker.scheduled({
      scheduledTime: new Date(NOW),
      cron: "17 3 * * *",
    });

    expect(
      await db
        .prepare("SELECT id FROM ai_request_log WHERE id = 'old'")
        .first(),
    ).toBeNull();
    expect(
      (
        await db
          .prepare("SELECT COUNT(*) AS days FROM ai_usage_day")
          .first<{ days: number }>()
      )?.days,
    ).toBe(1);
  });
});
