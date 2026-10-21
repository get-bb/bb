import { describe, expect, it, vi } from "vitest";
import { gitDiffTab } from "bb-plugin-bb--git/tab-reference";
import {
  createValidatedFixedTabDestination,
  openAppFixedTabFromDestinations,
} from "@/lib/app-fixed-tab-navigation";
import { GIT_DIFF_FIXED_TAB_REFERENCE } from "./git-diff-fixed-tab-navigation";

describe("Git tab navigation through the registered target contract", () => {
  it("validates targets before selecting the tab and delivers accepted targets", () => {
    const select = vi.fn();
    const deliver = vi.fn();
    const destination = createValidatedFixedTabDestination({
      tab: GIT_DIFF_FIXED_TAB_REFERENCE,
      contract: gitDiffTab.experimental_target,
      select,
      deliver,
    });
    const open = (
      target?: { kind: "file"; path: string } | { kind: "commit"; sha: string },
    ) =>
      openAppFixedTabFromDestinations([destination], {
        surface: { kind: "current" },
        tab: GIT_DIFF_FIXED_TAB_REFERENCE,
        ...(target === undefined ? {} : { target }),
      });
    expect(open({ kind: "file", path: "src/app.tsx" })).toBe(true);
    expect(open({ kind: "commit", sha: "abc123" })).toBe(true);
    expect(open({ kind: "file", path: "" })).toBe(false);
    expect(open()).toBe(true);
    expect(deliver.mock.calls).toEqual([
      [{ kind: "file", path: "src/app.tsx" }],
      [{ kind: "commit", sha: "abc123" }],
    ]);
    expect(select).toHaveBeenCalledTimes(3);
  });
  it("declines navigation when no visible Git tab is registered", () => {
    expect(
      openAppFixedTabFromDestinations([], {
        surface: { kind: "current" },
        tab: GIT_DIFF_FIXED_TAB_REFERENCE,
      }),
    ).toBe(false);
  });
});
