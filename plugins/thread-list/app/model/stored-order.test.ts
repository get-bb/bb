import { describe, expect, it } from "vitest";
import { haveSameOrder, reorderStoredOrder } from "./stored-order.js";

describe("reorderStoredOrder", () => {
  it("moves an item onto its drop target", () => {
    expect(
      reorderStoredOrder({
        activeId: "terminal",
        overId: "browser",
        order: ["browser", "terminal", "side-chat"],
        visibleIds: ["browser", "terminal", "side-chat"],
      }),
    ).toEqual(["terminal", "browser", "side-chat"]);
  });

  it("leaves absent items pinned to their slot while visible items move", () => {
    expect(
      reorderStoredOrder({
        activeId: "side-chat",
        overId: "browser",
        order: ["browser", "quickstart", "side-chat"],
        visibleIds: ["browser", "side-chat"],
      }),
    ).toEqual(["side-chat", "quickstart", "browser"]);
  });

  it("applies a full visible order while retaining hidden and absent slots", () => {
    expect(
      reorderStoredOrder({
        order: ["pinned", "browser", "quickstart", "terminal", "side-chat"],
        visibleIds: ["browser", "terminal", "side-chat"],
        nextVisibleIds: ["side-chat", "browser", "terminal"],
      }),
    ).toEqual(["pinned", "side-chat", "quickstart", "browser", "terminal"]);
  });

  it.each([
    { nextVisibleIds: ["browser"] },
    { nextVisibleIds: ["browser", "browser"] },
    { nextVisibleIds: ["browser", "unknown"] },
  ])(
    "rejects a replacement order with changed membership: $nextVisibleIds",
    ({ nextVisibleIds }) => {
      expect(
        reorderStoredOrder({
          order: ["browser", "quickstart", "terminal"],
          visibleIds: ["browser", "terminal"],
          nextVisibleIds,
        }),
      ).toBeNull();
    },
  );

  it("declines a drag that ends where it started or outside the list", () => {
    expect(
      reorderStoredOrder({
        activeId: "browser",
        overId: "browser",
        order: ["browser", "terminal"],
        visibleIds: ["browser", "terminal"],
      }),
    ).toBeNull();
    expect(
      reorderStoredOrder({
        activeId: "browser",
        overId: "elsewhere",
        order: ["browser", "terminal"],
        visibleIds: ["browser", "terminal"],
      }),
    ).toBeNull();
  });
});

describe("haveSameOrder", () => {
  it("compares by position, not membership", () => {
    expect(haveSameOrder(["a", "b"], ["a", "b"])).toBe(true);
    expect(haveSameOrder(["a", "b"], ["b", "a"])).toBe(false);
    expect(haveSameOrder(["a"], ["a", "b"])).toBe(false);
  });
});
