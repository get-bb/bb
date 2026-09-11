import { describe, expect, it } from "vitest";
import { hostSchema, machineLifecycleSchema } from "../src/host.js";

describe("host contract", () => {
  it("exposes persistent and ephemeral host types", () => {
    expect(hostSchema.shape.type.options).toEqual(["persistent", "ephemeral"]);
    expect(hostSchema.shape.type.safeParse("temporary").success).toBe(false);
  });

  it("exposes every durable machine lifecycle phase", () => {
    expect(machineLifecycleSchema.shape.phase.options).toEqual([
      "creating",
      "active",
      "suspending",
      "suspended",
      "resuming",
      "removing",
      "destroyed",
    ]);
  });
});
