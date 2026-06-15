import { describe, expect, it } from "vitest";
import {
  experimentsSchema,
  isValidElectronAccelerator,
} from "../src/experiments.js";

describe("experimentsSchema", () => {
  it("requires a bounded Electron accelerator with at least one modifier", () => {
    expect(isValidElectronAccelerator("Alt+Space")).toBe(true);
    expect(isValidElectronAccelerator("CommandOrControl+Shift+P")).toBe(true);
    expect(isValidElectronAccelerator("A")).toBe(false);
    expect(isValidElectronAccelerator("Space")).toBe(false);
    expect(isValidElectronAccelerator("Alt+")).toBe(false);
    expect(isValidElectronAccelerator(`Alt+${"A".repeat(100)}`)).toBe(false);

    expect(() =>
      experimentsSchema.parse({
        claudeCodeMockCliTraffic: false,
        popoutChat: true,
        popoutChatHotkey: "A",
      }),
    ).toThrow();
  });
});
