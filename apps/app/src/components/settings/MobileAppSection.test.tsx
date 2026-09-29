// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { sdk } from "@/lib/sdk";
import { MemoryRouter } from "react-router-dom";
import {
  setPluginSlotRegistrations,
  resetPluginSlotStoreForTest,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { PluginSettingsSections } from "@/components/plugin/PluginSettingsSections";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { MobileAppSection } from "./MobileAppSection";

beforeEach(() => {
  vi.spyOn(sdk.system, "config").mockResolvedValue(makeSystemConfig());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetPluginSlotStoreForTest();
});

function renderSection() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <MobileAppSection />
        <section aria-label="Plugin settings">
          <PluginSettingsSections pluginId="connection" />
        </section>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("shows Android release details and links to the TestFlight app", async () => {
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
    screen.getByRole("link", { name: "TestFlight" }).getAttribute("href"),
  ).toBe("https://apps.apple.com/app/testflight/id899247664");
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

it("renders connection plugins only on their chosen page and removes disabled registrations", async () => {
  vi.spyOn(sdk.system, "mobileAppReleases").mockResolvedValue({
    android: null,
  });
  setPluginSlotRegistrations(
    "connection",
    makePluginRegistrationSet({
      settingsSections: [
        { id: "manage", component: () => <p>Manage the connection</p> },
        {
          id: "pair",
          experimental_page: "mobile",
          component: () => <button>Pair this phone</button>,
        },
      ],
    }),
  );
  vi.mocked(sdk.system.config).mockResolvedValue(
    makeSystemConfig({
      serverAccess: {
        providers: [],
        defaultProviderId: "direct",
        effectiveUrl: "https://bb.example.ts.net",
        urlSource: "setting",
      },
    }),
  );
  const updateSettings = vi.spyOn(sdk.system, "updateGeneralSettings");
  renderSection();
  const mobile = within(
    screen.getByRole("region", { name: "Mobile app downloads" }),
  );
  const plugin = within(
    screen.getByRole("region", { name: "Plugin settings" }),
  );
  expect(mobile.getByRole("button", { name: "Pair this phone" })).toBeTruthy();
  expect(mobile.queryByText("Manage the connection")).toBeNull();
  expect(plugin.getByText("Manage the connection")).toBeTruthy();
  expect(plugin.queryByRole("button", { name: "Pair this phone" })).toBeNull();
  fireEvent.pointerDown(
    mobile.getByRole("button", { name: "Connection method" }),
    { button: 0, ctrlKey: false },
  );
  fireEvent.click(await screen.findByRole("menuitem", { name: "Direct" }));
  await mobile.findByText("https://bb.example.ts.net");
  expect(mobile.getByRole("button", { name: "Copy URL" })).toBeTruthy();
  expect(mobile.queryByRole("button", { name: "Pair this phone" })).toBeNull();
  expect(updateSettings).not.toHaveBeenCalled();
  act(() =>
    setPluginSlotRegistrations("connection", makePluginRegistrationSet()),
  );
  expect(mobile.queryByRole("button", { name: "Pair this phone" })).toBeNull();
  expect(
    mobile.getByRole("link", { name: "Download Android APK" }),
  ).toBeTruthy();
  await screen.findByText(/Release details are unavailable/);
});
