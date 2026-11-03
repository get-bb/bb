import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DESKTOP_DOWNLOADS,
  DOWNLOAD_FALLBACK_URL,
  DOWNLOAD_RELEASE_ASSET_BASE_URL,
} from "./site";
import {
  downloadLinkEmail,
  downloadLinkIdempotencyKey,
  handleDownload,
  handleEmailDownloadLink,
  handleSubscribe,
} from "./endpoints";

describe("marketing download", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubReleaseFetch(feedFiles: string[], installer: () => Response) {
    const fetchMock = vi.fn(
      async (input: Parameters<typeof fetch>[0], _init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith(".json")) {
          return new Response(
            JSON.stringify({ files: feedFiles.map((name) => ({ url: name })) }),
          );
        }
        return installer();
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("serves the current macOS dmg from getbb.app as an attachment", async () => {
    const fetchMock = stubReleaseFetch(
      ["bb-0.0.26-arm64.zip", "bb-0.0.26-arm64.dmg"],
      () => new Response("dmg-bytes", { headers: { "content-length": "9" } }),
    );

    const response = await handleDownload(
      "macos",
      new Request("https://getbb.app/download/macos?placement=hero"),
      {},
      vi.fn(),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      DESKTOP_DOWNLOADS.macos.versionFeedUrl,
      { headers: { accept: "application/json" } },
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `${DOWNLOAD_RELEASE_ASSET_BASE_URL}/bb-0.0.26-arm64.dmg`,
      undefined,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Location")).toBeNull();
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="bb-0.0.26-arm64.dmg"',
    );
    expect(response.headers.get("Content-Length")).toBe("9");
    expect(await response.text()).toBe("dmg-bytes");
  });

  it("serves the AppImage from the Linux feed", async () => {
    const fetchMock = stubReleaseFetch(
      ["bb-0.42.1-x86_64.AppImage", "bb-0.42.1-x86_64.AppImage.blockmap"],
      () => new Response("appimage-bytes"),
    );

    const response = await handleDownload(
      "linux",
      new Request("https://getbb.app/download/linux?placement=hero"),
      {},
      vi.fn(),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      DESKTOP_DOWNLOADS.linux.versionFeedUrl,
      { headers: { accept: "application/json" } },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="bb-0.42.1-x86_64.AppImage"',
    );
  });

  it("resumes a partial download without counting it again", async () => {
    const fetchMock = stubReleaseFetch(
      ["bb-0.0.26-arm64.dmg"],
      () =>
        new Response("tail", {
          headers: { "content-range": "bytes 100-103/104" },
          status: 206,
        }),
    );
    const waitUntil = vi.fn<(promise: Promise<void>) => void>();

    const response = await handleDownload(
      "macos",
      new Request("https://getbb.app/download/macos", {
        headers: { range: "bytes=100-" },
      }),
      { LANDING_POSTHOG_KEY: "phc_test" },
      waitUntil,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      `${DOWNLOAD_RELEASE_ASSET_BASE_URL}/bb-0.0.26-arm64.dmg`,
      { headers: { range: "bytes=100-" } },
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 100-103/104");
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("restarts a resume whose If-Range no longer matches the installer", async () => {
    const fetchMock = stubReleaseFetch(["bb-0.0.27-arm64.dmg"], () => {
      const ranged = fetchMock.mock.calls.at(-1)?.[1] !== undefined;
      return ranged
        ? new Response("tail", {
            headers: { "content-range": "bytes 100-103/104", etag: '"new"' },
            status: 206,
          })
        : new Response("whole-new-file", { headers: { etag: '"new"' } });
    });

    const response = await handleDownload(
      "macos",
      new Request("https://getbb.app/download/macos", {
        headers: { range: "bytes=100-", "if-range": '"old"' },
      }),
      {},
      vi.fn(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Range")).toBeNull();
    expect(await response.text()).toBe("whole-new-file");
  });

  it("keeps the partial response when If-Range still matches", async () => {
    stubReleaseFetch(
      ["bb-0.0.27-arm64.dmg"],
      () =>
        new Response("tail", {
          headers: { "content-range": "bytes 100-103/104", etag: '"same"' },
          status: 206,
        }),
    );

    const response = await handleDownload(
      "macos",
      new Request("https://getbb.app/download/macos", {
        headers: { range: "bytes=100-", "if-range": '"same"' },
      }),
      {},
      vi.fn(),
    );

    expect(response.status).toBe(206);
    expect(await response.text()).toBe("tail");
  });

  it("falls back to the release page when the installer fetch fails", async () => {
    stubReleaseFetch(
      ["bb-0.0.26-arm64.dmg"],
      () => new Response("missing", { status: 404 }),
    );

    const response = await handleDownload(
      "macos",
      new Request("https://getbb.app/download/macos"),
      {},
      vi.fn(),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(DOWNLOAD_FALLBACK_URL);
  });

  it("serves the Windows installer from the Windows feed", async () => {
    const fetchMock = stubReleaseFetch(
      ["bb-0.45.0-x64.exe", "bb-0.45.0-x64.exe.blockmap"],
      () => new Response("exe-bytes"),
    );

    const response = await handleDownload(
      "windows",
      new Request("https://getbb.app/download/windows?placement=hero"),
      {},
      vi.fn(),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      DESKTOP_DOWNLOADS.windows.versionFeedUrl,
      { headers: { accept: "application/json" } },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="bb-0.45.0-x64.exe"',
    );
  });

  it("never serves a macOS installer for a Linux request", async () => {
    stubReleaseFetch(["bb-0.42.1-arm64.dmg"], () => new Response("dmg"));

    const response = await handleDownload(
      "linux",
      new Request("https://getbb.app/download/linux"),
      {},
      vi.fn(),
    );

    expect(response.headers.get("Location")).toBe(DOWNLOAD_FALLBACK_URL);
  });

  it("falls back to the release page when the feed has no dmg", async () => {
    stubReleaseFetch(["notes.txt"], () => new Response("unused"));

    const response = await handleDownload(
      "macos",
      new Request("https://getbb.app/download/macos"),
      {},
      vi.fn(),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(DOWNLOAD_FALLBACK_URL);
  });

  it.each([undefined, "1"])(
    "tracks downloads while respecting Sec-GPC %s",
    async (gpc) => {
      const fetchMock = vi.fn(
        async (..._args: Parameters<typeof fetch>) => new Response("{}"),
      );
      vi.stubGlobal("fetch", fetchMock);
      const waitUntil = vi.fn<(promise: Promise<void>) => void>();

      await handleDownload(
        "linux",
        new Request(
          "https://getbb.app/download/linux?placement=nav&utm_campaign=x&gclid=abc&gbraid=gb&wbraid=wb",
          {
            headers: {
              referer:
                "https://getbb.app/?utm_source=google&gclid=ref&gbraid=ref-gb&wbraid=ref-wb&via=share",
              ...(gpc ? { "Sec-GPC": gpc } : {}),
            },
          },
        ),
        { LANDING_POSTHOG_KEY: "phc_test" },
        waitUntil,
      );

      expect(waitUntil).toHaveBeenCalledTimes(1);
      await waitUntil.mock.calls[0]?.[0];
      const captureCall = fetchMock.mock.calls.find(
        ([url]) => typeof url === "string" && url.includes("posthog"),
      );
      expect(captureCall).toBeTruthy();
      const body = JSON.parse(String(captureCall?.[1]?.body)) as {
        event: string;
        properties: {
          download_target: string;
          placement: string;
          utm_campaign?: string;
          gclid?: string;
          gbraid?: string;
          wbraid?: string;
          utm_source?: string;
          $current_url: string;
          $referrer?: string;
        };
      };
      expect(body.event).toBe("landing_download_linux_clicked");
      expect(body.properties.download_target).toBe("linux");
      expect(body.properties.placement).toBe("nav");
      expect(body.properties.utm_campaign).toBe("x");
      expect(body.properties.utm_source).toBe("google");
      expect(
        new URL(body.properties.$referrer ?? "").searchParams.get("via"),
      ).toBe("share");
      for (const [name, value, referrerValue] of [
        ["gclid", "abc", "ref"],
        ["gbraid", "gb", "ref-gb"],
        ["wbraid", "wb", "ref-wb"],
      ] as const) {
        expect(body.properties[name]).toBe(gpc === "1" ? undefined : value);
        expect(
          new URL(body.properties.$current_url).searchParams.get(name),
        ).toBe(gpc === "1" ? null : value);
        expect(
          new URL(body.properties.$referrer ?? "").searchParams.get(name),
        ).toBe(gpc === "1" ? null : referrerValue);
      }
    },
  );
});

describe("download visit attribution", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const VISITOR_ID = "019a0000-0000-7000-8000-000000000001";
  const SESSION_ID = "019a0000-0000-7000-8000-000000000002";

  type CapturedEvent = {
    distinct_id: string;
    properties: Record<string, string | undefined>;
  };

  async function captureDownload(
    query: string,
    headers: Record<string, string> = {},
  ): Promise<CapturedEvent> {
    const fetchMock = vi.fn(
      async (..._args: Parameters<typeof fetch>) => new Response("{}"),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "00000000-0000-4000-8000-00000000ffff",
    );
    const waitUntil = vi.fn<(promise: Promise<void>) => void>();
    await handleDownload(
      "macos",
      new Request(`https://getbb.app/download/macos?${query}`, { headers }),
      { LANDING_POSTHOG_KEY: "phc_test" },
      waitUntil,
    );
    await waitUntil.mock.calls[0]?.[0];
    const captureCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("posthog"),
    );
    return JSON.parse(String(captureCall?.[1]?.body)) as CapturedEvent;
  }

  it("joins the download to the visitor, session and first touch", async () => {
    const event = await captureDownload(
      new URLSearchParams({
        placement: "hero",
        visitor_id: VISITOR_ID,
        session_id: SESSION_ID,
        first_page: "/compare/cursor-alternative",
        first_referrer: "https://www.google.com/search?q=bb",
      }).toString(),
      { referer: "https://getbb.app/compare/cursor-alternative" },
    );

    expect(event.distinct_id).toBe(VISITOR_ID);
    expect(event.properties).toEqual({
      $current_url: "https://getbb.app/download/macos?placement=hero",
      $referrer: "https://getbb.app/compare/cursor-alternative",
      $session_id: SESSION_ID,
      download_target: "macos",
      first_page: "/compare/cursor-alternative",
      first_referrer: "https://www.google.com",
      placement: "hero",
      tracking_source: "landing_worker_redirect",
    });
  });

  it("falls back to a random id when the visit is absent", async () => {
    const event = await captureDownload("placement=nav");

    expect(event.distinct_id).toBe("00000000-0000-4000-8000-00000000ffff");
    expect(event.properties.$session_id).toBeUndefined();
    expect(event.properties.first_page).toBeUndefined();
    expect(event.properties.first_referrer).toBeUndefined();
  });

  it("keeps the /download page placement", async () => {
    const event = await captureDownload("placement=download_page");

    expect(event.properties.placement).toBe("download_page");
  });

  it("keeps the /download page's tags in the referrer", async () => {
    const event = await captureDownload("placement=download_page", {
      referer: "https://getbb.app/download?utm_source=x&via=email",
    });

    expect(event.properties.utm_source).toBe("x");
    expect(
      new URL(event.properties.$referrer ?? "").searchParams.get("via"),
    ).toBe("email");
  });

  it.each([
    ["visitor_id", `${VISITOR_ID}x`],
    ["visitor_id", "user@example.com"],
    ["session_id", "<script>"],
    ["first_page", "//evil.example/path"],
    ["first_page", "https://evil.example/"],
    ["first_page", "/a?b=c"],
    ["first_referrer", "javascript:alert(1)"],
    ["first_referrer", "not a url"],
  ])("drops an invalid %s of %s", async (name, value) => {
    const event = await captureDownload(
      new URLSearchParams({ [name]: value }).toString(),
    );

    expect(event.distinct_id).toBe("00000000-0000-4000-8000-00000000ffff");
    expect(event.properties.$session_id).toBeUndefined();
    expect(event.properties.first_page).toBeUndefined();
    expect(event.properties.first_referrer).toBeUndefined();
    expect(event.properties.$current_url).toBe(
      "https://getbb.app/download/macos",
    );
  });
});

describe("marketing subscribe endpoint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function subscribeRequest(email: unknown): Request {
    return new Request("https://getbb.app/api/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
  }

  it("reports not-configured without Resend credentials", async () => {
    const response = await handleSubscribe(subscribeRequest("a@b.co"), {});
    expect(response.status).toBe(503);
  });

  it("adds a valid email to the Resend audience", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleSubscribe(subscribeRequest("a@b.co"), {
      RESEND_API_KEY: "re_test",
      RESEND_AUDIENCE_ID: "aud_test",
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/audiences/aud_test/contacts",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejects malformed emails without calling Resend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleSubscribe(subscribeRequest("not-an-email"), {
      RESEND_API_KEY: "re_test",
      RESEND_AUDIENCE_ID: "aud_test",
    });

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("email download link endpoint", () => {
  const SEGMENT = "seg_download_link";
  const ENV = {
    APP_URL: "https://getbb.app",
    RESEND_API_KEY: "re_test",
    RESEND_DOWNLOAD_LINK_AUDIENCE_ID: SEGMENT,
    RESEND_DOWNLOAD_LINK_FROM: "bb <updates@mail.getbb.app>",
    RESEND_DOWNLOAD_LINK_REPLY_TO: "support@example.com",
    EMAIL_LINK_IP_RATE_LIMITER: limiter(true),
    EMAIL_LINK_SITE_RATE_LIMITER: limiter(true),
  };

  function limiter(success: boolean) {
    return {
      limit: vi.fn(async (_options: { key: string }) => ({ success })),
    };
  }
  const NOW = () => new Date("2026-11-03T12:00:00Z");
  const EMAILS_URL = "https://api.resend.com/emails";
  const CONTACTS_URL = "https://api.resend.com/contacts";
  const SEGMENT_URL = `https://api.resend.com/contacts/me%40example.com/segments/${SEGMENT}`;

  type Call = { url: string; method: string; body: unknown; headers: Headers };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function linkRequest(body: unknown): Request {
    return new Request("https://getbb.app/api/email-download-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function stubResend(
    respond: (call: Call) => Response | undefined,
  ): Call[] {
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const call = {
          url: String(input),
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
          headers: new Headers(init?.headers),
        };
        calls.push(call);
        return respond(call) ?? new Response("{}", { status: 200 });
      }),
    );
    return calls;
  }

  async function send(body: unknown, env: typeof ENV = ENV) {
    const pending: Promise<void>[] = [];
    const response = await handleEmailDownloadLink(
      linkRequest(body),
      env,
      (promise) => pending.push(promise),
      NOW,
    );
    await Promise.all(pending);
    return { response, background: pending.length };
  }

  const routes = (calls: Call[]) =>
    calls.map(({ method, url }) => `${method} ${url}`);

  it("sends the email, then creates the contact unsubscribed in the segment", async () => {
    const calls = stubResend(() => undefined);
    const { response } = await send({
      email: " me@example.com ",
      search: "?utm_source=google&gclid=abc&ref=x&via=share",
    });
    expect(response.status).toBe(200);
    expect(routes(calls)).toEqual([
      `POST ${EMAILS_URL}`,
      `POST ${CONTACTS_URL}`,
    ]);
    const link = "https://getbb.app/download?utm_source=google&gclid=abc&via=email";
    expect(calls[0]?.body).toEqual({
      from: "bb <updates@mail.getbb.app>",
      to: ["me@example.com"],
      reply_to: "support@example.com",
      ...downloadLinkEmail(link, "getbb.app"),
    });
    expect(calls[0]?.headers.get("Idempotency-Key")).toBe(
      await downloadLinkIdempotencyKey("me@example.com", NOW()),
    );
    expect(calls[1]?.body).toEqual({
      email: "me@example.com",
      unsubscribed: true,
      segments: [{ id: SEGMENT }],
    });
  });

  it("adds an existing contact to the segment without changing its unsubscribed flag", async () => {
    const calls = stubResend((call) =>
      call.url === CONTACTS_URL
        ? new Response('{"message":"Contact already exists"}', { status: 409 })
        : undefined,
    );
    const { response } = await send({ email: "me@example.com" });
    expect(response.status).toBe(200);
    expect(routes(calls)).toEqual([
      `POST ${EMAILS_URL}`,
      `POST ${CONTACTS_URL}`,
      `POST ${SEGMENT_URL}`,
    ]);
    expect(calls[2]?.body).toBeUndefined();
    expect(calls.filter((call) => call.method === "PATCH")).toEqual([]);
  });

  it("still sends the email and answers sent when the contact can't be added", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const calls = stubResend((call) =>
      call.url === EMAILS_URL
        ? undefined
        : new Response('{"message":"boom"}', { status: 500 }),
    );
    const { response, background } = await send({ email: "me@example.com" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(background).toBe(1);
    expect(routes(calls)[0]).toBe(`POST ${EMAILS_URL}`);
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({ event: "download_link_contact", outcome: "failed" }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("example.com");
  });

  it("logs and answers sent when the contact call throws", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    stubResend((call) => {
      if (call.url !== EMAILS_URL) {
        throw new TypeError("network");
      }
      return undefined;
    });
    const { response } = await send({ email: "me@example.com" });
    expect(response.status).toBe(200);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("checks the per-IP and site-wide limits before sending", async () => {
    const perIp = limiter(true);
    const siteWide = limiter(true);
    const calls = stubResend(() => undefined);
    const request = new Request("https://getbb.app/api/email-download-link", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.7",
      },
      body: JSON.stringify({ email: "me@example.com" }),
    });
    const response = await handleEmailDownloadLink(
      request,
      {
        ...ENV,
        EMAIL_LINK_IP_RATE_LIMITER: perIp,
        EMAIL_LINK_SITE_RATE_LIMITER: siteWide,
      },
      () => {},
      NOW,
    );
    expect(response.status).toBe(200);
    expect(perIp.limit).toHaveBeenCalledWith({ key: "203.0.113.7" });
    expect(siteWide.limit).toHaveBeenCalledWith({
      key: "email-download-link",
    });
    expect(routes(calls)[0]).toBe(`POST ${EMAILS_URL}`);
  });

  it.each([
    ["per-IP", "EMAIL_LINK_IP_RATE_LIMITER"],
    ["site-wide", "EMAIL_LINK_SITE_RATE_LIMITER"],
  ] as const)(
    "refuses without calling Resend over the %s limit",
    async (_name, binding) => {
      const calls = stubResend(() => undefined);
      const { response, background } = await send(
        { email: "me@example.com" },
        { ...ENV, [binding]: limiter(false) },
      );
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "send_failed" });
      expect(calls).toEqual([]);
      expect(background).toBe(0);
    },
  );

  it("reports not-configured without the segment, sender or key", async () => {
    const calls = stubResend(() => undefined);
    for (const missing of [
      "RESEND_API_KEY",
      "RESEND_DOWNLOAD_LINK_AUDIENCE_ID",
      "RESEND_DOWNLOAD_LINK_FROM",
    ] as const) {
      const { response } = await send(
        { email: "me@example.com" },
        { ...ENV, [missing]: "" },
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "not_configured" });
    }
    expect(calls).toEqual([]);
  });

  it.each([["not-an-email"], [""], [42], [`${"a".repeat(250)}@b.co`]])(
    "rejects %s without calling Resend",
    async (email) => {
      const calls = stubResend(() => undefined);
      const { response } = await send({ email });
      expect(response.status).toBe(400);
      expect(calls).toEqual([]);
    },
  );

  it("keys the send to the address and UTC day so a repeat that day sends nothing new", async () => {
    const first = await downloadLinkIdempotencyKey("Me@Example.com", NOW());
    expect(first).toBe(
      await downloadLinkIdempotencyKey(
        "me@example.com",
        new Date("2026-11-03T23:59:59Z"),
      ),
    );
    expect(first).not.toBe(
      await downloadLinkIdempotencyKey(
        "me@example.com",
        new Date("2026-11-04T00:00:00Z"),
      ),
    );
    expect(first).not.toContain("example");
    expect(first.length).toBeLessThanOrEqual(256);
  });

  it("treats Resend's repeat-key conflict as already sent", async () => {
    stubResend((call) =>
      call.url === EMAILS_URL
        ? new Response('{"name":"invalid_idempotent_request"}', { status: 409 })
        : undefined,
    );
    const { response } = await send({
      email: "me@example.com",
      search: "?utm_source=x",
    });
    expect(response.status).toBe(200);
  });

  it("returns a send failure and skips the contact when the send fails", async () => {
    const calls = stubResend((call) =>
      call.url === EMAILS_URL
        ? new Response('{"message":"boom"}', { status: 500 })
        : undefined,
    );
    const { response, background } = await send({ email: "me@example.com" });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "send_failed" });
    expect(routes(calls)).toEqual([`POST ${EMAILS_URL}`]);
    expect(background).toBe(0);
  });

  it("returns a send failure when Resend is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network");
      }),
    );
    const { response } = await send({ email: "me@example.com" });
    expect(response.status).toBe(502);
  });

  it("writes a minimal email with one button, one line, and the plain link", () => {
    const link = "https://getbb.app/download?utm_source=a&via=email";
    const email = downloadLinkEmail(link, "getbb.app");
    expect(email.subject).toBe("Your bb download link");
    expect(email.text).toBe(
      `Download bb: ${link}\n\nYou asked for this link on getbb.app. We won't email you again.\n`,
    );
    expect(email.html.match(/<a /g)).toHaveLength(2);
    expect(email.html).toContain(
      'href="https://getbb.app/download?utm_source=a&amp;via=email"',
    );
    expect(email.html).toContain(">Download bb</a>");
    expect(email.html).not.toMatch(/unsubscribe|<img/i);
  });

  it("attributes a download that came from the email link", async () => {
    const fetchMock = vi.fn(
      async (..._args: Parameters<typeof fetch>) => new Response("{}"),
    );
    vi.stubGlobal("fetch", fetchMock);
    const waitUntil = vi.fn<(promise: Promise<void>) => void>();
    await handleDownload(
      "macos",
      new Request("https://getbb.app/download/macos?placement=hero", {
        headers: { referer: "https://getbb.app/download?utm_source=x&via=email" },
      }),
      { LANDING_POSTHOG_KEY: "phc_test" },
      waitUntil,
    );
    await waitUntil.mock.calls[0]?.[0];
    const capture = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("posthog"),
    );
    const body = JSON.parse(String(capture?.[1]?.body)) as {
      properties: { send_link_via?: string; placement: string };
    };
    expect(body.properties.send_link_via).toBe("email");
    expect(body.properties.placement).toBe("hero");
  });
});
