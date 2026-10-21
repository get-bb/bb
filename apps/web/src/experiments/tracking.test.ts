import { afterEach, describe, expect, it, vi } from "vitest";
import { handleDownload } from "../landing/endpoints";
import { PAGE_EXPERIMENT_REGISTRY } from "./registry";
import { enrollPageRequest, finishPageRequest } from "./tracking";

const XID = "0123456789abcdef0123456789abcdef";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";

function request(
  path = "/",
  headers: Record<string, string> = {},
  country: string | null = "US",
  method = "GET",
) {
  const value = new Request(`https://getbb.app${path}`, {
    method,
    headers: { accept: "text/html", "user-agent": UA, ...headers },
  });
  Object.defineProperty(value, "cf", {
    value: country === null ? {} : { country },
  });
  return value;
}

async function render(
  input: Request,
  enabled = true,
  registry = PAGE_EXPERIMENT_REGISTRY,
) {
  const enrollment = await enrollPageRequest(input, enabled, registry);
  const pending: Promise<void>[] = [];
  const original = new Response("<html>baseline</html>", {
    headers: { "content-type": "text/html", "x-existing": "preserved" },
  });
  const response = finishPageRequest(
    input,
    original,
    enrollment,
    "test-key",
    (promise) => pending.push(promise),
  );
  await Promise.all(pending);
  return { enrollment, response, original };
}

function stubCapture() {
  const capture = vi.fn(
    async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
      new Response("{}", { status: 200 }),
  );
  vi.stubGlobal("fetch", capture);
  return capture;
}

const exclusions: {
  name: string;
  headers?: Record<string, string>;
  country?: string | null;
  search?: string;
}[] = [
  { name: "GPC", headers: { "Sec-GPC": "1" } },
  ...["DE", "GB", "CH", "XX", "T1", null].map((country) => ({
    name: `country ${country}`,
    country,
  })),
  { name: "missing UA", headers: { "user-agent": "" } },
  ...[
    "Googlebot",
    "Bingbot",
    "HeadlessChrome",
    "Lighthouse",
    "facebookexternalhit",
    "crawler",
    "Slackbot-LinkExpanding",
  ].map((ua) => ({ name: ua, headers: { "user-agent": ua } })),
  { name: "prefetch", headers: { "Sec-Purpose": "prefetch;prerender" } },
  { name: "purpose", headers: { Purpose: "prefetch" } },
  {
    name: "internal cookie",
    headers: { cookie: `bb_xid=${XID}; bb_internal=1` },
  },
  { name: "forced", search: "?bb_variant=homepage_aa_check:control_copy" },
  { name: "invalid forced", search: "?bb_variant=homepage_aa_check:nope" },
  ...["gclid", "gbraid", "wbraid"].map((key) => ({
    name: key,
    search: `?${key}=ad-click`,
  })),
  { name: "cpc", search: "?utm_medium=cpc" },
];

