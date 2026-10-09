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
import {
  SidebarNotificationsCard,
  useSidebarNotificationsPrompt,
} from "./SidebarNotificationsPrompt";

function Harness() {
  return <SidebarNotificationsCard prompt={useSidebarNotificationsPrompt()} />;
}

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
          <Harness />
        </SidebarProvider>
      </TooltipProvider>
    </Provider>,
  );
}

const card = () => screen.queryByTestId("sidebar-notifications-prompt");
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

describe("SidebarNotificationsCard", () => {
  it("appears once a thread is running and asks for permission only on a click", async () => {
    const requestPermission = arrange({});

    renderPrompt();

    expect(card()).not.toBeNull();
    expect(events("notification_prompt_shown")).toEqual([
      { name: "notification_prompt_shown", properties: { surface: "sidebar" } },
    ]);
    expect(requestPermission).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Turn on notifications" }),
    );
    await waitFor(() =>
      expect(events("notification_prompt_accepted")).toEqual([
        {
          name: "notification_prompt_accepted",
          properties: { surface: "sidebar" },
        },
      ]),
    );
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(card()).toBeNull();
  });

  it("stays hidden before any thread runs", () => {
    arrange({ threadStatus: "idle" });

    renderPrompt();

    expect(card()).toBeNull();
    expect(events("notification_prompt_shown")).toEqual([]);
  });

  it("stays hidden once permission is decided or push is off", () => {
    arrange({ permission: "denied" });
    renderPrompt();
    expect(card()).toBeNull();
    cleanup();

    arrange({ pushEnabled: false });
    renderPrompt();
    expect(card()).toBeNull();
  });

  it("does not ask again after Not now", () => {
    const requestPermission = arrange({});
    renderPrompt();

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));

    expect(card()).toBeNull();
    expect(events("notification_prompt_dismissed")).toEqual([
      {
        name: "notification_prompt_dismissed",
        properties: { surface: "sidebar" },
      },
    ]);
    cleanup();
    renderPrompt();
    expect(card()).toBeNull();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("keeps showing after the thread goes idle until answered", () => {
    arrange({});
    renderPrompt();
    cleanup();

    arrange({ threadStatus: "idle" });
    renderPrompt();

    expect(card()).not.toBeNull();
  });
});
