// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  PluginPrimaryTabLifecycleProps,
  PluginPrimaryTabRegistration,
} from "@bb/plugin-sdk";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "@/lib/plugin-slots";
import {
  PluginPrimaryTabs,
  shouldApplyDefaultPrimaryTabStartup,
} from "./PluginPrimaryTabs";

function registrationSet(
  tab: PluginPrimaryTabRegistration,
): PluginRegistrationSet {
  return {
    homepageSections: [],
    settingsSections: [],
    navPanels:
      tab.target.kind === "plugin-panel"
        ? [
            {
              id: tab.target.path,
              title: tab.title,
              icon: tab.icon,
              path: tab.target.path,
              component: () => null,
            },
          ]
        : [],
    primaryTabs: [tab],
    threadPanelActions: [],
    sidebarFooterActions: [],
    fileOpeners: [],
    messageDirectives: [],
  };
}

function registerPrimaryTabs(
  chiefOverrides: Partial<PluginPrimaryTabRegistration> = {},
  tasksOverrides: Partial<PluginPrimaryTabRegistration> = {},
) {
  setPluginSlotRegistrations(
    "tasks",
    registrationSet({
      id: "tasks",
      title: "Tasks",
      icon: "ListTodo",
      order: 20,
      defaultStartup: false,
      routePersistence: "fixed",
      target: {
        kind: "plugin-panel",
        path: "tasks",
        query: { view: "board" },
      },
      ...tasksOverrides,
    }),
  );
  setPluginSlotRegistrations(
    "chief",
    registrationSet({
      id: "chief",
      title: "Chief",
      icon: "MessageSquare",
      order: 10,
      defaultStartup: true,
      routePersistence: "restore-last",
      target: { kind: "plugin-panel", path: "chief" },
      ...chiefOverrides,
    }),
  );
}

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  );
}

function renderTabs(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <PluginPrimaryTabs />
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  window.sessionStorage.clear();
});

describe("PluginPrimaryTabs", () => {
  it("opens the ordered default on launch and links Tasks directly to its board", async () => {
    registerPrimaryTabs();
    renderTabs("/");

    expect(
      screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-label")),
    ).toEqual(["Chief", "Tasks"]);
    expect(screen.getByRole("tablist").classList.contains("flex")).toBe(true);
    expect(screen.getByText("Chief").classList.contains("hidden")).toBe(true);
    expect(
      screen.getByText("Chief").classList.contains("min-[420px]:inline"),
    ).toBe(true);
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe(
        "/plugins/chief/chief",
      );
    });
    expect(
      screen.getByRole("tab", { name: "Chief" }).getAttribute("aria-selected"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("tab", { name: "Tasks" }));
    expect(screen.getByTestId("location").textContent).toBe(
      "/plugins/tasks/tasks?view=board",
    );
  });

  it("preserves explicit deep links and restores a tab's last subroute", async () => {
    registerPrimaryTabs();
    renderTabs("/plugins/chief/chief/configuration");

    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe(
        "/plugins/chief/chief/configuration",
      );
    });
    fireEvent.click(screen.getByRole("tab", { name: "Tasks" }));
    fireEvent.click(screen.getByRole("tab", { name: "Chief" }));
    expect(screen.getByTestId("location").textContent).toBe(
      "/plugins/chief/chief/configuration",
    );
  });

  it("renders semantic badges and supports roving keyboard focus", async () => {
    function Lifecycle({ update }: PluginPrimaryTabLifecycleProps) {
      useEffect(() => {
        update({
          available: true,
          badge: {
            count: 3,
            label: "3 tasks need input",
            tone: "needs-input",
          },
        });
      }, [update]);
      return null;
    }
    function UnreadLifecycle({ update }: PluginPrimaryTabLifecycleProps) {
      useEffect(() => {
        update({
          available: true,
          badge: { count: 5, label: "5 unread tasks", tone: "unread" },
        });
      }, [update]);
      return null;
    }
    registerPrimaryTabs(
      { lifecycle: Lifecycle },
      { lifecycle: UnreadLifecycle },
    );
    renderTabs("/projects/project-one/threads/thread-one");

    const chief = await screen.findByRole("tab", {
      name: "Chief, 3 tasks need input",
    });
    expect(chief.textContent).toContain("3");
    expect(chief.getAttribute("tabindex")).toBe("0");

    chief.focus();
    fireEvent.keyDown(chief, { key: "ArrowRight" });
    const tasks = screen.getByRole("tab", {
      name: "Tasks, 5 unread tasks",
    });
    expect(tasks.textContent).toContain("5");
    expect(document.activeElement).toBe(tasks);
    expect(tasks.getAttribute("tabindex")).toBe("0");
  });

  it("uses the declared recovery route when a configured startup target is unavailable", async () => {
    function Unavailable({ update }: PluginPrimaryTabLifecycleProps) {
      useEffect(() => update({ available: false }), [update]);
      return null;
    }
    registerPrimaryTabs({
      target: {
        kind: "thread",
        projectId: "configured-project",
        threadId: "configured-thread",
      },
      recoveryTarget: { kind: "route", path: "/recovered", match: "exact" },
      lifecycle: Unavailable,
    });
    renderTabs("/");

    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe("/recovered");
    });
  });
});

describe("shouldApplyDefaultPrimaryTabStartup", () => {
  it("defaults root launches and reloads without replacing navigated deep links", () => {
    expect(
      shouldApplyDefaultPrimaryTabStartup({
        navigationType: "navigate",
        path: "/?source=launch",
      }),
    ).toBe(true);
    expect(
      shouldApplyDefaultPrimaryTabStartup({
        navigationType: "reload",
        path: "/projects/project-one/threads/thread-one",
      }),
    ).toBe(true);
    expect(
      shouldApplyDefaultPrimaryTabStartup({
        navigationType: "navigate",
        path: "/projects/project-one/threads/thread-one",
      }),
    ).toBe(false);
  });
});
