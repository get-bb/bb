import { describe, expect, it } from "vitest";
import { deferCloseUntilOpen, takePendingClose } from "./pending-close.js";

describe("pending tab close", () => {
  it("is taken once the next tab is the open one", () => {
    deferCloseUntilOpen("a", "b", 0);
    expect(takePendingClose("a", "a", 10)).toBe(false);
    expect(takePendingClose("c", "b", 10)).toBe(false);
    expect(takePendingClose("a", "b", 10)).toBe(true);
    expect(takePendingClose("a", "b", 20)).toBe(false);
  });

  it("expires so a stale close never archives later", () => {
    deferCloseUntilOpen("a", "b", 0);
    expect(takePendingClose("a", "b", 60_000)).toBe(false);
  });
});
