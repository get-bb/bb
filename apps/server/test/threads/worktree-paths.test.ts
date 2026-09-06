import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/errors.js";
import { deriveRepoDirName } from "../../src/services/threads/worktree-paths.js";

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
    ["windows absolute path", String.raw`C:\Users\me\code\my-repo`, "my-repo"],
    [
      "windows path with trailing separator",
      "C:\\Users\\me\\code\\my-repo\\",
      "my-repo",
    ],
    ["unc path", String.raw`\\server\share\my-repo`, "my-repo"],
    ["whitespace in name", "/tmp/my repo", "my-repo"],
    [
      "whitespace in a windows name",
      String.raw`C:\Users\me\Muse Playground`,
      "Muse-Playground",
    ],
    ["run of unsafe characters", "/tmp/my  weird   repo", "my-weird-repo"],
    ["non-ascii name", String.raw`C:\proyectos\diseño`, "dise-o"],
    ["leading dash is dropped, not rejected", "/tmp/-dangerous", "dangerous"],
    [
      "url with query parameter encoded into basename",
      "https://host/foo/bar.git;param=x",
      "bar.git-param-x",
    ],
  ])("derives %s", (_label, input, expected) => {
    expect(deriveRepoDirName(input)).toBe(expected);
  });

  it.each([
    ["root-only path", "/"],
    ["empty string", ""],
    ["bare .git", "/Users/me/code/.git"],
    ["parent traversal", "/Users/me/code/.."],
    ["current dir", "/Users/me/code/."],
    ["windows drive root", "C:\\"],
    ["a name with nothing safe left", "/tmp/   "],
  ])("rejects %s", (_label, input) => {
    expect(() => deriveRepoDirName(input)).toThrowError(ApiError);
  });
});
