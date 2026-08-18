import { describe, expect, it } from "vitest";
import {
  LINUX_FRAMELESS_WINDOW_ARGUMENT,
  shouldUseLinuxFramelessWindow,
} from "../src/desktop-window-frame.js";

describe("desktop window frame", () => {
  it("enables frameless windows on Linux when requested", () => {
    expect(
      shouldUseLinuxFramelessWindow({
        argv: ["bb-nightly", LINUX_FRAMELESS_WINDOW_ARGUMENT],
        platform: "linux",
      }),
    ).toBe(true);
  });

  it("keeps the native Linux frame by default", () => {
    expect(
      shouldUseLinuxFramelessWindow({
        argv: ["bb-nightly"],
        platform: "linux",
      }),
    ).toBe(false);
  });

  it("ignores the Linux-only option on macOS and Windows", () => {
    for (const platform of ["darwin", "win32"] as const) {
      expect(
        shouldUseLinuxFramelessWindow({
          argv: ["bb", LINUX_FRAMELESS_WINDOW_ARGUMENT],
          platform,
        }),
      ).toBe(false);
    }
  });
});
