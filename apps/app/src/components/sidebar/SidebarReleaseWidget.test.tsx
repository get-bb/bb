// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { SystemAppUpdateStatus } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseChangelog } from "../../../../../changelog-parser";
import { changelogEntriesQueryOptions } from "@/components/settings/changelog-preview";
import { systemAppUpdateQueryKey } from "@/hooks/queries/query-keys";
import type { UpdateInventory } from "@/hooks/useUpdateInventory";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { dismissedReleaseVersionAtom } from "./release-widget-preferences";
import {
  resetReleaseWidgetSessionForTest,
  SidebarReleaseWidget,
} from "./SidebarReleaseWidget";
import { SidebarUpdatesBadge } from "./SidebarUpdatesBadge";
import { TooltipProvider } from "@bb/shared-ui/tooltip";

const useUpdateInventoryMock = vi.hoisted(() => vi.fn());
const recordTelemetryEventMock = vi.hoisted(() => vi.fn());
const openUrlInExternalBrowserMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useUpdateInventory", () => ({
  useUpdateInventory: useUpdateInventoryMock,
}));

vi.mock("@/components/onboarding/onboarding-telemetry", () => ({
  recordTelemetryEvent: recordTelemetryEventMock,
}));

vi.mock("@/lib/url-open-routing", () => ({
  openUrlInExternalBrowser: openUrlInExternalBrowserMock,
}));

vi.mock("@/components/provider-cli/provider-cli-install", () => ({
  useProviderCliInstallRunner: () => ({ runningJobKey: null }),
}));

vi.mock("@/lib/sdk", () => ({
  sdk: {
    providers: { list: vi.fn(async () => []) },
    system: {
      appUpdate: vi.fn(() => new Promise(() => {})),
      config: vi.fn(() => new Promise(() => {})),
    },
  },
}));

vi.mock("@/lib/ws", () => ({
  wsManager: { subscribe: vi.fn(), unsubscribe: vi.fn() },
}));

const LEGACY_KEY = "bb.settings.updates.dismissed-changelog-version";

const CHANGELOG = parseChangelog(`## 0.48.0

### Highlights

- **Release forty-eight:** next.

## 0.47.0

Customizable sidebar navigation, new and improved ACP support, and **more**.

### Highlights

- **Customizable sidebar navigation:** switch.
- **New and improved ACP support:** rebuilt.
- **Diff review:** viewed files.
- **More customization surfaces:** plugins.

![The sidebar navigation picker](https://getbb.app/changelog/0.47.0/navigation.jpg)

## 0.46.1

### Fixes

- Fixed.
`);

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  useUpdateInventoryMock.mockReset();
  recordTelemetryEventMock.mockReset();
  openUrlInExternalBrowserMock.mockReset();
  resetReleaseWidgetSessionForTest();
});

function appUpdate(version: string | null): SystemAppUpdateStatus {
  return {
    activity: { phase: "idle" },
    available:
      version === null
        ? null
        : {
            channel: "latest",
            commit: null,
            commitCount: null,
            subjects: [],
            version,
          },
    blocked: null,
    current: { commit: null, version: "0.46.1" },
    lastResult: null,
    runningThreadCount: 0,
    support: { kind: "supported", mode: "npm" },
  };
}

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {`${location.pathname} ${JSON.stringify(location.state)}`}
    </output>
  );
}

interface RenderOptions {
  available?: string | null;
  visible?: boolean;
  dismissed?: string | null;
}

