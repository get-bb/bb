import { describe, expect, it } from "vitest";
import {
  createHapticsPreferenceStore,
  HAPTICS_ENABLED_STORAGE_KEY,
  hapticKindForButton,
  parseHapticsEnabled,
  resolveHapticCall,
  type HapticKind,
} from "./haptics-policy";

const EVERY_KIND: HapticKind[] = [
  "selection",
  "impact-light",
  "impact-medium",
  "impact-heavy",
  "success",
  "warning",
  "error",
];

describe("resolveHapticCall", () => {
  it("returns null for every kind when haptics are off", () => {
    for (const kind of EVERY_KIND) {
      expect(resolveHapticCall(false, kind)).toBeNull();
    }
  });

  it("maps semantic kinds onto the three expo-haptics methods", () => {
    expect(resolveHapticCall(true, "selection")).toEqual({
      method: "selection",
    });
    expect(resolveHapticCall(true, "impact-medium")).toEqual({
      method: "impact",
      style: "medium",
    });
    expect(resolveHapticCall(true, "warning")).toEqual({
      method: "notification",
      type: "warning",
    });
  });
});

describe("parseHapticsEnabled", () => {
  it("defaults to enabled and only the literal false disables", () => {
    expect(parseHapticsEnabled(undefined)).toBe(true);
    expect(parseHapticsEnabled("true")).toBe(true);
    expect(parseHapticsEnabled("garbage")).toBe(true);
    expect(parseHapticsEnabled("false")).toBe(false);
  });
});

describe("hapticKindForButton", () => {
  it("treats the bare boolean as a light impact", () => {
    expect(hapticKindForButton(true)).toBe("impact-light");
    expect(hapticKindForButton("selection")).toBe("selection");
    expect(hapticKindForButton("heavy")).toBe("impact-heavy");
  });
});

describe("createHapticsPreferenceStore", () => {
  it("reads the stored value, persists changes and notifies once per change", () => {
    const backing = new Map<string, string>([
      [HAPTICS_ENABLED_STORAGE_KEY, "false"],
    ]);
    const store = createHapticsPreferenceStore({
      getString: (key) => backing.get(key),
      set: (key, value) => backing.set(key, value),
    });
    expect(store.isEnabled()).toBe(false);
    let notified = 0;
    const unsubscribe = store.subscribe(() => {
      notified += 1;
    });
    store.setEnabled(false);
    expect(notified).toBe(0);
    store.setEnabled(true);
    expect(notified).toBe(1);
    expect(backing.get(HAPTICS_ENABLED_STORAGE_KEY)).toBe("true");
    unsubscribe();
    store.setEnabled(false);
    expect(notified).toBe(1);
    expect(store.isEnabled()).toBe(false);
  });
});