describe("page experiment privacy and enrollment", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    "/",
    "/?bb_internal=1",
    "/?bb_variant=homepage_aa_check:control_copy",
  ])("does nothing with the setting off: %s", async (path) => {
    const capture = stubCapture();
    const { response, original, enrollment } = await render(
      request(path, { cookie: `bb_xid=${XID}` }),
      false,
    );
    expect(response).toBe(original);
    expect(enrollment.assignments).toEqual([]);
    expect(capture).not.toHaveBeenCalled();
  });

  it("renews the same identifier and assignment without leaking it into HTML or URLs", async () => {
    const capture = stubCapture();
    const first = await render(
      request("/?utm_source=qa&utm_campaign=qa-test&private=value", {
        cookie: `bb_xid=${XID}`,
      }),
    );
    const second = await render(request("/", { cookie: `bb_xid=${XID}` }));
    expect(first.enrollment.assignments).toEqual(second.enrollment.assignments);
    expect(first.response.headers.get("set-cookie")).toBe(
      `bb_xid=${XID}; Path=/; Max-Age=7776000; Secure; HttpOnly; SameSite=Lax`,
    );
    expect(second.response.headers.get("set-cookie")).toBe(
      first.response.headers.get("set-cookie"),
    );
    expect(first.response.headers.get("cache-control")).toBe(
      "private, no-store",
    );
    expect(await first.response.text()).toBe("<html>baseline</html>");
    const [url, init] = capture.mock.calls[0]!;
    expect(url).toBe("https://us.i.posthog.com/batch/?ip=0");
    const body = JSON.parse(String(init?.body));
    expect(body.batch[0].properties).toEqual({
      experiment_id: "site_holdout",
      variant: expect.stringMatching(/^(control|holdout)$/),
      slot: "holdout",
      page_path: "/",
      visitor_analytics_id: XID,
      $current_url: "https://getbb.app/?utm_source=qa&utm_campaign=qa-test",
      $process_person_profile: false,
    });
    const ids = new Set<string>();
    for (const call of capture.mock.calls) {
      const payload = JSON.parse(String(call[1]?.body));
      for (const event of payload.batch) {
        expect(event.event).toBe("experiment_exposed");
        expect(event.distinct_id).not.toBe(XID);
        expect(ids.has(event.distinct_id)).toBe(false);
        ids.add(event.distinct_id);
        expect(Object.keys(event.properties).sort()).toEqual(
          [
            "experiment_id",
            "variant",
            "slot",
            "page_path",
            "visitor_analytics_id",
            "$current_url",
            "$process_person_profile",
          ].sort(),
        );
        delete event.properties.visitor_analytics_id;
      }
      expect(JSON.stringify(payload)).not.toContain(XID);
    }
  });

  it.each([undefined, "bad", XID.toUpperCase(), `${XID}; bb_xid=${XID}`])(
    "replaces absent or invalid identifiers: %s",
    async (value) => {
      stubCapture();
      const { enrollment } = await render(
        request("/", value ? { cookie: `bb_xid=${value}` } : {}),
      );
      expect(enrollment.visitorId).toMatch(/^[a-f0-9]{32}$/);
      expect(enrollment.visitorId).not.toBe(value);
    },
  );

  it.each(exclusions)(
    "excludes $name without overwriting a previous cookie",
    async (test) => {
      const capture = stubCapture();
      const { response, enrollment } = await render(
        request(
          `/${"search" in test ? test.search : ""}`,
          {
            cookie: `bb_xid=${XID}`,
            ...("headers" in test ? test.headers : {}),
          },
          "country" in test ? test.country : "US",
        ),
      );
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(enrollment.visitorId).toBeNull();
      expect(capture).not.toHaveBeenCalled();
    },
  );

  it("forces a registered variant without enrollment and sets staff exclusions only explicitly", async () => {
    const capture = stubCapture();
    const forced = await render(
      request("/?bb_variant=homepage_aa_check:control_copy"),
    );
    expect(forced.enrollment.assignments.map((value) => value.variant)).toEqual(
      ["control_copy"],
    );
    expect(forced.response.headers.get("cache-control")).toBe(
      "private, no-store",
    );
    const staff = await render(
      request("/?bb_internal=1", { cookie: `bb_xid=${XID}` }),
    );
    expect(staff.response.headers.get("set-cookie")).toBe(
      "bb_internal=1; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax",
    );
    expect(capture).not.toHaveBeenCalled();
  });

  it("does not enroll other paths, non-HTML, non-GET or stopped experiments", async () => {
    const capture = stubCapture();
    for (const input of [
      request("/privacy"),
      request("/", { accept: "application/json" }),
      request("/", {}, "US", "POST"),
    ]) {
      const { response, original } = await render(input);
      expect(response).toBe(original);
    }
    const stopped = PAGE_EXPERIMENT_REGISTRY.map((entry) => ({
      ...entry,
      status: "stopped" as const,
    }));
    const { response, original } = await render(
      request("/", { cookie: `bb_xid=${XID}` }),
      true,
      stopped,
    );
    expect(response).toBe(original);
    expect(capture).not.toHaveBeenCalled();
  });

  it.each([302, 404, 500])(
    "never records a rendered error or redirect (%s)",
    async (status) => {
      const capture = stubCapture();
      const input = request();
      const enrollment = await enrollPageRequest(input, true);
      const original = new Response(null, {
        status,
        headers: { "content-type": "text/html" },
      });
      expect(
        finishPageRequest(input, original, enrollment, "test-key", vi.fn()),
      ).toBe(original);
      expect(capture).not.toHaveBeenCalled();
    },
  );

  it("assigns a representative deterministic 20k population independently with a 10% holdout", async () => {
    const counts = { holdout: 0, control: 0, copy: 0 };
    const quadrants = [
      [0, 0],
      [0, 0],
    ];
    for (let offset = 0; offset < 20000; offset += 200) {
      await Promise.all(
        Array.from({ length: 200 }, async (_, index) => {
          const id = (offset + index).toString(16).padStart(32, "0");
          const input = request("/", { cookie: `bb_xid=${id}` });
          const enrolled = await enrollPageRequest(input, true);
          const holdout = enrolled.assignments[0]!.variant === "holdout";
          if (holdout) {
            counts.holdout++;
            expect(enrolled.assignments).toHaveLength(1);
          } else if (enrolled.assignments[1]!.variant === "control")
            counts.control++;
          else counts.copy++;
          const slotOnly = await enrollPageRequest(
            input,
            true,
            PAGE_EXPERIMENT_REGISTRY.filter(
              (entry) => entry.slot !== "holdout",
            ),
          );
          quadrants[holdout ? 0 : 1]![
            slotOnly.assignments[0]!.variant === "control" ? 0 : 1
          ]!++;
        }),
      );
    }
    expect(counts.holdout / 20000).toBeGreaterThan(0.094);
    expect(counts.holdout / 20000).toBeLessThan(0.106);
    expect(counts.control / (20000 - counts.holdout)).toBeGreaterThan(0.488);
    expect(counts.control / (20000 - counts.holdout)).toBeLessThan(0.512);
    let chiSquare = 0;
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 2; col++) {
        const expected =
          ((quadrants[row]![0]! + quadrants[row]![1]!) *
            (quadrants[0]![col]! + quadrants[1]![col]!)) /
          20000;
        chiSquare += (quadrants[row]![col]! - expected) ** 2 / expected;
      }
    expect(chiSquare).toBeLessThan(6.635);
  }, 30000);
});

