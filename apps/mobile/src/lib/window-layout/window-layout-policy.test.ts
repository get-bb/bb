import { describe, expect, it } from "vitest";
import {
  parseNativeWindowLayout,
  windowLayoutKey,
} from "./window-layout-policy";

const COVER_BAR_ON = {
  verticalBarEdge: "trailing",
  verticalBarBehavior: "automatic",
  occlusions: [
    { x: 399.67, y: 29.33, width: 37, height: 37 },
    { x: 382, y: 0, width: 84, height: 174 },
  ],
};
const COVER_BAR_OFF = {
  verticalBarEdge: "none",
  verticalBarBehavior: "disabled",
  occlusions: [
    { x: 399.67, y: 29.33, width: 37, height: 37 },
    { x: 266, y: 0, width: 200, height: 82 },
  ],
};
describe("parseNativeWindowLayout", () => {
  it("maps the native payload onto the bridge's window layout", () => {
    expect(parseNativeWindowLayout(COVER_BAR_OFF)).toEqual({
      verticalBar: { edge: "none", behavior: "disabled" },
      occlusions: COVER_BAR_OFF.occlusions,
    });
  });

  it("rejects a payload the bridge could not carry", () => {
    expect(parseNativeWindowLayout(null)).toBeNull();
    expect(
      parseNativeWindowLayout({ ...COVER_BAR_ON, verticalBarEdge: "top" }),
    ).toBeNull();
    expect(
      parseNativeWindowLayout({ ...COVER_BAR_ON, occlusions: undefined }),
    ).toBeNull();
  });

  it("keys equal layouts equally so repeated native events do not resend", () => {
    expect(windowLayoutKey(parseNativeWindowLayout(COVER_BAR_ON))).toBe(
      windowLayoutKey(parseNativeWindowLayout({ ...COVER_BAR_ON })),
    );
    expect(windowLayoutKey(parseNativeWindowLayout(COVER_BAR_ON))).not.toBe(
      windowLayoutKey(parseNativeWindowLayout(COVER_BAR_OFF)),
    );
    expect(windowLayoutKey(null)).toBe("");
  });
});
