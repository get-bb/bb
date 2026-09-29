// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MobileAppSection } from "./MobileAppSection";

afterEach(cleanup);

it("offers both mobile downloads without an experiment or preparation request", () => {
  render(<MobileAppSection />);
  expect(screen.queryByLabelText("Mobile app")).toBeNull();
  expect(screen.queryByLabelText("Android App")).toBeNull();
  expect(
    screen
      .getByRole("link", { name: "Join iOS TestFlight" })
      .getAttribute("href"),
  ).toBe("https://testflight.apple.com/join/T9MayTMb");
  expect(
    screen
      .getByRole("link", { name: "Download Android APK" })
      .getAttribute("href"),
  ).toBe(
    "https://github.com/get-bb/bb/releases/download/android-testing/bb-android.apk",
  );
  expect(screen.queryByText("Download ready APK")).toBeNull();
});
