import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/errors.js";
import {
  allocateCapitalCityWorktreeName,
  deriveRepoDirName,
  resolveManagedTargetPath,
} from "../../src/services/threads/worktree-paths.js";

describe("deriveRepoDirName", () => {
  it.each([
    ["local absolute path", "/Users/someone/code/my-repo", "my-repo"],
    [
      "local path with trailing slash",
      "/Users/someone/code/my-repo/",
      "my-repo",
    ],
    ["https URL", "https://github.com/octocat/Hello-World.git", "Hello-World"],
    ["ssh URL", "ssh://git@github.com/octocat/Hello-World.git", "Hello-World"],
    ["scp-style", "git@github.com:octocat/Hello-World.git", "Hello-World"],
    [
      "scp-style without .git",
      "git@github.com:octocat/Hello-World",
      "Hello-World",
    ],
    ["dotted name", "/Users/me/code/my.repo", "my.repo"],
  ])("derives %s", (_label, input, expected) => {
    expect(deriveRepoDirName(input)).toBe(expected);
  });

  it.each([
    ["root-only path", "/"],
    ["empty string", ""],
    ["bare .git", "/Users/me/code/.git"],
    ["parent traversal", "/Users/me/code/.."],
    ["current dir", "/Users/me/code/."],
    ["leading dash (could be interpreted as flag)", "/tmp/-dangerous"],
    ["whitespace in name", "/tmp/my repo"],
    [
      "url with query parameter encoded into basename",
      "https://host/foo/bar.git;param=x",
    ],
  ])("rejects %s", (_label, input) => {
    expect(() => deriveRepoDirName(input)).toThrowError(ApiError);
  });
});

describe("allocateCapitalCityWorktreeName", () => {
  it("returns a stable capital-city name for the same seed", () => {
    const first = allocateCapitalCityWorktreeName({
      seed: "thr_abc123",
      usedNames: [],
    });
    const second = allocateCapitalCityWorktreeName({
      seed: "thr_abc123",
      usedNames: [],
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-z]+(?:-[a-z]+)*$/u);
  });

  it("selects another city when the preferred name is already in use", () => {
    const preferred = allocateCapitalCityWorktreeName({
      seed: "thr_abc123",
      usedNames: [],
    });

    expect(
      allocateCapitalCityWorktreeName({
        seed: "thr_abc123",
        usedNames: [preferred],
      }),
    ).not.toBe(preferred);
  });

  it("uses a numeric suffix when all capital names are in use", () => {
    expect(
      allocateCapitalCityWorktreeName({
        seed: "thr_abc123",
        usedNames: ["perth", "perth-2"],
        capitalNames: ["perth"],
      }),
    ).toBe("perth-3");
  });
});

describe("resolveManagedTargetPath", () => {
  it("uses the capital-city identity as the worktree directory", () => {
    expect(
      resolveManagedTargetPath({
        dataDir: "/var/lib/bb",
        worktreeName: "wellington",
        sourcePath: "https://github.com/example/bb.git",
      }),
    ).toBe("/var/lib/bb/worktrees/wellington/bb");
  });
});
