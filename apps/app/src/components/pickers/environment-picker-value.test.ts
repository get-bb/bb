import { describe, expect, it } from "vitest";
import {
  encodeWorktreePathValue,
  parseEnvironmentValue,
} from "./environment-picker-value";

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

  it("keeps existing host and reuse values parsing unchanged", () => {
    expect(parseEnvironmentValue("host:h1:local")).toEqual({
      type: "host",
      hostId: "h1",
      mode: "local",
    });
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
