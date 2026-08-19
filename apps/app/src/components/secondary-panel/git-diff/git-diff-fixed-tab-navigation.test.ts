import { describe, expect, it, vi } from "vitest";
import { createGitDiffFixedTabDestination } from "./git-diff-fixed-tab-navigation";

describe("createGitDiffFixedTabDestination", () => {
  it("owns file and commit target validation outside the generic controller", () => {
    const openCommit = vi.fn();
    const openFile = vi.fn();
    const openOrdinary = vi.fn();
    const destination = createGitDiffFixedTabDestination({
      eligible: true,
      openCommit,
      openFile,
      openOrdinary,
    });

    expect(destination.open({ kind: "file", path: "src/app.tsx" })).toBe(true);
    expect(destination.open({ kind: "commit", sha: "abc123" })).toBe(true);
    expect(destination.open({ kind: "file", path: "" })).toBe(false);
    expect(destination.open(undefined)).toBe(true);
    expect(openFile).toHaveBeenCalledWith("src/app.tsx");
    expect(openCommit).toHaveBeenCalledWith("abc123");
    expect(openOrdinary).toHaveBeenCalledOnce();
  });

  it("declines every target while Changes is ineligible", () => {
    const openOrdinary = vi.fn();
    const destination = createGitDiffFixedTabDestination({
      eligible: false,
      openCommit: vi.fn(),
      openFile: vi.fn(),
      openOrdinary,
    });
    expect(destination.open(undefined)).toBe(false);
    expect(openOrdinary).not.toHaveBeenCalled();
  });
});
