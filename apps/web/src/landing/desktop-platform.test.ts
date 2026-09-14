import { describe, expect, it } from "vitest";

import { detectDesktopPlatform } from "./desktop-platform";

describe("detectDesktopPlatform", () => {
  it("prefers client hints when available", () => {
    expect(
      detectDesktopPlatform({
        platform: "Win32",
        userAgentData: { platform: "Linux" },
      }),
    ).toBe("linux");
  });

  it("detects a Linux desktop from navigator.platform", () => {
    expect(
      detectDesktopPlatform({
        platform: "Linux x86_64",
        userAgent: "Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0",
      }),
    ).toBe("linux");
  });

  it("does not treat Android or ChromeOS as Linux desktops", () => {
    expect(
      detectDesktopPlatform({
        platform: "Linux armv8l",
        userAgent: "Mozilla/5.0 (Linux; Android 15) Chrome/140.0",
      }),
    ).toBeNull();
    expect(
      detectDesktopPlatform({
        platform: "Linux x86_64",
        userAgent: "Mozilla/5.0 (X11; CrOS x86_64 16000.0.0) Chrome/140.0",
      }),
    ).toBeNull();
  });

  it("detects macOS but not iOS devices reporting MacIntel", () => {
    expect(
      detectDesktopPlatform({
        platform: "MacIntel",
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) Safari",
      }),
    ).toBe("macos");
    expect(
      detectDesktopPlatform({
        platform: "MacIntel",
        userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) Safari",
      }),
    ).toBeNull();
  });

  it("returns null for Windows so the default platform stays in place", () => {
    expect(
      detectDesktopPlatform({
        platform: "Win32",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0",
      }),
    ).toBeNull();
    expect(detectDesktopPlatform({})).toBeNull();
  });
});
