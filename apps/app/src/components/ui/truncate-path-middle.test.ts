import { describe, expect, it } from "vitest";
import { splitPathForMiddleTruncation } from "./truncate-path-middle";

describe("splitPathForMiddleTruncation", () => {
  it.each([
    [
      "~/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_abc-1/bb",
      "~/.bb/plugins/environment-git-worktree/host-data/worktrees",
      "/thr_abc-1/bb",
    ],
    ["~/Code/bb", "~", "/Code/bb"],
    ["/tmp/qa/external-root", "/tmp", "/qa/external-root"],
    ["C:\\Users\\me\\Code\\bb", "C:\\Users\\me", "\\Code\\bb"],
  ])("keeps the last two segments of %s", (path, head, tail) => {
    expect(splitPathForMiddleTruncation(path)).toEqual({ head, tail });
  });

  it.each(["/workspace", "/repo/bb", "bb", "~"])(
    "keeps %s whole when it has no head to shorten",
    (path) => {
      expect(splitPathForMiddleTruncation(path)).toEqual({
        head: "",
        tail: path,
      });
    },
  );
});
