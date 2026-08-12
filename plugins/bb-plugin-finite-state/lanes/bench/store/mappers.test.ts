import { describe, expect, it } from "vitest";
import {
  mapUpstreamRunState,
  mapUpstreamRunStatus,
  matrixTierForBenchTier,
} from "./mappers.js";

describe("bench mappers", () => {
  it("maps every canonical tier exhaustively", () => {
    expect(
      (["tier0", "tier1", "tier2", "tier3", "tier4"] as const).map((tier) =>
        matrixTierForBenchTier(tier),
      ),
    ).toEqual(["static", "emulation", "emulation", "hil", "manual"]);
  });

  it("maps only the four upstream async states", () => {
    expect(["RUNNING", "COMPLETED", "FAILED", "TIMEOUT"].map(mapUpstreamRunStatus)).toEqual([
      "running",
      "completed",
      "failed",
      "timeout",
    ]);
    expect(() => mapUpstreamRunStatus("CANCELLED")).toThrow(/unknown upstream bench status/iu);
  });

  it("preserves richer native state in raw", () => {
    const raw = { verdict: "PASS_WITH_WARNINGS", diagnostics: ["slow"] };
    expect(mapUpstreamRunState("COMPLETED", raw)).toEqual({ status: "completed", raw });
  });
});