function renderWidget({
  available = "0.47.0",
  visible = true,
  dismissed = null,
}: RenderOptions = {}) {
  useUpdateInventoryMock.mockReturnValue({
    isLoading: false,
    systemVersion: undefined,
    desktopInfo: null,
    appUpdateAvailable: available !== null,
    desktopUpdateReady: false,
    machines: [],
    actionableCount: available === null ? 0 : 1,
    hasAttention: available !== null,
  } satisfies Partial<UpdateInventory>);
  const { queryClient } = createQueryClientTestHarness();
  queryClient.setQueryData(systemAppUpdateQueryKey(), appUpdate(available));
  queryClient.setQueryData(changelogEntriesQueryOptions().queryKey, CHANGELOG);
  const store = createStore();
  store.set(dismissedReleaseVersionAtom, dismissed);
  const result = render(
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/"]}>
          <TooltipProvider>
            <SidebarUpdatesBadge />
            <SidebarReleaseWidget visible={visible} />
            <Routes>
              <Route path="*" element={<LocationProbe />} />
            </Routes>
          </TooltipProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
  return { ...result, store, queryClient };
}

function widget(): HTMLElement | null {
  return screen.queryByTestId("sidebar-release-widget");
}

function card(version = "0.47.0"): HTMLElement {
  return screen.getByRole("article", { name: `bb ${version} is available` });
}

function notesLink(): HTMLElement {
  return screen.getByRole("link", { name: "Read the release notes" });
}

describe("SidebarReleaseWidget", () => {
  it("shows the release and its highlights alongside the chip", () => {
    renderWidget();

    expect(screen.getByTestId("sidebar-updates-badge-bb")).toBeTruthy();
    const region = card();
    expect(
      screen.getByRole("heading", { name: "bb 0.47.0 is available" }),
    ).toBeTruthy();
    expect(
      within(region)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Customizable sidebar navigation",
      "New and improved ACP support",
      "Diff review",
    ]);
    expect(region.textContent).not.toContain("More customization surfaces");
    expect(region.textContent).not.toContain(":");
  });

  it("leads with the release image, then the highlights and the release notes link", () => {
    renderWidget();

    const region = card();
    const image = screen.getByRole("img", {
      name: "The sidebar navigation picker",
    });
    expect(image.getAttribute("src")).toBe(
      "https://getbb.app/changelog/0.47.0/navigation.jpg",
    );
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(region.contains(image)).toBe(true);
    expect(region.textContent).not.toContain(
      "Customizable sidebar navigation, new and improved ACP support, and more.",
    );
    expect(notesLink().getAttribute("href")).toBe(
      "https://getbb.app/changelog#0-47-0",
    );
    expect(
      Array.from(region.querySelectorAll("a, button")).map(
        (control) => control.textContent || control.getAttribute("aria-label"),
      ),
    ).toEqual([
      "Read the release notes",
      "Dismiss the bb 0.47.0 release preview",
    ]);
    expect(screen.queryByTestId("sidebar-release-widget-fallback")).toBeNull();
  });

  it("shows the bb logo and version when the image fails to load", () => {
    renderWidget();

    fireEvent.error(screen.getByTestId("sidebar-release-widget-image"));

    expect(screen.queryByTestId("sidebar-release-widget-image")).toBeNull();
    expect(
      screen.getByTestId("sidebar-release-widget-fallback").textContent,
    ).toBe("0.47.0");
  });

  it("shows the fallback when the release has no image", () => {
    renderWidget({ available: "0.48.0" });

    expect(screen.queryByTestId("sidebar-release-widget-image")).toBeNull();
    expect(
      screen.getByTestId("sidebar-release-widget-fallback").textContent,
    ).toBe("0.48.0");
  });

  it("stays hidden with no update, while collapsed, or without highlights", () => {
    renderWidget({ available: null });
    expect(widget()).toBeNull();
    cleanup();

    renderWidget({ visible: false });
    expect(widget()).toBeNull();
    cleanup();

    renderWidget({ available: "0.49.0" });
    expect(screen.getByTestId("sidebar-updates-badge-bb")).toBeTruthy();
    expect(widget()).toBeNull();
    expect(recordTelemetryEventMock).not.toHaveBeenCalled();
  });

  it("dismisses the release into the synced preference", () => {
    const { store } = renderWidget();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Dismiss the bb 0.47.0 release preview",
      }),
    );

    expect(widget()).toBeNull();
    expect(store.get(dismissedReleaseVersionAtom)).toBe("0.47.0");
    expect(screen.getByTestId("sidebar-updates-badge-bb")).toBeTruthy();
    expect(openUrlInExternalBrowserMock).not.toHaveBeenCalled();
    expect(recordTelemetryEventMock).toHaveBeenCalledWith({
      name: "release_widget_action",
      properties: { release_version: "0.47.0", action: "dismiss" },
    });
  });

  it("keeps a dismissed release hidden and brings a newer one back", () => {
    renderWidget({ dismissed: "0.47.0" });
    expect(widget()).toBeNull();
    cleanup();

    renderWidget({ dismissed: "0.47.0", available: "0.48.0" });
    expect(card("0.48.0")).toBeTruthy();
  });

  it("carries the old card's dismissal over once", () => {
    window.localStorage.setItem(LEGACY_KEY, "0.47.0");
    const { store } = renderWidget();

    expect(widget()).toBeNull();
    expect(store.get(dismissedReleaseVersionAtom)).toBe("0.47.0");
    expect(recordTelemetryEventMock).not.toHaveBeenCalled();
    cleanup();

    window.localStorage.setItem(LEGACY_KEY, "0.47.0");
    const newer = renderWidget({ available: "0.48.0" });
    expect(widget()).not.toBeNull();
    expect(newer.store.get(dismissedReleaseVersionAtom)).toBeNull();
  });

  it("opens the release notes in the external browser and dismisses the release", () => {
    const { store } = renderWidget();
    recordTelemetryEventMock.mockClear();

    fireEvent.click(notesLink());

    expect(openUrlInExternalBrowserMock).toHaveBeenCalledExactlyOnceWith(
      "https://getbb.app/changelog#0-47-0",
    );
    expect(widget()).toBeNull();
    expect(store.get(dismissedReleaseVersionAtom)).toBe("0.47.0");
    expect(screen.getByTestId("sidebar-updates-badge-bb")).toBeTruthy();
    expect(screen.getByTestId("location").textContent).toBe("/ null");
    expect(recordTelemetryEventMock.mock.calls).toEqual([
      [
        {
          name: "release_widget_action",
          properties: { release_version: "0.47.0", action: "open_notes" },
        },
      ],
      [
        {
          name: "release_notes_opened",
          properties: { release_version: "0.47.0", entry_point: "widget" },
        },
      ],
    ]);
  });

  it("records it shown once per release per session", () => {
    renderWidget();
    cleanup();
    renderWidget();
    cleanup();
    renderWidget({ available: "0.48.0" });

    expect(recordTelemetryEventMock.mock.calls).toEqual([
      [
        {
          name: "release_widget_shown",
          properties: { release_version: "0.47.0" },
        },
      ],
      [
        {
          name: "release_widget_shown",
          properties: { release_version: "0.48.0" },
        },
      ],
    ]);
  });
});
