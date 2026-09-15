import { describe, expect, it, vi } from "vitest";
import { clampDialogContentHeight } from "../src/desktop-dialog-window.js";

vi.mock("electron", () => ({
  BrowserWindow: class {},
  screen: { getDisplayMatching: () => ({ workAreaSize: { height: 0 } }) },
}));

const TALL_WORK_AREA = 1_080;

describe("clampDialogContentHeight", () => {
  it("keeps the whole dialog visible when the display has room", () => {
    expect(
      clampDialogContentHeight({
        contentHeight: 273,
        workAreaHeight: TALL_WORK_AREA,
      }),
    ).toBe(273);
  });

  it("rounds fractional content up so the last row is not cut off", () => {
    expect(
      clampDialogContentHeight({
        contentHeight: 272.4,
        workAreaHeight: TALL_WORK_AREA,
      }),
    ).toBe(273);
  });

  it("clamps to the work area so the dialog never runs off a short display", () => {
    expect(
      clampDialogContentHeight({ contentHeight: 900, workAreaHeight: 600 }),
    ).toBe(520);
  });

  it("keeps a usable height when the work area is smaller than the margin", () => {
    expect(
      clampDialogContentHeight({ contentHeight: 900, workAreaHeight: 60 }),
    ).toBe(120);
  });

  it("never shrinks below the minimum height", () => {
    expect(
      clampDialogContentHeight({
        contentHeight: 10,
        workAreaHeight: TALL_WORK_AREA,
      }),
    ).toBe(120);
  });
});
