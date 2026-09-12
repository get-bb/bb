import { describe, expect, it } from "vitest";
import {
  hasLinuxWindowArgument,
  LINUX_FRAMELESS_WINDOW_ARGUMENT,
  LINUX_TRANSPARENT_WINDOW_ARGUMENT,
} from "../src/desktop-linux-window-options.js";

describe.each([
  {
    argument: LINUX_FRAMELESS_WINDOW_ARGUMENT,
    otherArgument: LINUX_TRANSPARENT_WINDOW_ARGUMENT,
  },
  {
    argument: LINUX_TRANSPARENT_WINDOW_ARGUMENT,
    otherArgument: LINUX_FRAMELESS_WINDOW_ARGUMENT,
  },
])("desktop Linux window option $argument", ({ argument, otherArgument }) => {
  it("enables the option on Linux when requested", () => {
    expect(
      hasLinuxWindowArgument({
        argument,
        argv: ["bb-nightly", argument],
        platform: "linux",
      }),
    ).toBe(true);
  });

  it("keeps the option off on Linux unless its own argument is passed", () => {
    expect(
      hasLinuxWindowArgument({
        argument,
        argv: ["bb-nightly", otherArgument],
        platform: "linux",
      }),
    ).toBe(false);
  });

  it("ignores the Linux-only option on macOS and Windows", () => {
    for (const platform of ["darwin", "win32"] as const) {
      expect(
        hasLinuxWindowArgument({
          argument,
          argv: ["bb", argument],
          platform,
        }),
      ).toBe(false);
    }
  });
});
