import { describe, expect, it } from "vitest";
import {
  LINUX_TRANSPARENT_WINDOW_ARGUMENT,
  shouldUseLinuxTransparentWindow,
} from "../src/desktop-window-transparency.js";

describe("desktop window transparency", () => {
  it("enables transparent windows on Linux when requested", () => {
    expect(
      shouldUseLinuxTransparentWindow({
        argv: ["bb", LINUX_TRANSPARENT_WINDOW_ARGUMENT],
        platform: "linux",
      }),
    ).toBe(true);
  });

  it("keeps Linux windows opaque by default", () => {
    expect(
      shouldUseLinuxTransparentWindow({
        argv: ["bb"],
        platform: "linux",
      }),
    ).toBe(false);
  });

  it("ignores the option on other platforms", () => {
    for (const platform of ["darwin", "win32"] as const) {
      expect(
        shouldUseLinuxTransparentWindow({
          argv: ["bb", LINUX_TRANSPARENT_WINDOW_ARGUMENT],
          platform,
        }),
      ).toBe(false);
    }
  });
});
