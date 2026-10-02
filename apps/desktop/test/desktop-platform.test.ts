import { describe, expect, it } from "vitest";
import { resolveBbDesktopPlatform } from "../src/desktop-platform.js";

describe("resolveBbDesktopPlatform", () => {
  it("names each supported desktop platform", () => {
    expect(resolveBbDesktopPlatform("darwin")).toBe("macos");
    expect(resolveBbDesktopPlatform("linux")).toBe("linux");
    expect(resolveBbDesktopPlatform("win32")).toBe("windows");
  });
});
