import { describe, expect, it } from "vitest";
import {
  fitPathMiddle,
  splitPathForMiddleTruncation,
} from "./truncate-path-middle";

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

describe("fitPathMiddle", () => {
  const measure = (text: string) => text.length;
  const path = "~/.bb/plugins/worktrees/thr_abc-1/bb";

  it("keeps a path that fits", () => {
    expect(fitPathMiddle(path, path.length, measure)).toBe(path);
  });

  it("replaces whole middle segments with an ellipsis segment", () => {
    expect(fitPathMiddle(path, 28, measure)).toBe(
      "~/.bb/plugins/…/thr_abc-1/bb",
    );
    expect(fitPathMiddle(path, 22, measure)).toBe("~/.bb/…/thr_abc-1/bb");
  });

  it("keeps only the last segment once only the root is left", () => {
    expect(fitPathMiddle(path, 10, measure)).toBe("~/…/bb");
  });

  it("cuts the start of the last segment as a final fallback", () => {
    expect(fitPathMiddle("~/a/b/long-segment", 8, measure)).toBe("~/…gment");
  });

  it("keeps the root of paths outside home and on Windows", () => {
    expect(fitPathMiddle("/tmp/qa/run/external-root", 24, measure)).toBe(
      "/tmp/…/run/external-root",
    );
    expect(fitPathMiddle("/tmp/qa/run/external-root", 20, measure)).toBe(
      "/tmp/…/external-root",
    );
    expect(fitPathMiddle("C:\\Users\\me\\Code\\bb", 12, measure)).toBe(
      "C:\\…\\Code\\bb",
    );
  });

  it("start-truncates a path with no head to shorten", () => {
    expect(fitPathMiddle("/repo/very-long-name", 10, measure)).toBe(
      "…long-name",
    );
  });
});
