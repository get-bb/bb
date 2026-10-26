import { describe, expect, it, vi } from "vitest";
import { createAppPanelController } from "@/lib/app-fixed-tab-navigation";
import {
  createGitDiffFixedTabDestination,
  GIT_DIFF_FIXED_TAB_REFERENCE,
} from "./git-diff-fixed-tab-navigation";

describe("createGitDiffFixedTabDestination", () => {
  it("routes core Changes targets through the generic controller while the owner validates them", () => {
    const openCommit = vi.fn();
    const openFile = vi.fn();
    const openOrdinary = vi.fn();
    const destination = createGitDiffFixedTabDestination({
      eligible: true,
      openCommit,
      openFile,
      openOrdinary,
    });

    const panel = createAppPanelController(() => ({
      activeTabId: null,
      close: vi.fn(),
      destinations: [{ ...destination, panelTabId: () => "diff" }],
    }));
    const open = (
      target?: { kind: "file"; path: string } | { kind: "commit"; sha: string },
    ) =>
      panel.openTab({
        tab: GIT_DIFF_FIXED_TAB_REFERENCE,
        availability: "fixed",
        ...(target === undefined ? {} : { target }),
      });

    expect(open({ kind: "file", path: "src/app.tsx" })).toBe(true);
    expect(open({ kind: "commit", sha: "abc123" })).toBe(true);
    expect(open({ kind: "file", path: "" })).toBe(false);
    expect(open()).toBe(true);
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
