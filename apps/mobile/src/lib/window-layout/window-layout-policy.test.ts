import { describe, expect, it } from "vitest";
import {
  createStatusBarPreferenceStore,
  parseNativeWindowLayout,
  parseStatusBarPlacement,
  showsStatusBarSetting,
  STATUS_BAR_PLACEMENT_STORAGE_KEY,
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
const NO_BAR = {
  verticalBarEdge: "none",
  verticalBarBehavior: "automatic",
  occlusions: [],
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

describe("showsStatusBarSetting", () => {
  it("offers the setting on iOS where the window has a vertical bar", () => {
    expect(
      showsStatusBarSetting({
        platform: "ios",
        placement: "system",
        layout: parseNativeWindowLayout(COVER_BAR_ON),
      }),
    ).toBe(true);
  });

  it("keeps it visible while on, since a disabled bar reports no edge", () => {
    expect(
      showsStatusBarSetting({
        platform: "ios",
        placement: "top",
        layout: parseNativeWindowLayout(COVER_BAR_OFF),
      }),
    ).toBe(true);
  });

  it("hides it on windows without a bar, before the first layout, and off iOS", () => {
    for (const input of [
      {
        platform: "ios",
        placement: "system",
        layout: parseNativeWindowLayout(NO_BAR),
      },
      { platform: "ios", placement: "system", layout: null },
      {
        platform: "android",
        placement: "top",
        layout: parseNativeWindowLayout(COVER_BAR_ON),
      },
    ] as const) {
      expect(showsStatusBarSetting(input), JSON.stringify(input)).toBe(false);
    }
  });
});

describe("status bar placement preference", () => {
  it("defaults to the system placement for anything but the stored top choice", () => {
    expect(parseStatusBarPlacement(undefined)).toBe("system");
    expect(parseStatusBarPlacement("garbage")).toBe("system");
    expect(parseStatusBarPlacement("system")).toBe("system");
    expect(parseStatusBarPlacement("top")).toBe("top");
  });

  it("persists changes and notifies once per change", () => {
    const backing = new Map<string, string>();
    const store = createStatusBarPreferenceStore({
      getString: (key) => backing.get(key),
      set: (key, value) => backing.set(key, value),
    });
    expect(store.placement()).toBe("system");
    let notified = 0;
    const unsubscribe = store.subscribe(() => {
      notified += 1;
    });
    store.setPlacement("system");
    expect(notified).toBe(0);
    store.setPlacement("top");
    expect(notified).toBe(1);
    expect(backing.get(STATUS_BAR_PLACEMENT_STORAGE_KEY)).toBe("top");
    unsubscribe();
    store.setPlacement("system");
    expect(notified).toBe(1);
  });
});
