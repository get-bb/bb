import { WorkspaceError } from "bb-environment-provider-host/git";
import { describe, expect, it } from "vitest";
import {
  deriveRepoDirName,
  resolveWorktreeAttemptRoot,
  resolveWorktreeChildPath,
  resolveWorktreeTargetPath,
} from "./paths.js";

describe("deriveRepoDirName", () => {
  it.each([
    ["local absolute path", "/Users/someone/code/my-repo", "my-repo"],
    [
      "local path with trailing slash",
      "/Users/someone/code/my-repo/",
      "my-repo",
    ],
    ["dotted name", "/Users/me/code/my.repo", "my.repo"],
    ["hidden name", "/Users/me/code/.my-repo", ".my-repo"],
    [
      "local path with .git suffix",
      "/Users/me/code/Hello-World.git",
      "Hello-World",
    ],
  ])("derives %s", (_label, input, expected) => {
    expect(deriveRepoDirName(input)).toBe(expected);
  });

  it.each([
    [
      "spaces",
      "/Users/me/code/Repo With Space",
      "Repo-With-Space-7373994537587106",
    ],
    ["CJK", "/Users/me/code/資料庫", "repo-1b2c8c90d27707c4"],
    ["NFC", "/Users/me/code/café", "cafe-850f7dc43910ff89"],
    ["NFD", "/Users/me/code/cafe\u0301", "cafe-81ef060bcd98adc7"],
    ["punctuation only", "/Users/me/code/!!!", "repo-e84c538e7fe25073"],
    ["leading dash", "/tmp/-dangerous", "dangerous-21348db0a63c4ab7"],
    ["Windows reserved name", "C:\\code\\CON", "repo-CON-a3dbc4b644a9a2c5"],
    [
      "Windows reserved name with extension",
      "C:\\code\\CON.txt",
      "repo-CON.txt-09c8cc7edcae01ac",
    ],
    ["Windows trailing dot", "/tmp/repo.", "repo-d8be5b194ca4e1f3"],
  ])("slugifies %s with stable identity", (_label, input, expected) => {
    expect(deriveRepoDirName(input)).toBe(expected);
  });

  it("keeps normalization and punctuation collisions distinct", () => {
    expect(deriveRepoDirName("/tmp/café")).not.toBe(
      deriveRepoDirName("/tmp/cafe\u0301"),
    );
    expect(deriveRepoDirName("/tmp/a b")).not.toBe(
      deriveRepoDirName("/tmp/a-b"),
    );
  });

  it("caps long generated names below platform filename limits", () => {
    const original = "repository".repeat(30);
    const derived = deriveRepoDirName(`/tmp/${original}`);
    expect(Buffer.byteLength(derived, "utf8")).toBe(200);
    expect(derived).toMatch(/-[a-f0-9]{16}$/u);
    expect(deriveRepoDirName(`/tmp/${original}`)).toBe(derived);
  });

  it.each([
    ["root-only path", "/"],
    ["empty string", ""],
    ["bare .git", "/Users/me/code/.git"],
    ["parent traversal", "/Users/me/code/.."],
    ["current dir", "/Users/me/code/."],
    ["relative path", "my repo"],
    ["control character", "/tmp/my\nrepo"],
    ["URL-like input", "https://host/foo/bar.git;param=x"],
  ])("rejects %s", (_label, input) => {
    expect(() => deriveRepoDirName(input)).toThrowError(WorkspaceError);
  });
});

describe("managed worktree paths", () => {
  it("keeps derived targets inside their validated attempt root", () => {
    expect(
      resolveWorktreeTargetPath({
        dataDir: "/Users/me/.bb/plugin-data",
        pathKey: "thr_123-2",
        sourcePath: "/Users/me/code/Repo With Space",
      }),
    ).toBe(
      "/Users/me/.bb/plugin-data/worktrees/thr_123-2/Repo-With-Space-7373994537587106",
    );
  });

  it.each(["", ".", "..", "../escape", "nested/path", "nested\\path", "-flag"])(
    "rejects unsafe path key %j",
    (pathKey) => {
      expect(() =>
        resolveWorktreeAttemptRoot({ dataDir: "/tmp/data", pathKey }),
      ).toThrowError(WorkspaceError);
    },
  );

  it("accepts only safe discovered child segments", () => {
    expect(
      resolveWorktreeChildPath({
        dataDir: "/tmp/data",
        pathKey: "thr_123",
        childName: "repo-0123456789abcdef",
      }),
    ).toBe("/tmp/data/worktrees/thr_123/repo-0123456789abcdef");
    for (const childName of [
      ".",
      "..",
      "../escape",
      "nested/path",
      "bad name",
    ]) {
      expect(() =>
        resolveWorktreeChildPath({
          dataDir: "/tmp/data",
          pathKey: "thr_123",
          childName,
        }),
      ).toThrowError(WorkspaceError);
    }
  });
});
