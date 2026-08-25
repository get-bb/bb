import { describe, expect, it } from "vitest";
import {
  isFullyUnlimited,
  needsLoadSampling,
  parseLimitSetting,
  parsePercentSetting,
  resolveLimits,
  type RawLimitSettings,
} from "./limits.js";

const BLANK: RawLimitSettings = {
  maxConcurrentThreads: "",
  maxConcurrentThreadsPerHost: "",
  maxConcurrentThreadsPerProvider: "",
  maxHostCpuPercent: "",
  maxHostMemoryPercent: "",
  includeChildThreads: false,
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

describe("parsePercentSetting", () => {
  it("accepts the 1-100 range and rejects outside it", () => {
    expect(parsePercentSetting("1", "P")).toEqual({ kind: "limit", value: 1 });
    expect(parsePercentSetting("100", "P")).toEqual({
      kind: "limit",
      value: 100,
    });
    expect(parsePercentSetting("101", "P").kind).toBe("invalid");
  });

  it("rejects 0, which would hold every dispatch forever", () => {
    // Unlike a 0 thread limit, a 0% threshold has no legitimate reading: the
    // gate would hold whenever load is at or above nothing.
    expect(parsePercentSetting("0", "P").kind).toBe("invalid");
  });

  it("treats empty as off", () => {
    expect(parsePercentSetting("", "P")).toEqual({ kind: "unlimited" });
  });
});

describe("resolveLimits", () => {
  it("leaves everything unenforced when nothing is configured", () => {
    const { limits, problems } = resolveLimits(BLANK);
    expect(problems).toEqual([]);
    expect(isFullyUnlimited(limits)).toBe(true);
    expect(needsLoadSampling(limits)).toBe(false);
  });

  it("reports every bad setting but still enforces the good ones", () => {
    // The important property: one typo must not disable the limits that do
    // parse, and must not throw — a throwing gate fails every dispatch.
    const { limits, problems } = resolveLimits({
      ...BLANK,
      maxConcurrentThreads: "4",
      maxConcurrentThreadsPerHost: "two",
      maxHostCpuPercent: "300",
    });
    expect(limits.global).toBe(4);
    expect(limits.perHost).toBeNull();
    expect(limits.maxCpuPercent).toBeNull();
    expect(problems).toHaveLength(2);
    expect(problems.join(" ")).toContain("per host");
  });

  it("asks for load sampling only when a threshold is set", () => {
    expect(
      needsLoadSampling(
        resolveLimits({ ...BLANK, maxConcurrentThreads: "4" }).limits,
      ),
    ).toBe(false);
    expect(
      needsLoadSampling(
        resolveLimits({ ...BLANK, maxHostMemoryPercent: "90" }).limits,
      ),
    ).toBe(true);
  });
});
