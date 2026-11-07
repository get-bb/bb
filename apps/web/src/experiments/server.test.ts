import { describe, expect, it } from "vitest";

import { EXPERIMENT_KEYS, NO_EXPERIMENTS } from "./flags";
import {
  EXPERIMENT_CACHE_CONTROL,
  ASSIGNMENT_COOKIE_NAME,
  evaluateFlags,
  readAssignmentCookie,
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
const BROWSER =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
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
    siteWideKeys: [],
  };
  return { calls, logs, config };
}

function pageRequest(path = "/", cookie?: string, method = "GET"): Request {
  return new Request(`https://getbb.app${path}`, {
    method,
    headers: { "user-agent": BROWSER, ...(cookie ? { cookie } : {}) },
  });
}

function htmlRequest(path: string, cookie?: string, method = "GET"): Request {
  return new Request(`https://getbb.app${path}`, {
    method,
    headers: {
      accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      "user-agent": BROWSER,
      ...(cookie ? { cookie } : {}),
    },
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
    expect(resolution?.setCookies[0]).toBe(
      `${COOKIE_NAME}=${value}; expires=Sat, 30 Oct 2027 12:00:00 GMT; SameSite=Lax; path=/; domain=.getbb.app; secure`,
    );
  });

  it("keeps an existing ID and writes no visitor cookie", async () => {
    const { calls, config } = setup(async () => flagsResponse({ flags: {} }));
    const resolution = await resolveExperiments(
      pageRequest("/", cookieFor({ distinct_id: EXISTING_ID })),
      config,
    );
    expect(resolution?.bootstrap.distinctID).toBe(EXISTING_ID);
    expect(
      resolution?.setCookies.some((c) => c.startsWith(COOKIE_NAME)),
    ).toBe(false);
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
      setCookies: [],
    });
    expect(calls).toHaveLength(0);
  });

  it("writes a host-only cookie off the site domain", async () => {
    const { config } = setup(async () => flagsResponse({ flags: {} }));
    const resolution = await resolveExperiments(
      new Request("http://localhost:3000/", {
        headers: { "user-agent": BROWSER },
      }),
      config,
    );
    expect(resolution?.setCookies[0]).not.toContain("domain=");
    expect(resolution?.setCookies[0]).not.toContain("secure");
  });

  it("evaluates only the site-wide experiments on /download", async () => {
    const { calls, config } = setup(async () => flagsResponse({ flags: {} }));
    await resolveExperiments(
      htmlRequest("/download", cookieFor({ distinct_id: EXISTING_ID })),
      { ...config, siteWideKeys: ["homepage-qa-check"] },
    );
    expect(calls[0]?.body).toMatchObject({
      flag_keys_to_evaluate: ["homepage-qa-check"],
    });
  });

  it.each([
    ["a crawler", "Mozilla/5.0 (compatible; Googlebot/2.1)"],
    ["an uptime check", "UptimeRobot/2.0"],
    ["a script", "curl/8.5.0"],
    ["Node's fetch", "node"],
    ["no user agent", ""],
  ])("renders control for %s without calling /flags", async (_name, ua) => {
    const { calls, config } = setup(async () => flagsResponse({ flags: {} }));
    const request = new Request("https://getbb.app/", {
      headers: { "user-agent": ua },
    });
    expect(await resolveExperiments(request, config)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("still previews forced variants for automated clients", async () => {
    const { calls, config } = setup(async () => flagsResponse({ flags: {} }));
    const request = new Request(
      "https://getbb.app/?ph_flag=homepage-qa-check:test",
      { headers: { "user-agent": "curl/8.5.0" } },
    );
    expect((await resolveExperiments(request, config))?.bootstrap).toEqual({
      distinctID: null,
      featureFlags: { "homepage-qa-check": "test" },
      preview: true,
    });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["another page", htmlRequest("/blog")],
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
          flag_keys_to_evaluate: EXPERIMENT_KEYS,
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
      "a control variant",
      {
        flags: {
          "homepage-qa-check": { enabled: true, variant: "control" },
        },
      },
      { "homepage-qa-check": "control" },
    ],
    [
      "an unknown variant to nothing",
      {
        flags: {
          "homepage-qa-check": { enabled: true, variant: "holdout-12" },
        },
      },
      {},
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
    expect(flags).toEqual({ outcome: "timeout", flags: {} });
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
      setCookies: [],
    });
  });
});

