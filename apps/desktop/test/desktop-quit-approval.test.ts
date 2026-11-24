import { describe, expect, it } from "vitest";
import { createDesktopQuitApproval } from "../src/desktop-quit-approval.js";

describe("desktop quit approval", () => {
  it("only skips a second prompt after the approved window actually closes", () => {
    const approval = createDesktopQuitApproval();
    let destroyed = false;
    approval.approve({ isDestroyed: () => destroyed });
    expect(approval.hasClosedApprovedWindow()).toBe(false);
    destroyed = true;
    expect(approval.hasClosedApprovedWindow()).toBe(true);
    approval.clear();
    expect(approval.hasClosedApprovedWindow()).toBe(false);
  });

  it("does not reuse approval after a replacement window is opened", () => {
    const approval = createDesktopQuitApproval();
    approval.approve({ isDestroyed: () => true });
    approval.clear();
    approval.approve({ isDestroyed: () => false });
    expect(approval.hasClosedApprovedWindow()).toBe(false);
  });
});
