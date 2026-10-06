import { afterEach, expect, it, vi } from "vitest";
import { withTestHarness } from "../helpers/test-app.js";

const manifest = {
  version: "0.39.0",
  versionCode: 4,
  size: 147311657,
  sha256: "a".repeat(64),
};
const asset = {
  name: `${manifest.sha256}.apk`,
  size: manifest.size,
  state: "uploaded",
  updated_at: "2026-09-29T19:28:00Z",
};
afterEach(() => vi.unstubAllGlobals());

it("reads metadata only, matches the checksum asset, and caches concurrent requests", async () => {
  await withTestHarness(async ({ app }) => {
    const request = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("latest.json")) return Response.json(manifest);
      if (String(url).endsWith("/tags/android-testing"))
        return Response.json({
          assets: [
            { ...asset, name: "old.apk", updated_at: "2025-01-01T00:00:00Z" },
            asset,
          ],
        });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", request);
    const results = await Promise.all([
      app.request("/api/v1/system/mobile-app-releases"),
      app.request("/api/v1/system/mobile-app-releases"),
    ]);
    for (const result of results)
      expect(await result.json()).toEqual({
        android: { ...manifest, updatedAt: asset.updated_at },
      });
    expect(request).toHaveBeenCalledTimes(2);
  });
});

it.each(["unavailable", "mismatch", "invalid"])(
  "omits unverified release details when metadata is %s",
  async (failure) => {
    await withTestHarness(async ({ app }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string | URL | Request) => {
          if (failure === "unavailable")
            return new Response(null, { status: 503 });
          if (String(url).endsWith("latest.json"))
            return Response.json(failure === "invalid" ? {} : manifest);
          return Response.json({ assets: [{ ...asset, size: 1 }] });
        }),
      );
      const result = await app.request("/api/v1/system/mobile-app-releases");
      expect(result.status).toBe(200);
      expect(await result.json()).toEqual({ android: null });
    });
  },
);
