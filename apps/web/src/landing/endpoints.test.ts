import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DESKTOP_DOWNLOADS,
  DOWNLOAD_FALLBACK_URL,
  DOWNLOAD_RELEASE_ASSET_BASE_URL,
} from "./site";
import {
  handleDownload,
  handleInstallerDownload,
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

  it.each(["macos", "windows", "linux"] as const)(
    "records the %s click before redirecting without fetching an installer",
    async (platform) => {
      const fetchMock = vi.fn(async () => new Response("{}"));
      vi.stubGlobal("fetch", fetchMock);
      const waitUntil = vi.fn<(promise: Promise<void>) => void>();
      const request = new Request(
        `https://getbb.app/download/${platform}?instructions=1&placement=hero&utm_source=google&utm_medium=cpc&utm_campaign=brand&utm_term=bb&utm_content=cta&gclid=click&gbraid=gb&wbraid=wb&unexpected=drop`,
        { headers: { referer: "https://getbb.app/?utm_campaign=brand" } },
      );

      const responsePromise = handleDownload(
        platform,
        request,
        { LANDING_POSTHOG_KEY: "phc_test" },
        waitUntil,
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://us.i.posthog.com/capture/?ip=0",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining(`landing_download_${platform}_clicked`),
        }),
      );
      const response = await responsePromise;
      expect(response.status).toBe(302);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("Location")).toBe(
        `/install/${platform}?utm_source=google&utm_medium=cpc&utm_campaign=brand&utm_term=bb&utm_content=cta&gclid=click&gbraid=gb&wbraid=wb&placement=hero`,
      );
      expect(waitUntil).toHaveBeenCalledTimes(1);
      await waitUntil.mock.calls[0]?.[0];
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["macos", "bb-0.0.26-arm64.dmg"],
    ["windows", "bb-0.0.26-x64.exe"],
    ["linux", "bb-0.0.26-x86_64.AppImage"],
  ] as const)(
    "does not track %s file starts, retries or resumes",
    async (platform, filename) => {
      const fetchMock = vi.fn(
        async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
          const url = String(input);
          if (url === DESKTOP_DOWNLOADS[platform].versionFeedUrl) {
            return Response.json({ files: [{ url: filename }] });
          }
          if (url === `${DOWNLOAD_RELEASE_ASSET_BASE_URL}/${filename}`) {
            const range = new Headers(init?.headers).get("range");
            return range
              ? new Response("tail", {
                  status: 206,
                  headers: { "content-range": "bytes 100-103/104" },
                })
              : new Response("installer");
          }
          throw new Error(`Unexpected request: ${url}`);
        },
      );
      vi.stubGlobal("fetch", fetchMock);

      for (const range of [null, null, "bytes=0-", "bytes=100-"]) {
        const response = await handleInstallerDownload(
          platform,
          new Request(`https://getbb.app/install/${platform}/file`, {
            headers: range ? { range } : {},
          }),
        );
        expect(response.status).toBe(range ? 206 : 200);
        expect(response.headers.get("Content-Disposition")).toBe(
          `attachment; filename="${filename}"`,
        );
        expect(await response.text()).toBe(range ? "tail" : "installer");
      }
      expect(fetchMock).toHaveBeenCalledTimes(8);
    },
  );

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

  it.each([
    { gpc: undefined, instructions: false },
    { gpc: "1", instructions: false },
    { gpc: undefined, instructions: true },
    { gpc: "1", instructions: true },
  ])(
    "tracks downloads with Sec-GPC $gpc and instructions $instructions",
    async ({ gpc, instructions }) => {
      const fetchMock = vi.fn(
        async (..._args: Parameters<typeof fetch>) => new Response("{}"),
      );
      vi.stubGlobal("fetch", fetchMock);
      const waitUntil = vi.fn<(promise: Promise<void>) => void>();

      const response = await handleDownload(
        "linux",
        new Request(
          `https://getbb.app/download/linux?placement=nav&utm_campaign=x&gclid=abc&gbraid=gb&wbraid=wb${instructions ? "&instructions=1" : ""}`,
          {
            headers: {
              referer:
                "https://getbb.app/?utm_source=google&gclid=ref&gbraid=ref-gb&wbraid=ref-wb",
              ...(gpc ? { "Sec-GPC": gpc } : {}),
            },
          },
        ),
        { LANDING_POSTHOG_KEY: "phc_test" },
        waitUntil,
      );

      if (instructions) {
        expect(response.status).toBe(302);
        expect(response.headers.get("Location")).toBe(
          `/install/linux?utm_campaign=x${gpc === "1" ? "" : "&gclid=abc&gbraid=gb&wbraid=wb"}&placement=nav`,
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
      }
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

describe("download click context", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function click({
    enabled = "true",
    country = "US",
    headers = {},
  }: {
    enabled?: string;
    country?: string;
    headers?: Record<string, string>;
  } = {}) {
    const fetchMock = vi.fn(
      async (_url: unknown, _init?: RequestInit) => new Response("{}"),
    );
    vi.stubGlobal("fetch", fetchMock);
    const request = new Request(
      "https://getbb.app/download/macos?instructions=1&utm_campaign=qa-context",
      { headers },
    );
    Object.defineProperty(request, "cf", { value: { country } });
    const pending: Promise<void>[] = [];
    const response = await handleDownload(
      "macos",
      request,
      {
        LANDING_POSTHOG_KEY: "phc_test",
        DOWNLOAD_CLICK_CONTEXT: enabled,
      },
      (promise) => {
        pending.push(promise);
      },
    );
    await Promise.all(pending);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(payload.event).toBe("landing_download_macos_clicked");
    expect(payload.properties.utm_campaign).toBe("qa-context");
    return { response, properties: payload.properties };
  }

  it.each([
    [
      "Mac Safari",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
      "",
      "desktop",
      "darwin",
      "safari",
      "unknown",
    ],
    [
      "Mac Chrome ARM",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/155.0.0.0 Safari/537.36",
      '"arm"',
      "desktop",
      "darwin",
      "chrome",
      "apple",
    ],
    [
      "Mac Chrome x86",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/155.0.0.0 Safari/537.36",
      '"x86"',
      "desktop",
      "darwin",
      "chrome",
      "intel",
    ],
    [
      "Windows Edge",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0",
      '"x86"',
      "desktop",
      "win32",
      "edge",
      "unknown",
    ],
    [
      "iPhone",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      "",
      "phone",
      "ios",
      "safari",
      "unknown",
    ],
    [
      "Android",
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/155.0.0.0 Mobile Safari/537.36",
      '"arm"',
      "phone",
      "android",
      "chrome",
      "unknown",
    ],
    [
      "Android tablet",
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/155.0.0.0 Safari/537.36",
      "",
      "tablet",
      "android",
      "chrome",
      "unknown",
    ],
    [
      "iPad",
      "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      "",
      "tablet",
      "ios",
      "safari",
      "unknown",
    ],
    [
      "Linux Firefox",
      "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
      "",
      "desktop",
      "linux",
      "firefox",
      "unknown",
    ],
    ["missing UA", "", "", "desktop", "other", "other", "unknown"],
  ])(
    "sends only coarse context for %s",
    async (_name, ua, arch, device, platform, browser, chip) => {
      const { properties } = await click({
        headers: { "User-Agent": ua, "Sec-CH-UA-Arch": arch },
      });
      expect(properties).toMatchObject({
        device_class: device,
        platform,
        browser,
        mac_chip: chip,
        download_repeat: "first",
      });
      expect(Object.keys(properties).sort()).toEqual([
        "$current_url",
        "browser",
        "device_class",
        "download_repeat",
        "download_target",
        "mac_chip",
        "placement",
        "platform",
        "tracking_source",
        "utm_campaign",
      ]);
      if (ua) expect(JSON.stringify(properties)).not.toContain(ua);
    },
  );

  it.each(["false", "", "TRUE"])(
    "keeps tracking unchanged with setting %j",
    async (enabled) => {
      const { response, properties } = await click({
        enabled,
        headers: { cookie: "bb_dl=1" },
      });
      expect(response.headers.get("Set-Cookie")).toBeNull();
      expect(Object.keys(properties).sort()).toEqual([
        "$current_url",
        "download_target",
        "placement",
        "tracking_source",
        "utm_campaign",
      ]);
    },
  );

  it("sets the restricted repeat marker on the redirect and reads it on the next click", async () => {
    const first = await click();
    expect(first.response.status).toBe(302);
    expect(first.response.headers.get("Set-Cookie")).toBe(
      "bb_dl=1; Path=/download; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax",
    );
    expect(first.properties.download_repeat).toBe("first");
    const second = await click({ headers: { cookie: "other=value; bb_dl=1" } });
    expect(second.properties.download_repeat).toBe("repeat");
    const unrelated = await click({
      headers: { cookie: "prefix_bb_dl=1; bb_dl=10" },
    });
    expect(unrelated.properties.download_repeat).toBe("first");
  });

  it.each([
    "AT",
    "BE",
    "BG",
    "HR",
    "CY",
    "CZ",
    "DK",
    "EE",
    "FI",
    "FR",
    "DE",
    "GR",
    "HU",
    "IE",
    "IT",
    "LV",
    "LT",
    "LU",
    "MT",
    "NL",
    "PL",
    "PT",
    "RO",
    "SK",
    "SI",
    "ES",
    "SE",
    "IS",
    "LI",
    "NO",
    "GB",
    "CH",
    "XX",
    "T1",
    "",
  ])(
    "ignores existing cookies and sets none for country %s",
    async (country) => {
      const { response, properties } = await click({
        country,
        headers: { cookie: "bb_dl=1" },
      });
      expect(response.headers.get("Set-Cookie")).toBeNull();
      expect(properties.download_repeat).toBe("unknown");
    },
  );

  it("ignores repeat markers when GPC is on even outside restricted countries", async () => {
    const { response, properties } = await click({
      headers: { "Sec-GPC": "1", cookie: "bb_dl=1" },
    });
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(properties.download_repeat).toBe("unknown");
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
