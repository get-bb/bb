import { describe, expect, it } from "vitest";
import {
  encodeProviderValue,
  encodeWorktreePathValue,
  parseEnvironmentValue,
} from "./environment-picker-value";

describe("provider environment values", () => {
  it("round-trips a provider id containing dashes", () => {
    const value = encodeProviderValue("docker-sandbox");
    expect(value).toBe("provider:docker-sandbox");
    expect(parseEnvironmentValue(value)).toEqual({
      type: "provider",
      environmentProviderId: "docker-sandbox",
    });
  });

  it("round-trips provider ids with underscores and digits", () => {
    const value = encodeProviderValue("wt_2");
    expect(parseEnvironmentValue(value)).toEqual({
      type: "provider",
      environmentProviderId: "wt_2",
    });
  });

  it("rejects malformed provider values", () => {
    expect(parseEnvironmentValue("provider:")).toBeNull();
    expect(parseEnvironmentValue("provider:a/b")).toBeNull();
    expect(parseEnvironmentValue("provider:bad*id")).toBeNull();
    expect(parseEnvironmentValue(`provider:${"a".repeat(65)}`)).toBeNull();
  });
});

describe("worktree-path picker values", () => {
  it.each([
    ["/Users/dev/worktrees/feature"],
    ["/tmp/path with spaces"],
    ["/tmp/colon:separated:path"],
    ["/tmp/unicode/wörk trée/日本語"],
    ["/tmp/percent%20literal%3A"],
    ["C:\\Users\\dev\\worktree"],
  ])("round-trips %s", (canonicalPath) => {
    const value = encodeWorktreePathValue("host:with:colons", canonicalPath);
    expect(parseEnvironmentValue(value)).toEqual({
      type: "worktree-path",
      hostId: "host:with:colons",
      canonicalPath,
    });
  });

  it("rejects malformed path values", () => {
    expect(parseEnvironmentValue("path:")).toBeNull();
    expect(parseEnvironmentValue("path:onlyhost")).toBeNull();
    expect(parseEnvironmentValue("path:host:one:extra")).toBeNull();
    expect(parseEnvironmentValue("path::")).toBeNull();
    expect(parseEnvironmentValue("path:%:X")).toBeNull();
  });

  it("keeps reuse values parsing unchanged", () => {
    expect(parseEnvironmentValue("reuse:env-1")).toEqual({
      type: "reuse",
      environmentId: "env-1",
    });
    expect(parseEnvironmentValue("reuse")).toEqual({
      type: "reuse",
      environmentId: null,
    });
  });
});
