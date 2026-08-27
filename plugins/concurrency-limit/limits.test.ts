import { describe, expect, it } from "vitest";
import {
  isFullyUnlimited,
  parseLimitSetting,
  resolveLimits,
  type RawLimitSettings,
} from "./limits.js";

const BLANK: RawLimitSettings = {
  maxConcurrentThreads: "",
  maxConcurrentThreadsPerHost: "",
};

describe("parseLimitSetting", () => {
  it("treats empty and whitespace as unlimited", () => {
    expect(parseLimitSetting("", "L")).toEqual({ kind: "unlimited" });
    expect(parseLimitSetting("   ", "L")).toEqual({ kind: "unlimited" });
  });

  it("accepts 0 as a real limit rather than folding it into unlimited", () => {
    // "Hold everything" is a setting a user can want, and it is the one value
    // where a falsy-check bug would silently mean the opposite.
    expect(parseLimitSetting("0", "L")).toEqual({ kind: "limit", value: 0 });
  });

  it("rejects values that Number() would happily coerce", () => {
    // The failure mode this guards is `Number(" 4 threads ")` style parsing
    // silently producing NaN, or a signed/float value becoming a nonsense
    // limit that then holds or admits everything.
    for (const raw of ["4.5", "-1", "1e3", "four", "4 threads", "0x10", "+2"]) {
      expect(parseLimitSetting(raw, "L").kind, raw).toBe("invalid");
    }
  });

  it("names the setting and echoes the bad value so the user can find it", () => {
    const result = parseLimitSetting("lots", "Max concurrent threads");
    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") return;
    expect(result.message).toContain("Max concurrent threads");
    expect(result.message).toContain('"lots"');
  });

  it("rejects an absurd limit rather than accepting one that can never bind", () => {
    expect(parseLimitSetting("10000", "L")).toEqual({
      kind: "limit",
      value: 10_000,
    });
    expect(parseLimitSetting("10001", "L").kind).toBe("invalid");
  });
});

describe("resolveLimits", () => {
  it("leaves both limits unenforced when nothing is configured", () => {
    const { limits, problems } = resolveLimits(BLANK);
    expect(problems).toEqual([]);
    expect(isFullyUnlimited(limits)).toBe(true);
  });

  it("reports a bad setting but still enforces the good one", () => {
    // The important property: one typo must not disable the limit that does
    // parse, and must not throw — a throwing gate fails every dispatch.
    const { limits, problems } = resolveLimits({
      maxConcurrentThreads: "4",
      maxConcurrentThreadsPerHost: "two",
    });
    expect(limits.global).toBe(4);
    expect(limits.perHost).toBeNull();
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("per host");
  });
});
