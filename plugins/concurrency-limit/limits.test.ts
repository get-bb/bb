import { describe, expect, it } from "vitest";
import { automaticHostLimit, resolveHostLimit } from "./limits.js";

describe("automaticHostLimit", () => {
  it.each([
    [null, 1],
    [1, 1],
    [2, 1],
    [4, 2],
    [8, 4],
    [16, 8],
    [32, 8],
  ])("maps %s available processors to %s threads", (processors, limit) => {
    expect(automaticHostLimit(processors)).toBe(limit);
  });
});

describe("resolveHostLimit", () => {
  it("uses each host's detected automatic limit by default", () => {
    const configuration = { globalLimit: null, hostOverrides: [] };

    expect(resolveHostLimit(configuration, "host-a", 8)).toEqual({
      limit: 4,
      mode: "automatic",
    });
    expect(resolveHostLimit(configuration, "host-b", 16)).toEqual({
      limit: 8,
      mode: "automatic",
    });
  });

  it("uses an explicit host override, including zero", () => {
    const configuration = {
      globalLimit: null,
      hostOverrides: [{ hostId: "host-a", limit: 0 }],
    };

    expect(resolveHostLimit(configuration, "host-a", 16)).toEqual({
      limit: 0,
      mode: "override",
    });
  });
});
