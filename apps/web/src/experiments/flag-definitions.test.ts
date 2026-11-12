import { describe, expect, it } from "vitest";

import {
  createFlagDefinitionsSource,
  type DefinitionsLogEntry,
  type SharedCache,
} from "./flag-definitions";

const BODY = JSON.stringify({
  flags: [
    {
      key: "homepage-hero",
      active: true,
      filters: {
        groups: [{ properties: [], rollout_percentage: 100 }],
        multivariate: {
          variants: [
            { key: "control", rollout_percentage: 50 },
            { key: "test", rollout_percentage: 50 },
          ],
        },
      },
    },
  ],
});

function memoryCache(): SharedCache & { store: Map<string, Response> } {
  const store = new Map<string, Response>();
  return {
    store,
    match: async (key) => store.get(key)?.clone(),
    put: async (key, response) => {
      store.set(key, response);
    },
  };
}

function setup(options: {
  respond: (headers: Headers) => Promise<Response>;
  sharedCache?: SharedCache;
}) {
  let clock = 1_000_000;
  const requests: { url: string; headers: Headers }[] = [];
  const logs: DefinitionsLogEntry[] = [];
  const pending: Promise<unknown>[] = [];
  const source = createFlagDefinitionsSource({
    host: "https://flags.test/",
    projectKey: "phc_test",
    secretKey: "phs_secret",
    cacheKey: "https://getbb.app/__experiments/posthog-flag-definitions",
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      requests.push({ url: String(input), headers });
      return options.respond(headers);
    },
    log: (entry) => logs.push(entry),
    now: () => clock,
    ...(options.sharedCache ? { sharedCache: options.sharedCache } : {}),
  });
  return {
    requests,
    logs,
    advance: (ms: number) => {
      clock += ms;
    },
    read: () => source.read((promise) => pending.push(promise)),
    settle: async () => {
      await Promise.all(pending.splice(0));
    },
  };
}

function ok(): Promise<Response> {
  return Promise.resolve(
    new Response(BODY, { status: 200, headers: { etag: '"v1"' } }),
  );
}

describe("flag definitions source", () => {
  it("returns nothing on a cold start and fetches in the background", async () => {
    const harness = setup({ respond: ok });
    expect(await harness.read()).toBeNull();
    await harness.settle();
    expect(harness.requests[0]?.url).toBe(
      "https://flags.test/flags/definitions?token=phc_test&send_cohorts",
    );
    expect(harness.requests[0]?.headers.get("authorization")).toBe(
      "Bearer phs_secret",
    );
    expect((await harness.read())?.has("homepage-hero")).toBe(true);
    expect(harness.requests).toHaveLength(1);
  });

  it("serves stale definitions while revalidating with the ETag", async () => {
    const harness = setup({
      respond: async (headers) =>
        headers.get("if-none-match") === '"v1"'
          ? new Response(null, { status: 304 })
          : ok(),
    });
    await harness.read();
    await harness.settle();
    harness.advance(31_000);
    expect((await harness.read())?.has("homepage-hero")).toBe(true);
    await harness.settle();
    expect(harness.logs.map((entry) => entry.outcome)).toEqual([
      "ok",
      "not_modified",
    ]);
    await harness.read();
    expect(harness.requests).toHaveLength(2);
  });

  it("starts one refresh for concurrent stale reads", async () => {
    const harness = setup({ respond: ok });
    await Promise.all([harness.read(), harness.read(), harness.read()]);
    await harness.settle();
    expect(harness.requests).toHaveLength(1);
  });

  it("stops using definitions an hour after the last successful fetch", async () => {
    let fail = false;
    const harness = setup({
      respond: async () =>
        fail ? new Response("down", { status: 503 }) : ok(),
    });
    await harness.read();
    await harness.settle();
    fail = true;
    harness.advance(59 * 60 * 1000);
    expect(await harness.read()).not.toBeNull();
    await harness.settle();
    harness.advance(2 * 60 * 1000);
    expect(await harness.read()).toBeNull();
    expect(harness.logs.at(-1)).toMatchObject({
      outcome: "http_error",
      status: 503,
    });
  });

  it("shares definitions between isolates through the cache", async () => {
    const sharedCache = memoryCache();
    const first = setup({ respond: ok, sharedCache });
    await first.read();
    await first.settle();
    const second = setup({
      respond: () => Promise.reject(new Error("offline")),
      sharedCache,
    });
    expect((await second.read())?.has("homepage-hero")).toBe(true);
    await second.settle();
    expect(second.requests).toHaveLength(0);
  });

  it("retries a failing fetch at most every 30 seconds", async () => {
    const harness = setup({
      respond: async () => new Response("unauthorized", { status: 401 }),
    });
    for (let index = 0; index < 5; index += 1) {
      expect(await harness.read()).toBeNull();
      await harness.settle();
      harness.advance(1000);
    }
    expect(harness.requests).toHaveLength(1);
    harness.advance(30_000);
    await harness.read();
    await harness.settle();
    expect(harness.requests).toHaveLength(2);
  });

  it.each([
    [
      "an invalid body",
      () => Promise.resolve(new Response("{nope")),
      "invalid_response",
    ],
    ["a network error", () => Promise.reject(new Error("offline")), "error"],
  ])("logs %s and keeps returning nothing", async (_name, respond, outcome) => {
    const harness = setup({ respond });
    expect(await harness.read()).toBeNull();
    await harness.settle();
    expect(await harness.read()).toBeNull();
    expect(harness.logs[0]?.outcome).toBe(outcome);
  });
});
