import { describe, expect, it } from "vitest";

import { NO_EXPERIMENTS } from "./flags";
import {
  EXPERIMENT_CACHE_CONTROL,
  evaluateFlags,
  readPostHogCookie,
  resolveExperiments,
  uuidv7,
  withExperimentHeaders,
  type ExperimentServerConfig,
  type FlagsLogEntry,
} from "./server";

const KEY = "phc_test";
const COOKIE_NAME = `ph_${KEY}_posthog`;
const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);
const EXISTING_ID = "0199f0a1-2b3c-7d4e-8f90-a1b2c3d4e5f6";
const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function cookieFor(value: unknown): string {
  return `other=1; ${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(value))}`;
}

function flagsResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function setup(respond: (init: RequestInit) => Promise<Response>) {
  const calls: { url: string; body: unknown }[] = [];
  const logs: FlagsLogEntry[] = [];
  const config: ExperimentServerConfig = {
    postHogKey: KEY,
    postHogHost: "https://flags.test/",
    baseDomain: "getbb.app",
    fetch: async (input, init) => {
      calls.push({
        url: String(input),
        body: JSON.parse(String(init?.body)),
      });
      return respond(init ?? {});
    },
    log: (entry) => logs.push(entry),
    now: () => NOW,
    randomBytes: (length) => new Uint8Array(length).fill(0xab),
    timeoutMs: 20,
  };
  return { calls, logs, config };
}

function pageRequest(path = "/", cookie?: string, method = "GET"): Request {
  return new Request(`https://getbb.app${path}`, {
    method,
    headers: cookie ? { cookie } : {},
  });
}

