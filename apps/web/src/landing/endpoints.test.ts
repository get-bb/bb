import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DESKTOP_DOWNLOADS,
  DOWNLOAD_FALLBACK_URL,
  DOWNLOAD_RELEASE_ASSET_BASE_URL,
} from "./site";
import { handleDownload, handleSubscribe } from "./endpoints";

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

  it("tracks the click through waitUntil when a PostHog key is set", async () => {
    const fetchMock = vi.fn(
      async (..._args: Parameters<typeof fetch>) => new Response("{}"),
    );
    vi.stubGlobal("fetch", fetchMock);
    const waitUntil = vi.fn<(promise: Promise<void>) => void>();

    await handleDownload(
      "linux",
      new Request("https://getbb.app/download/linux?placement=nav"),
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
      properties: { download_target: string; placement: string };
    };
    expect(body.event).toBe("landing_download_linux_clicked");
    expect(body.properties.download_target).toBe("linux");
    expect(body.properties.placement).toBe("nav");
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
