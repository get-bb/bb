import { expect, it } from "vitest";
import { ByteBudgetCache } from "./byte-budget-cache.js";

it("evicts least recently used entries once the byte budget is exceeded", () => {
  const cache = new ByteBudgetCache<string>(10);
  cache.set("a", "A", 4);
  cache.set("b", "B", 4);
  expect(cache.get("a")).toBe("A");
  cache.set("c", "C", 4);

  expect(cache.get("b")).toBeUndefined();
  expect(cache.get("a")).toBe("A");
  expect(cache.get("c")).toBe("C");
});

it("keeps byte accounting correct across replacements and deletions", () => {
  const cache = new ByteBudgetCache<string>(10);
  cache.set("a", "first", 8);
  cache.set("a", "second", 2);
  cache.set("b", "B", 8);
  expect([cache.get("a"), cache.get("b")]).toEqual(["second", "B"]);

  cache.delete("b");
  cache.set("c", "C", 8);
  expect([cache.get("a"), cache.get("c")]).toEqual(["second", "C"]);
});

it("skips entries larger than the per-entry limit without evicting others", () => {
  const cache = new ByteBudgetCache<string | null>(10, 5);
  cache.set("small", null, 5);
  cache.set("huge", "H", 6);

  expect(cache.get("huge")).toBeUndefined();
  expect(cache.get("small")).toBeNull();
});
