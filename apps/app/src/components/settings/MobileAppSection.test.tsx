// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { sdk } from "@/lib/sdk";
import { MobileAppSection } from "./MobileAppSection";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderSection() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MobileAppSection />
    </QueryClientProvider>,
  );
}

it("shows Android release details and keeps iOS version information in TestFlight", async () => {
  vi.spyOn(sdk.system, "mobileAppReleases").mockResolvedValue({
    android: {
      version: "0.39.0",
      versionCode: 4,
      size: 147311657,
      sha256: "a".repeat(64),
      updatedAt: "2026-09-29T19:28:00Z",
    },
  });
  renderSection();
  await screen.findByText("0.39.0 (build 4)");
  expect(screen.getByText("141 MB")).toBeTruthy();
  expect(
    screen.getByText(/Version and release date are shown in TestFlight/),
  ).toBeTruthy();
  expect(document.querySelector("time")?.getAttribute("datetime")).toBe(
    "2026-09-29T19:28:00Z",
  );
});

it("keeps both install links available when release metadata cannot be loaded", async () => {
  vi.spyOn(sdk.system, "mobileAppReleases").mockRejectedValue(
    new Error("offline"),
  );
  renderSection();
  await screen.findByText(/Release details are unavailable/);
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
