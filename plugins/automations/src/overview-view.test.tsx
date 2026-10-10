// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { AutomationOverviewView } from "../overview-view.js";
import type {
  AutomationResponse,
  AutomationsOverviewResponse,
} from "./rpc-types.js";

installTestPluginRuntime();

function focusWithKeyboard(element: HTMLElement): void {
  fireEvent.keyDown(element.ownerDocument.body, { key: "Tab" });
  element.focus();
  fireEvent.focus(element);
}

const INSTALLED_AUTOMATIONS: AutomationsOverviewResponse["automations"] = [
  {
    automation: {
      id: "auto_1",
      projectId: "proj_1",
      name: "Nightly digest",
      enabled: true,
      trigger: {
        triggerType: "schedule",
        cron: "0 9 * * *",
        timezone: "UTC",
      },
      execution: {
        mode: "agent",
        prompt: "Summarize yesterday's commits.",
        providerId: "claude",
        model: "claude-opus-5",
        reasoningLevel: "medium",
        permissionMode: "auto",
        environment: { type: "host", workspace: { type: "personal" } },
      },
      origin: "human",
      createdByThreadId: null,
      nextRunAt: 1_800_000_000_000,
      lastRunAt: null,
      runCount: 0,
      lastRunStatus: null,
      lastRunThreadId: null,
      lastError: null,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    },
    project: { id: "proj_1", name: "bb" },
  },
];

afterEach(cleanup);

