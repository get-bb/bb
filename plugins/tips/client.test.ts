import { describe, expect, it } from "vitest";
import {
  detectTipClient,
  hasNotificationNudge,
  type TipClientEnvironment,
} from "./client.js";

const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36";
const LINUX_FIREFOX =
  "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";

function environment(
  overrides: Partial<TipClientEnvironment>,
): TipClientEnvironment {
  return {
    bbDesktop: undefined,
    bb: undefined,
    userAgent: MAC_SAFARI,
    maxTouchPoints: 0,
    ...overrides,
  };
}

describe("detectTipClient", () => {
  it("reads the desktop app's platform", () => {
    expect(
      detectTipClient(
        environment({
          bbDesktop: { platform: "windows" },
          userAgent: WINDOWS_CHROME,
        }),
      ),
    ).toEqual({ surface: "desktop", os: "windows" });
  });

  it("recognizes the native mobile app", () => {
    expect(
      detectTipClient(
        environment({
          bb: { native: { platform: "android" } },
          userAgent: ANDROID_CHROME,
        }),
      ),
    ).toEqual({ surface: "mobile-app", os: "android" });
  });

  it.each([
    [MAC_SAFARI, 0, { surface: "web", os: "macos" }],
    [MAC_SAFARI, 5, { surface: "mobile-web", os: "ios" }],
    [WINDOWS_CHROME, 0, { surface: "web", os: "windows" }],
    [LINUX_FIREFOX, 0, { surface: "web", os: "linux" }],
    [ANDROID_CHROME, 5, { surface: "mobile-web", os: "android" }],
    ["Unknown agent", 0, { surface: "web", os: "unknown" }],
  ])("classifies the browser %s", (userAgent, maxTouchPoints, expected) => {
    expect(detectTipClient(environment({ userAgent, maxTouchPoints }))).toEqual(
      expected,
    );
  });

  it("ignores a window.bb object without a native bridge", () => {
    expect(detectTipClient(environment({ bb: { other: true } }))).toEqual({
      surface: "web",
      os: "macos",
    });
  });
});

describe("hasNotificationNudge", () => {
  it.each([
    ["default", "answered", true],
    ["default", "shown", false],
    ["default", null, false],
    ["granted", "answered", false],
    ["denied", "answered", false],
    [null, "answered", false],
  ])(
    "permission %s with the sidebar prompt %s gives %s",
    (permission, promptState, expected) => {
      expect(hasNotificationNudge({ permission, promptState })).toBe(expected);
    },
  );
});
