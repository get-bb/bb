import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DOWNLOAD_MACOS_FALLBACK_URL,
  DOWNLOAD_MACOS_RELEASE_ASSET_BASE_URL,
  DOWNLOAD_MACOS_VERSION_FEED_URL,
} from "./site";
import worker from "./worker";

function makeEnv() {
  return {
    ASSETS: {
      fetch: vi.fn(async () => new Response("asset")),
    },
  };
}

function makeContext() {
  return {
    waitUntil: vi.fn(),
  };
}

describe("landing worker download redirect", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("redirects macOS downloads to the current dmg asset", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          files: [
            { url: "bb-0.0.26-arm64.zip" },
            { url: "bb-0.0.26-arm64.dmg" },
          ],
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await worker.fetch(
      new Request("https://getbb.app/download/macos?placement=hero"),
      makeEnv(),
      makeContext(),
    );

    expect(fetchMock).toHaveBeenCalledWith(DOWNLOAD_MACOS_VERSION_FEED_URL, {
      headers: { accept: "application/json" },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      `${DOWNLOAD_MACOS_RELEASE_ASSET_BASE_URL}/bb-0.0.26-arm64.dmg`,
    );
  });

  it("falls back to the release page when the feed has no dmg", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ files: [{ url: "notes.txt" }] }));
      }),
    );

    const response = await worker.fetch(
      new Request("https://getbb.app/download/macos"),
      makeEnv(),
      makeContext(),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(DOWNLOAD_MACOS_FALLBACK_URL);
  });
});