describe("AutomationOverviewView", () => {
  it("keeps lifecycle groups stable around the selected sort", () => {
    const baseEntry = INSTALLED_AUTOMATIONS[0]!;
    if ("problem" in baseEntry.automation) {
      throw new Error("Expected a canonical automation fixture");
    }
    const baseAutomation = baseEntry.automation;
    const entry = (
      name: string,
      overrides: Partial<AutomationResponse> = {},
    ) => ({
      ...baseEntry,
      automation: {
        ...baseAutomation,
        id: `auto_${name.toLowerCase().replaceAll(" ", "_")}`,
        name,
        ...overrides,
      },
    });
    const entries = [
      entry("Aardvark completed", {
        enabled: false,
        trigger: { triggerType: "once", runAt: Date.now() - 1_000 },
        nextRunAt: null,
        runCount: 1,
        lastRunStatus: "succeeded",
      }),
      entry("Zulu inactive", { enabled: false, nextRunAt: null }),
      entry("Aardvark pending", {
        trigger: { triggerType: "once", runAt: Date.now() + 60_000 },
        nextRunAt: Date.now() + 60_000,
      }),
      entry("Zulu active"),
      entry("Alpha inactive", { enabled: false, nextRunAt: null }),
      entry("Alpha active"),
    ];
    const { container } = render(
      <AutomationOverviewView
        entries={entries}
        error={null}
        onRetry={() => {}}
        onOpenDetail={() => {}}
        onEnabledChange={async () => {}}
        onRunNow={async () => {}}
        onDelete={() => {}}
        onCreateViaChat={() => {}}
        activeMode="installed"
        onModeChange={() => {}}
      />,
    );

    const rowTitles = Array.from(
      container.querySelectorAll<HTMLElement>("[data-resource-row]"),
      (row) => row.querySelector("button")?.textContent,
    );
    expect(rowTitles).toEqual([
      "Alpha active",
      "Zulu active",
      "Aardvark pending",
      "Alpha inactive",
      "Zulu inactive",
      "Aardvark completed",
    ]);
  });

  it("opens a missing-prompt row in the standard editor", () => {
    const onOpenDetail = vi.fn();
    const healthyAutomation = INSTALLED_AUTOMATIONS[0]!.automation;
    if (
      "problem" in healthyAutomation ||
      healthyAutomation.execution.mode !== "agent"
    ) {
      throw new Error("Expected an agent automation fixture");
    }
    const entries: AutomationsOverviewResponse["automations"] = [
      {
        automation: {
          ...healthyAutomation,
          id: "auto_repair",
          name: "Needs a prompt",
          execution: { ...healthyAutomation.execution, prompt: "" },
          problem: "missing-agent-prompt",
        },
        project: { id: "proj_1", name: "bb" },
      },
      {
        automation: {
          id: "auto_invalid",
          projectId: "proj_1",
          name: "Unreadable automation",
          problem: "invalid-stored-data",
        },
        project: { id: "proj_1", name: "bb" },
      },
      ...INSTALLED_AUTOMATIONS,
    ];
    render(
      <AutomationOverviewView
        entries={entries}
        error={null}
        onRetry={() => {}}
        onOpenDetail={onOpenDetail}
        onEnabledChange={async () => {}}
        onRunNow={async () => {}}
        onDelete={() => {}}
        onCreateViaChat={() => {}}
        activeMode="installed"
        onModeChange={() => {}}
      />,
    );

    expect(screen.getByText("Needs a prompt")).toBeTruthy();
    expect(screen.getByText("Unreadable automation")).toBeTruthy();
    expect(screen.getByText("Nightly digest")).toBeTruthy();
    expect(screen.getAllByText("9AM")).toHaveLength(2);

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Needs a prompt actions" }),
    );
    expect(
      (screen.getByRole("menuitem", { name: "Run now" }) as HTMLElement)
        .ariaDisabled,
    ).toBe("true");
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });

    const search = screen.getByPlaceholderText("Search automations");
    fireEvent.change(search, { target: { value: "Prompt required" } });
    expect(screen.getByText("Needs a prompt")).toBeTruthy();
    expect(screen.queryByText("Unreadable automation")).toBeNull();
    expect(screen.queryByText("Nightly digest")).toBeNull();

    fireEvent.change(search, { target: { value: "Invalid data" } });
    expect(screen.queryByText("Needs a prompt")).toBeNull();
    expect(screen.getByText("Unreadable automation")).toBeTruthy();

    fireEvent.change(search, { target: { value: "" } });
    fireEvent.pointerDown(screen.getByRole("button", { name: "Filters" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Active" }));
    expect(screen.getByText("Needs a prompt")).toBeTruthy();
    expect(screen.queryByText("Unreadable automation")).toBeNull();
    expect(screen.getByText("Nightly digest")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onOpenDetail).toHaveBeenCalledWith(
      { projectId: "proj_1", automationId: "auto_repair" },
      { editing: true },
    );
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
  });

  it("runs an automation from its row without opening the detail", async () => {
    const onOpenDetail = vi.fn();
    let resolveRun: (() => void) | null = null;
    const onRunNow = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRun = resolve;
        }),
    );
    render(
      <AutomationOverviewView
        entries={INSTALLED_AUTOMATIONS}
        error={null}
        onRetry={() => {}}
        onOpenDetail={onOpenDetail}
        onEnabledChange={async () => {}}
        onRunNow={onRunNow}
        onDelete={() => {}}
        onCreateViaChat={() => {}}
        activeMode="installed"
        onModeChange={() => {}}
      />,
    );

    const actions = () =>
      screen.getByRole("button", { name: "Nightly digest actions" });
    const enabledSwitch = screen.getByRole("switch", {
      name: "Disable Nightly digest",
    });
    expect(enabledSwitch.compareDocumentPosition(actions())).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(actions().parentElement?.className).not.toContain("opacity-0");
    fireEvent.pointerDown(actions());
    fireEvent.click(await screen.findByRole("menuitem", { name: "Run now" }));

    expect(onRunNow).toHaveBeenCalledWith({
      projectId: "proj_1",
      automationId: "auto_1",
    });
    expect(onOpenDetail).not.toHaveBeenCalled();
    expect(actions()).toHaveProperty("disabled", true);

    await act(async () => {
      resolveRun?.();
    });
    expect(actions()).toHaveProperty("disabled", false);
    expect(screen.queryByRole("menuitem", { name: "Run now" })).toBeNull();
  });

  it("uses the shared row menu to request deletion", async () => {
    const onOpenDetail = vi.fn();
    const onDelete = vi.fn();
    render(
      <AutomationOverviewView
        entries={INSTALLED_AUTOMATIONS}
        error={null}
        onRetry={() => {}}
        onOpenDetail={onOpenDetail}
        onEnabledChange={async () => {}}
        onRunNow={async () => {}}
        onDelete={onDelete}
        onCreateViaChat={() => {}}
        activeMode="installed"
        onModeChange={() => {}}
      />,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Nightly digest actions" }),
    );
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["Run now", "Delete"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    expect(onDelete).toHaveBeenCalledWith(
      { projectId: "proj_1", automationId: "auto_1" },
      "Nightly digest",
    );
    expect(onOpenDetail).not.toHaveBeenCalled();
  });

  it("keeps project and status selections independent in the merged menu", () => {
    const { container } = render(
      <AutomationOverviewView
        entries={INSTALLED_AUTOMATIONS}
        error={null}
        onRetry={() => {}}
        onOpenDetail={() => {}}
        onEnabledChange={async () => {}}
        onRunNow={async () => {}}
        onDelete={() => {}}
        onCreateViaChat={() => {}}
        activeMode="installed"
        onModeChange={() => {}}
      />,
    );
    const rowTitles = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>("[data-resource-row]"),
        (row) => row.querySelector("button")?.textContent,
      );

    expect(rowTitles()).toEqual(["Nightly digest"]);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Filters" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "bb" }));
    expect(
      screen.getByRole("menuitemcheckbox", { name: "bb" }).ariaChecked,
    ).toBe("true");
    expect(rowTitles()).toEqual(["Nightly digest"]);

    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Paused" }));
    expect(
      screen.getByRole("menuitemcheckbox", { name: "bb" }).ariaChecked,
    ).toBe("true");
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Paused" }).ariaChecked,
    ).toBe("true");
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Active" }).ariaChecked,
    ).toBe("false");
    expect(rowTitles()).toEqual([]);
    expect(
      screen.getByText("No automations match these filters."),
    ).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.getByRole("button", {
        name: "Filters: Projects: bb; Status: Paused",
      }),
    ).toBeTruthy();

    fireEvent.pointerDown(screen.getByRole("button", { name: /^Filters/ }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Paused" }));
    expect(
      screen.getByRole("menuitemcheckbox", { name: "bb" }).ariaChecked,
    ).toBe("true");
    expect(rowTitles()).toEqual(["Nightly digest"]);
    expect(
      screen.queryByText("No automations match these filters."),
    ).toBeNull();
  });

  it("keeps labelled metadata tooltip triggers outside the row button", async () => {
    render(
      <AutomationOverviewView
        entries={INSTALLED_AUTOMATIONS}
        error={null}
        onRetry={() => {}}
        onOpenDetail={() => {}}
        onEnabledChange={async () => {}}
        onRunNow={async () => {}}
        onDelete={() => {}}
        onCreateViaChat={() => {}}
        activeMode="installed"
        onModeChange={() => {}}
      />,
    );

    const projectIcon = screen.getByRole("img", { name: "Project" });
    const scheduleIcon = screen.getByRole("img", { name: "Schedule" });
    const nextRunIcon = screen.getByRole("img", { name: "Next run" });

    expect(projectIcon.tabIndex).toBe(0);
    expect(scheduleIcon.tabIndex).toBe(0);
    expect(nextRunIcon.tabIndex).toBe(0);
    expect(projectIcon.closest("button")).toBeNull();
    expect(scheduleIcon.closest("button")).toBeNull();
    expect(nextRunIcon.closest("button")).toBeNull();
    expect(projectIcon.querySelector('[data-icon="Folder"]')).toBeTruthy();
    expect(scheduleIcon.querySelector('[data-icon="DateTime"]')).toBeTruthy();
    expect(
      nextRunIcon.querySelector('[data-icon="CalendarCheckOut02"]'),
    ).toBeTruthy();
    expect(nextRunIcon).toBeTruthy();
    expect(screen.queryByText("Next")).toBeNull();

    focusWithKeyboard(nextRunIcon);
    expect((await screen.findByRole("tooltip")).textContent).toBe("Next run");
  });

  it("shows Personal as project membership and keeps it searchable", async () => {
    render(
      <AutomationOverviewView
        entries={[
          {
            ...INSTALLED_AUTOMATIONS[0]!,
            project: { id: "proj_personal", name: "Personal" },
          },
        ]}
        error={null}
        onRetry={() => {}}
        onOpenDetail={() => {}}
        onEnabledChange={async () => {}}
        onRunNow={async () => {}}
        onDelete={() => {}}
        onCreateViaChat={() => {}}
        activeMode="installed"
        onModeChange={() => {}}
      />,
    );
    const icon = screen.getByRole("img", { name: "Project: Personal" });
    expect(icon.querySelector('[data-icon="Folder"]')).not.toBeNull();
    expect(screen.queryByText("Local")).toBeNull();
    expect(screen.getByText("Personal")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Search automations"), {
      target: { value: "Personal" },
    });
    expect(screen.getByText("Nightly digest")).toBeTruthy();
    focusWithKeyboard(icon);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Project: Personal",
    );
  });

  it("does not treat a project named Local as the personal project", () => {
    const namedLocalEntry = {
      ...INSTALLED_AUTOMATIONS[0]!,
      project: { id: "proj_named_local", name: "Local" },
    };
    const { container } = render(
      <AutomationOverviewView
        entries={[namedLocalEntry]}
        error={null}
        onRetry={() => {}}
        onOpenDetail={() => {}}
        onEnabledChange={async () => {}}
        onRunNow={async () => {}}
        onDelete={() => {}}
        onCreateViaChat={() => {}}
        activeMode="installed"
        onModeChange={() => {}}
      />,
    );

    expect(
      container.querySelector('[aria-label="Project"] [data-icon="Folder"]'),
    ).toBeTruthy();
    expect(
      container.querySelector(
        '[aria-label="Local project"] [data-icon="Laptop"]',
      ),
    ).toBeNull();
  });
});
