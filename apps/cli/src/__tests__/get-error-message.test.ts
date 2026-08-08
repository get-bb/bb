import { describe, expect, it } from "vitest";
import { getErrorMessage } from "../commands/helpers.js";

describe("getErrorMessage", () => {
  it("unwraps the cause chain so connect errors survive fetch failed", () => {
    const err = new TypeError("fetch failed", {
      cause: new Error("connect EPERM 127.0.0.1:38886"),
    });

    expect(getErrorMessage(err)).toBe(
      "fetch failed: connect EPERM 127.0.0.1:38886",
    );
  });

  it("returns the message unchanged without a cause", () => {
    expect(getErrorMessage(new Error("plain"))).toBe("plain");
  });

  it("stringifies non-Error values", () => {
    expect(getErrorMessage("boom")).toBe("boom");
  });

  it("stops on a cyclic cause chain", () => {
    const err = new Error("loop");
    err.cause = err;

    expect(getErrorMessage(err)).toBe("loop");
  });
});
