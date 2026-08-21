import { describe, expect, it } from "vitest";
import { createAppAssetCompressionCache } from "../../../src/services/plugins/app-asset-compression-cache.js";

describe("plugin app asset compression cache", () => {
  it("deduplicates variants, resets changed hashes, and evicts old assets", async () => {
    const cache = createAppAssetCompressionCache(1);
    let compressionCount = 0;
    const get = (assetKey: string, hash: string, encoding = "br") =>
      cache.getOrCreate({
        assetKey,
        compress: async () => {
          compressionCount += 1;
          return Buffer.from(`compressed-${compressionCount}`);
        },
        encoding,
        hash,
      });

    const [first, concurrent] = await Promise.all([
      get("plugin:js", "hash-1"),
      get("plugin:js", "hash-1"),
    ]);
    expect(concurrent).toEqual(first);
    expect(await get("plugin:js", "hash-1")).toEqual(first);
    expect(compressionCount).toBe(1);

    const gzip = await get("plugin:js", "hash-1", "gzip");
    expect(gzip).not.toEqual(first);
    expect(compressionCount).toBe(2);

    const changed = await get("plugin:js", "hash-2");
    expect(changed).not.toEqual(first);
    expect(compressionCount).toBe(3);

    await get("other:js", "hash-1");
    await get("plugin:js", "hash-2");
    expect(compressionCount).toBe(5);
  });

  it("retries a failed compression instead of caching its rejection", async () => {
    const cache = createAppAssetCompressionCache(1);
    let attempts = 0;
    const get = () =>
      cache.getOrCreate({
        assetKey: "plugin:js",
        compress: async () => {
          attempts += 1;
          if (attempts === 1) {
            throw new Error("compression failed");
          }
          return Buffer.from("compressed");
        },
        encoding: "br",
        hash: "hash-1",
      });

    await expect(get()).rejects.toThrow("compression failed");
    await expect(get()).resolves.toEqual(Buffer.from("compressed"));
    expect(attempts).toBe(2);
  });
});
