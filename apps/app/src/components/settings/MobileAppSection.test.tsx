// @vitest-environment jsdom
import {
  PluginSettingsSections,
  PluginMobileSettingsSections,
} from "@/components/plugin/PluginSettingsSections";
import {
  setPluginSlotRegistrations,
  resetPluginSlotStoreForTest,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { sdk } from "@/lib/sdk";
import { MemoryRouter } from "react-router-dom";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { MobileAppSection } from "./MobileAppSection";

beforeEach(() => {
  vi.spyOn(sdk.system, "config").mockResolvedValue(makeSystemConfig());
});

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  vi.restoreAllMocks();
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

it("places mobile plugin sections only on Mobile and removes them when unregistered", async () => {
  vi.spyOn(sdk.system, "mobileAppReleases").mockResolvedValue({
    android: null,
  });
  setPluginSlotRegistrations(
    "connection",
    makePluginRegistrationSet({
      settingsSections: [
        {
          id: "pair",
          experimental_page: "mobile",
          component: () => <p>Pair this phone</p>,
        },
        { id: "manage", component: () => <p>Manage connection</p> },
      ],
    }),
  );
  vi.mocked(sdk.system.config).mockResolvedValue(
    makeSystemConfig({
      serverAccess: {
        defaultProviderId: "relay",
        effectiveUrl: null,
        urlSource: null,
        providers: [
          {
            id: "relay",
            displayName: "Relay",
            description: "Relay",
            pluginId: "connection",
            availability: { status: "available" },
          },
        ],
      },
    }),
  );
  renderSection();
  const plugin = render(
    <MemoryRouter>
      <PluginSettingsSections pluginId="connection" />
    </MemoryRouter>,
  );
  expect(await screen.findByText("Pair this phone")).toBeTruthy();
  expect(plugin.container.textContent).toContain("Manage connection");
  expect(plugin.container.textContent).not.toContain("Pair this phone");
  act(() =>
    setPluginSlotRegistrations("connection", makePluginRegistrationSet()),
  );
  expect(screen.queryByText("Pair this phone")).toBeNull();
});

it("hides pairing slots when Direct or a different provider is selected", () => {
  setPluginSlotRegistrations(
    "connection",
    makePluginRegistrationSet({
      settingsSections: [
        {
          id: "pair",
          experimental_page: "mobile",
          component: () => <p>Pair this phone</p>,
        },
      ],
    }),
  );
  const view = (pluginId: string | null) => (
    <MemoryRouter>
      <PluginMobileSettingsSections pluginId={pluginId} />
    </MemoryRouter>
  );
  const rendered = render(view("connection"));
  expect(screen.getByText("Pair this phone")).toBeTruthy();
  rendered.rerender(view(null));
  expect(screen.queryByText("Pair this phone")).toBeNull();
  rendered.rerender(view("other-provider"));
  expect(screen.queryByText("Pair this phone")).toBeNull();
  rendered.rerender(view("connection"));
  expect(screen.getByText("Pair this phone")).toBeTruthy();
});
