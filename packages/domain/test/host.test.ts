import { describe, expect, it } from "vitest";
import { hostSchema } from "../src/host.js";

describe("host contract", () => {
  it("exposes persistent and ephemeral host types", () => {
    expect(hostSchema.shape.type.options).toEqual(["persistent", "ephemeral"]);
    expect(hostSchema.shape.type.safeParse("temporary").success).toBe(false);
  });
});
