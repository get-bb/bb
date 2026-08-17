// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createLastKnownCache } from "./last-known-cache";

const schema = z.object({ models: z.array(z.string()) });

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("createLastKnownCache", () => {
  it("round-trips a value under a scoped, versioned key", () => {
    const cache = createLastKnownCache({
      prefix: "bb.test",
      version: "1",
      schema,
    });
    const key = cache.key("env-1", null, "codex");
    expect(key).toBe("bb.test.1.env-1.-.codex");
    cache.write(key, { models: ["a"] });
    expect(cache.read(key)).toEqual({ models: ["a"] });
  });

  it("treats a stored value that fails the schema as absent", () => {
    const cache = createLastKnownCache({
      prefix: "bb.test",
      version: "1",
      schema,
    });
    window.localStorage.setItem(
      cache.key("x"),
      JSON.stringify({ models: "nope" }),
    );
    expect(cache.read(cache.key("x"))).toBeNull();
  });

  it("swallows storage failures on write instead of throwing", () => {
    const cache = createLastKnownCache({
      prefix: "bb.test",
      version: "1",
      schema,
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(() => cache.write(cache.key("x"), { models: [] })).not.toThrow();
    expect(cache.read(cache.key("x"))).toBeNull();
  });

  it("treats storage that cannot be read as absent instead of throwing", () => {
    const cache = createLastKnownCache({
      prefix: "bb.test",
      version: "1",
      schema,
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(cache.read(cache.key("x"))).toBeNull();
    // Reads on a restricted store must not poison later writes either.
    vi.restoreAllMocks();
    cache.write(cache.key("x"), { models: ["c"] });
    expect(cache.read(cache.key("x"))).toEqual({ models: ["c"] });
  });

  it("never prunes its own zero-scope entry on a fresh load", () => {
    // A cache with no routing dimensions stores under the bare version key.
    // Each page load constructs the cache anew and prunes once; the entry
    // written by the previous load must survive that prune, or the replay
    // is deleted before its first read on every visit.
    const config = { prefix: "bb.test", version: "1", schema } as const;
    const firstLoad = createLastKnownCache(config);
    firstLoad.write(firstLoad.key(), { models: ["kept"] });

    const nextLoad = createLastKnownCache(config);
    expect(nextLoad.read(nextLoad.key())).toEqual({ models: ["kept"] });
    expect(window.localStorage.getItem("bb.test.1")).not.toBeNull();
  });

  it("prunes entries written under another version of the same cache", () => {
    window.localStorage.setItem(
      "bb.test.0.old",
      JSON.stringify({ models: [] }),
    );
    window.localStorage.setItem("bb.other.0.keep", "1");
    const cache = createLastKnownCache({
      prefix: "bb.test",
      version: "1",
      schema,
    });
    cache.write(cache.key("new"), { models: ["b"] });
    expect(window.localStorage.getItem("bb.test.0.old")).toBeNull();
    expect(window.localStorage.getItem("bb.other.0.keep")).toBe("1");
    expect(cache.read(cache.key("new"))).toEqual({ models: ["b"] });
  });
});