describe("experiment download attribution", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function download(input: Request, enabled = true) {
    const capture = stubCapture();
    const pending: Promise<void>[] = [];
    const response = await handleDownload(
      "macos",
      input,
      { LANDING_POSTHOG_KEY: "test-key", PAGE_EXPERIMENTS: String(enabled) },
      (promise) => pending.push(promise),
    );
    await Promise.all(pending);
    const payload = JSON.parse(String(capture.mock.calls[0]?.[1]?.body));
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("location")).not.toContain(XID);
    expect(payload.distinct_id).not.toBe(XID);
    return payload.properties;
  }

  it("attributes only with the setting enabled, preserves UTMs, and keeps the installer separate", async () => {
    const input = request("/download/macos?instructions=1&utm_source=qa", {
      cookie: `bb_xid=${XID}`,
      referer: "https://getbb.app/",
    });
    expect(await download(input)).toMatchObject({
      visitor_analytics_id: XID,
      utm_source: "qa",
      download_target: "macos",
    });
    expect(await download(input, false)).not.toHaveProperty(
      "visitor_analytics_id",
    );
  });

  it.each(exclusions)(
    "omits prior enrollment on excluded download: $name",
    async (test) => {
      const search = "search" in test ? test.search : "";
      const input = request(
        "/download/macos?instructions=1",
        {
          cookie: `bb_xid=${XID}`,
          referer: `https://getbb.app/${search}`,
          ...("headers" in test ? test.headers : {}),
        },
        "country" in test ? test.country : "US",
      );
      expect(await download(input)).not.toHaveProperty("visitor_analytics_id");
    },
  );

  it.each(["?gclid=ad", "?utm_medium=cpc"])(
    "excludes a protected ads-page source with %s",
    async (search) => {
      expect(
        await download(
          request("/download/macos?instructions=1", {
            cookie: `bb_xid=${XID}`,
            referer: `https://getbb.app/claude-code-parallel-agents${search}`,
          }),
        ),
      ).not.toHaveProperty("visitor_analytics_id");
    },
  );
});