describe("site-wide experiments", () => {
  const assigned = {
    flags: { "homepage-qa-check": { enabled: true, variant: "test" } },
  };
  const visitor = cookieFor({ distinct_id: EXISTING_ID });
  const stored = (value: string) =>
    `${visitor}; ${ASSIGNMENT_COOKIE_NAME}=${encodeURIComponent(value)}`;
  const siteCookie = (value: string) =>
    `${ASSIGNMENT_COOKIE_NAME}=${encodeURIComponent(value)}; expires=Sat, 31 Oct 2026 12:00:00 GMT; SameSite=Lax; Path=/; Secure`;
  const unassigned = (at: number) => `homepage-qa-check=~${at}`;

  function siteSetup(respond: (init: RequestInit) => Promise<Response>) {
    const context = setup(respond);
    const config: ExperimentServerConfig = {
      ...context.config,
      siteWideKeys: ["homepage-qa-check"],
    };
    return { ...context, config };
  }

  it("assigns a first visit to any page and stores it for a day", async () => {
    const { calls, config } = siteSetup(async () => flagsResponse(assigned));
    const resolution = await resolveExperiments(htmlRequest("/blog"), config);
    expect(calls[0]?.body).toMatchObject({
      flag_keys_to_evaluate: ["homepage-qa-check"],
    });
    expect(resolution?.bootstrap.distinctID).toMatch(UUID_V7);
    expect(resolution?.bootstrap.featureFlags).toEqual({
      "homepage-qa-check": "test",
    });
    expect(resolution?.setCookies.map((c) => c.split("=")[0])).toEqual([
      COOKIE_NAME,
      ASSIGNMENT_COOKIE_NAME,
    ]);
    expect(resolution?.setCookies[1]).toBe(
      siteCookie(`homepage-qa-check=test%7E${NOW}`),
    );
  });

  it("stores a visitor outside the experiment for an hour only", async () => {
    const { config } = siteSetup(async () => flagsResponse({ flags: {} }));
    const resolution = await resolveExperiments(
      htmlRequest("/changelog", visitor),
      config,
    );
    expect(resolution?.bootstrap.featureFlags).toEqual({});
    expect(resolution?.setCookies).toEqual([
      siteCookie(`homepage-qa-check=%7E${NOW}`),
    ]);
  });

  it("asks again an hour after a flag was not live, so a launch applies", async () => {
    const { calls, config } = siteSetup(async () => flagsResponse(assigned));
    const resolution = await resolveExperiments(
      htmlRequest("/changelog", stored(unassigned(NOW - 60 * 60 * 1000))),
      config,
    );
    expect(calls).toHaveLength(1);
    expect(resolution?.bootstrap.featureFlags).toEqual({
      "homepage-qa-check": "test",
    });
    expect(resolution?.setCookies).toEqual([
      siteCookie(`homepage-qa-check=test%7E${NOW}`),
    ]);
  });

  it("asks again a day after assigning, so stopping a flag applies", async () => {
    const { calls, config } = siteSetup(async () =>
      flagsResponse({ flags: {} }),
    );
    const resolution = await resolveExperiments(
      htmlRequest(
        "/changelog",
        stored(`homepage-qa-check=test~${NOW - 24 * 60 * 60 * 1000}`),
      ),
      config,
    );
    expect(calls).toHaveLength(1);
    expect(resolution?.bootstrap.featureFlags).toEqual({});
  });

  it("keeps an assignment's original time when the cookie is rewritten", async () => {
    const { config } = siteSetup(async () => flagsResponse({ flags: {} }));
    const assignedAt = NOW - 23 * 60 * 60 * 1000;
    const resolution = await resolveExperiments(
      pageRequest(
        "/",
        stored(`homepage-qa-check=test~${assignedAt}`),
      ),
      config,
    );
    expect(resolution?.bootstrap.featureFlags).toMatchObject({
      "homepage-qa-check": "test",
    });
    const restamped = encodeURIComponent(`homepage-qa-check=test%7E${NOW}`);
    expect(
      (resolution?.setCookies ?? []).filter((cookie) =>
        cookie.includes(restamped),
      ),
    ).toEqual([]);
  });

  it("skips the homepage's /flags call once every experiment is stored", async () => {
    const { calls, config } = siteSetup(async () => flagsResponse(assigned));
    const all = EXPERIMENT_KEYS.map((key) =>
      key === "homepage-qa-check" ? `${key}=test~${NOW}` : `${key}=~${NOW}`,
    ).join("&");
    const resolution = await resolveExperiments(
      pageRequest("/", stored(all)),
      config,
    );
    expect(calls).toHaveLength(0);
    expect(resolution?.bootstrap.featureFlags).toEqual({
      "homepage-qa-check": "test",
    });
  });

  it.each([
    [
      "an assigned visitor",
      `homepage-qa-check=test~${NOW - 1000}`,
      { "homepage-qa-check": "test" },
    ],
    ["a visitor outside the experiment", unassigned(NOW - 1000), {}],
  ])(
    "renders %s from the cookie without calling /flags",
    async (_name, value, featureFlags) => {
      const { calls, config } = siteSetup(async () => flagsResponse(assigned));
      const resolution = await resolveExperiments(
        htmlRequest("/guides/remote", stored(value)),
        config,
      );
      expect(resolution).toEqual({
        bootstrap: { distinctID: EXISTING_ID, featureFlags, preview: false },
        setCookies: [],
      });
      expect(calls).toHaveLength(0);
    },
  );

  it("asks the homepage's /flags call only for unstored experiments", async () => {
    const { calls, config } = siteSetup(async () =>
      flagsResponse({ flags: {} }),
    );
    const resolution = await resolveExperiments(
      pageRequest("/", stored(`homepage-qa-check=test~${NOW}`)),
      config,
    );
    expect(resolution?.bootstrap.featureFlags).toMatchObject({
      "homepage-qa-check": "test",
    });
    expect(
      calls.flatMap(
        (call) =>
          (call.body as { flag_keys_to_evaluate: string[] })
            .flag_keys_to_evaluate,
      ),
    ).not.toContain("homepage-qa-check");
  });

  it("renders control and stores nothing when /flags times out", async () => {
    const { config, logs } = siteSetup(
      (init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const resolution = await resolveExperiments(
      htmlRequest("/blog", visitor),
      config,
    );
    expect(resolution?.bootstrap.featureFlags).toEqual({});
    expect(resolution?.setCookies).toEqual([]);
    expect(logs[0]?.outcome).toBe("timeout");
  });

  it("previews forced variants on any page without storing them", async () => {
    const { calls, config } = siteSetup(async () => flagsResponse(assigned));
    const resolution = await resolveExperiments(
      htmlRequest("/blog?ph_flag=homepage-qa-check:test", visitor),
      config,
    );
    expect(resolution).toEqual({
      bootstrap: {
        distinctID: EXISTING_ID,
        featureFlags: { "homepage-qa-check": "test" },
        preview: true,
      },
      setCookies: [],
    });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["an API route", htmlRequest("/api/account/me")],
    ["the dashboard", htmlRequest("/dashboard/hosts")],
    ["a download redirect", htmlRequest("/download/macos")],
    ["a file", htmlRequest("/sitemap.xml")],
    ["a marketplace API path", htmlRequest("/marketplace/v1/index")],
    ["a non-HTML fetch", pageRequest("/blog")],
    ["a HEAD request", htmlRequest("/blog", undefined, "HEAD")],
  ])("leaves %s alone", async (_name, request) => {
    const { calls, config } = siteSetup(async () => flagsResponse(assigned));
    expect(await resolveExperiments(request, config)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("follows only listed experiments with known variants", () => {
    const header = (value: string) =>
      `${ASSIGNMENT_COOKIE_NAME}=${encodeURIComponent(value)}`;
    const keys = ["homepage-qa-check"] as const;
    expect(
      readAssignmentCookie(
        header("homepage-qa-check=%3Cb%3E&constructor=test&unknown=test"),
        keys,
        NOW,
      ),
    ).toEqual({});
    expect(
      readAssignmentCookie(
        header(`homepage-qa-check=holdout-12~${NOW}`),
        keys,
        NOW,
      ),
    ).toEqual({});
    expect(
      readAssignmentCookie(header("homepage-qa-check=test"), [], NOW),
    ).toEqual({});
    expect(
      readAssignmentCookie(`${ASSIGNMENT_COOKIE_NAME}=%E0%A4%A`, keys, NOW),
    ).toEqual({});
  });
});

describe("experiment response headers", () => {
  const page = () =>
    new Response("<html></html>", {
      status: 200,
      headers: { "content-type": "text/html", "cache-control": "max-age=60" },
    });

  it("marks every page with a distinctID private and sets its cookies", async () => {
    const response = withExperimentHeaders(page(), {
      bootstrap: { distinctID: EXISTING_ID, featureFlags: {}, preview: false },
      setCookies: [`${COOKIE_NAME}=x`, `${ASSIGNMENT_COOKIE_NAME}=y`],
    });
    expect(response.headers.get("cache-control")).toBe(
      EXPERIMENT_CACHE_CONTROL,
    );
    expect(response.headers.getSetCookie()).toEqual([
      `${COOKIE_NAME}=x`,
      `${ASSIGNMENT_COOKIE_NAME}=y`,
    ]);
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(await response.text()).toBe("<html></html>");
  });

  it("marks a page rendered from the site-wide cookie private", () => {
    const response = withExperimentHeaders(page(), {
      bootstrap: {
        distinctID: null,
        featureFlags: { "homepage-qa-check": "test" },
        preview: false,
      },
      setCookies: [],
    });
    expect(response.headers.get("cache-control")).toBe(
      EXPERIMENT_CACHE_CONTROL,
    );
  });

  it("keeps a control page's caching but varies it on cookies", () => {
    const response = withExperimentHeaders(page(), null);
    expect(response.headers.get("cache-control")).toBe("max-age=60");
    expect(response.headers.get("vary")).toBe("Cookie");
  });

  it("leaves non-HTML responses untouched", () => {
    const json = new Response("{}", {
      headers: { "content-type": "application/json" },
    });
    expect(withExperimentHeaders(json, null)).toBe(json);
  });
});
