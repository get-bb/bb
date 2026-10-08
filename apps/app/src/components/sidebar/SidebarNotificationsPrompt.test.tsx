// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar.js";
import { SidebarNotificationsPrompt } from "./SidebarNotificationsPrompt";

const mocks = vi.hoisted(() => ({
  recordTelemetryEvent: vi.fn(),
  usePluginList: vi.fn(),
  useSidebarNavigation: vi.fn(),
}));

vi.mock("@/hooks/queries/plugin-settings-queries", () => ({
  usePluginList: mocks.usePluginList,
}));
vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: mocks.useSidebarNavigation,
}));
vi.mock("@/components/onboarding/onboarding-telemetry", () => ({
  recordTelemetryEvent: mocks.recordTelemetryEvent,
}));

function arrange({
  permission = "default",
  threadStatus = "active",
  pushEnabled = true,
}: {
  permission?: NotificationPermission;
  threadStatus?: string | null;
  pushEnabled?: boolean;
}) {
  const requestPermission = vi.fn(async () => "granted" as const);
  vi.stubGlobal("Notification", { permission, requestPermission });
  vi.stubGlobal("isSecureContext", true);
  mocks.usePluginList.mockReturnValue({
    data: {
      plugins: [{ id: "push-notifications", enabled: pushEnabled }],
    },
  });
  mocks.useSidebarNavigation.mockReturnValue({
    data: {
      projects: [],
      personalProject: {
        threads:
          threadStatus === null ? [] : [{ id: "thr_1", status: threadStatus }],
      },
    },
  });
  return requestPermission;
}

function renderPrompt() {
  return render(
    <Provider store={createStore()}>
      <TooltipProvider delayDuration={300} disableHoverableContent>
        <SidebarProvider>
          <SidebarNotificationsPrompt />
        </SidebarProvider>
      </TooltipProvider>
    </Provider>,
  );
}

const chip = () => screen.queryByTestId("sidebar-notifications-prompt");
const events = (name: string) =>
  mocks.recordTelemetryEvent.mock.calls
    .map(([event]) => event)
    .filter((event) => event.name === name);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("SidebarNotificationsPrompt", () => {
  it("appears once a thread is running and asks for permission only on a click", async () => {
    const requestPermission = arrange({});

    renderPrompt();

    expect(chip()).not.toBeNull();
    expect(events("notification_prompt_shown")).toEqual([
      { name: "notification_prompt_shown", properties: { surface: "sidebar" } },
    ]);
    expect(requestPermission).not.toHaveBeenCalled();
    fireEvent.click(chip() as HTMLElement);
    await waitFor(() =>
      expect(events("notification_prompt_accepted")).toEqual([
        {
          name: "notification_prompt_accepted",
          properties: { surface: "sidebar" },
        },
      ]),
    );
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(chip()).toBeNull();
  });

  it("stays hidden before any thread runs", () => {
    arrange({ threadStatus: "idle" });

    renderPrompt();

    expect(chip()).toBeNull();
    expect(events("notification_prompt_shown")).toEqual([]);
  });

  it("stays hidden once permission is decided or push is off", () => {
    arrange({ permission: "denied" });
    renderPrompt();
    expect(chip()).toBeNull();
    cleanup();

    arrange({ pushEnabled: false });
    renderPrompt();
    expect(chip()).toBeNull();
  });

  it("does not ask again after Not now", () => {
    const requestPermission = arrange({});
    renderPrompt();

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));

    expect(chip()).toBeNull();
    expect(events("notification_prompt_dismissed")).toEqual([
      {
        name: "notification_prompt_dismissed",
        properties: { surface: "sidebar" },
      },
    ]);
    cleanup();
    renderPrompt();
    expect(chip()).toBeNull();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("keeps showing after the thread goes idle until answered", () => {
    arrange({});
    renderPrompt();
    cleanup();

    arrange({ threadStatus: "idle" });
    renderPrompt();

    expect(chip()).not.toBeNull();
  });
});
