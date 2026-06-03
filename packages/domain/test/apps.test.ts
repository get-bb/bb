import { describe, expect, it } from "vitest";
import {
  applicationIdSchema,
  deriveApplicationIdFromName,
} from "../src/index.js";

describe("application ids", () => {
  it("accepts lowercase app slugs", () => {
    expect(applicationIdSchema.safeParse("status").success).toBe(true);
    expect(applicationIdSchema.safeParse("review-board").success).toBe(true);
  });

  it("rejects non-slug application ids", () => {
    for (const value of ["Bad", "a/b", "..", "a.b", ""]) {
      expect(applicationIdSchema.safeParse(value).success).toBe(false);
    }
  });

  it("derives application ids from display names", () => {
    expect(deriveApplicationIdFromName("Review Board")).toBe("review-board");
  });
});