describe("PostHog visitor cookie", () => {
  it("reads distinct_id from the posthog-js cookie", () => {
    expect(
      readPostHogCookie(
        cookieFor({ distinct_id: EXISTING_ID, $sesid: [1, "s", 2] }),
        COOKIE_NAME,
      ),
    ).toEqual({ kind: "found", distinctId: EXISTING_ID });
  });

  it.each([
    ["no cookie header", null, "missing"],
    ["another project's cookie", "ph_phc_other_posthog=%7B%7D", "missing"],
    ["broken JSON", `${COOKIE_NAME}=%7Bnope`, "unreadable"],
    ["no distinct_id", cookieFor({ $device_id: "x" }), "unreadable"],
    ["a non-string distinct_id", cookieFor({ distinct_id: 7 }), "unreadable"],
    ["whitespace", cookieFor({ distinct_id: "a b" }), "unreadable"],
  ])("treats %s as %s", (_name, header, kind) => {
    expect(readPostHogCookie(header, COOKIE_NAME).kind).toBe(kind);
  });

  it("mints a UUIDv7 with the timestamp first", () => {
    const id = uuidv7(NOW, new Uint8Array(10).fill(0xff));
    expect(id).toMatch(UUID_V7);
    expect(Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16)).toBe(NOW);
  });

  it("mints an ID and writes it in posthog-js's format on its domain", async () => {
    const { config } = setup(async () => flagsResponse({ flags: {} }));
    const resolution = await resolveExperiments(pageRequest(), config);
    const id = resolution?.bootstrap.distinctID ?? "";
    expect(id).toMatch(UUID_V7);
    const value = encodeURIComponent(
      JSON.stringify({
        distinct_id: id,
        $device_id: id,
        $user_state: "anonymous",
      }),
    );
    expect(resolution?.setCookie).toBe(
      `${COOKIE_NAME}=${value}; expires=Sat, 30 Oct 2027 12:00:00 GMT; SameSite=Lax; path=/; domain=.getbb.app; secure`,
    );
  });

  it("keeps an existing ID and writes no cookie", async () => {
    const { calls, config } = setup(async () => flagsResponse({ flags: {} }));
    const resolution = await resolveExperiments(
      pageRequest("/", cookieFor({ distinct_id: EXISTING_ID })),
      config,
    );
    expect(resolution?.bootstrap.distinctID).toBe(EXISTING_ID);
    expect(resolution?.setCookie).toBeNull();
    expect(calls[0]?.body).toMatchObject({ distinct_id: EXISTING_ID });
  });

  it("leaves an unreadable cookie alone and evaluates nothing", async () => {
    const { calls, config } = setup(async () => flagsResponse({ flags: {} }));
    const resolution = await resolveExperiments(
      pageRequest("/", `${COOKIE_NAME}=garbage`),
      config,
    );
    expect(resolution).toEqual({
      bootstrap: NO_EXPERIMENTS,
      setCookie: null,
    });
    expect(calls).toHaveLength(0);
  });

  it("writes a host-only cookie off the site domain", async () => {
    const { config } = setup(async () => flagsResponse({ flags: {} }));
    const resolution = await resolveExperiments(
      new Request("http://localhost:3000/"),
      config,
    );
    expect(resolution?.setCookie).not.toContain("domain=");
    expect(resolution?.setCookie).not.toContain("secure");
  });

  it.each([
    ["another page", pageRequest("/blog")],
    ["a HEAD request", pageRequest("/", undefined, "HEAD")],
  ])("skips %s", async (_name, request) => {
    const { calls, config } = setup(async () => flagsResponse({ flags: {} }));
    expect(await resolveExperiments(request, config)).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe("/flags evaluation", () => {
  it("posts the documented body to /flags?v=2", async () => {
    const { calls, config } = setup(async () => flagsResponse({ flags: {} }));
    await resolveExperiments(
      pageRequest("/", cookieFor({ distinct_id: EXISTING_ID })),
      config,
    );
    expect(calls).toEqual([
      {
        url: "https://flags.test/flags/?v=2",
        body: {
          api_key: KEY,
          distinct_id: EXISTING_ID,
          flag_keys_to_evaluate: ["homepage-qa-check"],
          geoip_disable: true,
        },
      },
    ]);
  });

  it.each([
    [
      "an enabled variant",
      { flags: { "homepage-qa-check": { enabled: true, variant: "test" } } },
      { "homepage-qa-check": "test" },
    ],
    [
      "a holdout variant",
      {
        flags: {
          "homepage-qa-check": { enabled: true, variant: "holdout-12" },
        },
      },
      { "homepage-qa-check": "holdout-12" },
    ],
    [
      "a disabled flag",
      { flags: { "homepage-qa-check": { enabled: false, variant: null } } },
      {},
    ],
    [
      "a boolean flag without a variant",
      { flags: { "homepage-qa-check": { enabled: true } } },
      {},
    ],
    ["a missing flag", { flags: {} }, {}],
    [
      "an unrequested flag",
      { flags: { other: { enabled: true, variant: "test" } } },
      {},
    ],
  ])("maps %s", async (_name, body, expected) => {
    const { config, logs } = setup(async () => flagsResponse(body));
    const resolution = await resolveExperiments(pageRequest(), config);
    expect(resolution?.bootstrap.featureFlags).toEqual(expected);
    expect(logs).toEqual([
      {
        event: "posthog_flags",
        outcome: "ok",
        duration_ms: 0,
        status: 200,
        assigned: Object.keys(expected).length,
      },
    ]);
  });

  const enabled = {
    flags: { "homepage-qa-check": { enabled: true, variant: "test" } },
  };

  it.each([
    [
      "quota_limited",
      async () =>
        flagsResponse({ ...enabled, quotaLimited: ["feature_flags"] }),
      200,
    ],
    [
      "errors_while_computing",
      async () =>
        flagsResponse({ ...enabled, errorsWhileComputingFlags: true }),
      200,
    ],
    ["http_error", async () => flagsResponse(enabled, 500), 500],
    ["invalid_response", async () => flagsResponse("nope"), 200],
    [
      "error",
      async (): Promise<Response> => {
        throw new TypeError("network down");
      },
      undefined,
    ],
    [
      "timeout",
      (init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
      undefined,
    ],
  ])("renders control and logs %s", async (outcome, respond, status) => {
    const { config, logs } = setup(respond);
    const resolution = await resolveExperiments(pageRequest(), config);
    expect(resolution?.bootstrap.featureFlags).toEqual({});
    expect(resolution?.bootstrap.distinctID).toMatch(UUID_V7);
    expect(logs).toEqual([
      {
        event: "posthog_flags",
        outcome,
        duration_ms: 0,
        ...(status === undefined ? {} : { status }),
        assigned: 0,
      },
    ]);
  });

  it("times out a slow body read", async () => {
    const logs: FlagsLogEntry[] = [];
    const flags = await evaluateFlags({
      host: "https://flags.test",
      apiKey: KEY,
      distinctId: EXISTING_ID,
      keys: ["homepage-qa-check"],
      fetch: async (_input, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener("abort", () =>
                controller.error(new DOMException("aborted", "AbortError")),
              );
            },
          }),
        ),
      log: (entry) => logs.push(entry),
      now: () => NOW,
      timeoutMs: 10,
    });
    expect(flags).toEqual({});
    expect(logs[0]?.outcome).toBe("timeout");
  });
});

describe("forced preview", () => {
  it("renders forced variants without calling /flags", async () => {
    const { calls, config } = setup(async () => flagsResponse({ flags: {} }));
    const resolution = await resolveExperiments(
      pageRequest(
        "/?ph_flag=homepage-qa-check:test&ph_flag=unknown:test",
        cookieFor({ distinct_id: EXISTING_ID }),
      ),
      config,
    );
    expect(resolution?.bootstrap).toEqual({
      distinctID: EXISTING_ID,
      featureFlags: { "homepage-qa-check": "test" },
      preview: true,
    });
    expect(calls).toHaveLength(0);
  });

  it("works without a PostHog key", async () => {
    const { config } = setup(async () => flagsResponse({ flags: {} }));
    const resolution = await resolveExperiments(
      pageRequest("/?ph_flag=homepage-qa-check:test"),
      { ...config, postHogKey: undefined },
    );
    expect(resolution).toEqual({
      bootstrap: {
        distinctID: null,
        featureFlags: { "homepage-qa-check": "test" },
        preview: true,
      },
      setCookie: null,
    });
  });
});

describe("experiment response headers", () => {
  const page = () =>
    new Response("<html></html>", {
      status: 200,
      headers: { "content-type": "text/html", "cache-control": "max-age=60" },
    });

  it("marks every page with a distinctID private and sets a minted cookie", async () => {
    const response = withExperimentHeaders(page(), {
      bootstrap: { distinctID: EXISTING_ID, featureFlags: {}, preview: false },
      setCookie: `${COOKIE_NAME}=x`,
    });
    expect(response.headers.get("cache-control")).toBe(
      EXPERIMENT_CACHE_CONTROL,
    );
    expect(response.headers.get("set-cookie")).toBe(`${COOKIE_NAME}=x`);
    expect(await response.text()).toBe("<html></html>");
  });

  it("leaves pages without a distinctID untouched", () => {
    const response = withExperimentHeaders(page(), {
      bootstrap: {
        distinctID: null,
        featureFlags: { "homepage-qa-check": "test" },
        preview: true,
      },
      setCookie: null,
    });
    expect(response.headers.get("cache-control")).toBe("max-age=60");
  });
});
