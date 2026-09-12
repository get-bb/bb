import { describe, expect, it } from "vitest";
import { waitUntil } from "./api.js";

describe("waitUntil", () => {
  it("resolves with the first non-null result and rejects once the deadline passes", async () => {
    let calls = 0;
    await expect(
      waitUntil(
        async () => {
          calls += 1;
          return calls === 3 ? "rendered" : null;
        },
        "the thread view",
        5_000,
        1,
      ),
    ).resolves.toBe("rendered");
    expect(calls).toBe(3);
    await expect(
      waitUntil(async () => null, "a view that never renders", 50, 10),
    ).rejects.toThrow("Timed out waiting for a view that never renders");
  });
});
