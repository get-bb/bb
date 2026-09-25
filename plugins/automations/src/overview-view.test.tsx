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
import { CompactViewportOverrideProvider } from "@/components/ui/hooks/use-compact-viewport";
import { AutomationOverviewView, OverviewRow } from "../overview-view.js";
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

function iconNames(element: HTMLElement): string[] {
  return [...element.querySelectorAll("[data-icon]")].map(
    (icon) => icon.getAttribute("data-icon") ?? "",
  );
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
  it("keeps failure and retry state visible on the automation row", () => {
    const entry = INSTALLED_AUTOMATIONS[0]!;
    if ("problem" in entry.automation) throw new Error("invalid fixture");
    const props = {
      project: entry.project,
      onNavigate: () => undefined,
      onEnabledChange: async () => undefined,
      onRunNow: async () => undefined,
      onDelete: () => undefined,
    };
    const view = render(
      <OverviewRow
        {...props}
        automation={{
          ...entry.automation,
          lastRunStatus: "failed",
          lastError: "Provider connection failed",
        }}
      />,
    );
    expect(
      screen.getByText("Retrying: Provider connection failed"),
    ).toBeTruthy();
    expect(screen.getByText(/^Retry /u)).toBeTruthy();
    expect(
      screen.getByRole("img", { name: "Retrying after failure" }),
    ).toBeTruthy();

    view.rerender(
      <OverviewRow
        {...props}
        automation={{
          ...entry.automation,
          enabled: false,
          nextRunAt: null,
          lastRunStatus: "failed",
          lastError: "invalid model",
        }}
      />,
    );
    expect(
      screen.getByText(
        "Paused: invalid model. Resume after resolving the error.",
      ),
    ).toBeTruthy();
  });

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

  it("renders the production collection shell for an empty library", () => {
    render(
      <AutomationOverviewView
        entries={[]}
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

    expect(screen.getByRole("tab", { name: "Installed0" })).toBeTruthy();
    expect(screen.getByText("No automations installed.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New automation" })).toBeTruthy();
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

  it("offers Projects and Status as groups inside one filter menu", async () => {
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

    expect(screen.queryByRole("button", { name: "Projects" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Status" })).toBeNull();
    const filtersTrigger = screen.getByRole("button", { name: "Filters" });
    focusWithKeyboard(filtersTrigger);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Filters: All",
    );
    fireEvent.blur(filtersTrigger);
    fireEvent.pointerDown(filtersTrigger);

    expect(screen.getByRole("menu", { name: "Filters" })).toBeTruthy();
    expect(screen.getByText("Projects")).toBeTruthy();
    expect(screen.getByText("Status")).toBeTruthy();

    const projectOption = screen.getByRole("menuitemcheckbox", { name: "bb" });
    expect(projectOption.querySelector("[data-icon]")).toBeNull();
    expect(
      projectOption.querySelector(".truncate")?.getAttribute("title"),
    ).toBe("bb");
    const activeOption = screen.getByRole("menuitemcheckbox", {
      name: "Active",
    });
    const pausedOption = screen.getByRole("menuitemcheckbox", {
      name: "Paused",
    });
    expect(activeOption.querySelector("[data-icon]")).toBeNull();
    expect(pausedOption.querySelector("[data-icon]")).toBeNull();
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

  it("gives filter and sort triggers the same resting, open, and engaged states", () => {
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

    const ENGAGED = ["bg-state-active", "text-foreground"];
    const classesOf = (el: HTMLElement) => new Set(el.className.split(/\s+/));
    const isEngaged = (el: HTMLElement) => {
      const classes = classesOf(el);
      return ENGAGED.every((engagedClass) => classes.has(engagedClass));
    };
    const byLabel = (prefix: string) => {
      const el = container.querySelector<HTMLElement>(
        `button[aria-label^="${prefix}"]`,
      );
      if (el === null) throw new Error(`no trigger labelled ${prefix}`);
      return el;
    };
    const filters = () => byLabel("Filters");
    const sort = () => byLabel("Sort:");

    for (const trigger of [filters(), sort()]) {
      expect(isEngaged(trigger)).toBe(false);
      expect(classesOf(trigger).has("bg-state-active")).toBe(false);
    }

    fireEvent.pointerDown(filters());
    expect(isEngaged(filters())).toBe(true);
    expect(isEngaged(sort())).toBe(false);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(isEngaged(filters())).toBe(false);

    fireEvent.pointerDown(sort());
    expect(isEngaged(sort())).toBe(true);
    expect(isEngaged(filters())).toBe(false);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(isEngaged(sort())).toBe(false);

    fireEvent.pointerDown(filters());
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "bb" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(isEngaged(filters())).toBe(true);
  });

  it("uses compact, icon-free sort options and preserves disabled state", () => {
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

    const sortTrigger = screen.getByRole("button", {
      name: "Sort: Automation name, ascending",
    });
    expect(sortTrigger.querySelector('[data-icon="ArrowUpDown"]')).toBeTruthy();
    fireEvent.pointerDown(sortTrigger);
    const projectOption = screen.getByRole("menuitemradio", {
      name: "Project",
    });
    const nameOption = screen.getByRole("menuitemradio", {
      name: "Automation name",
    });
    expect(projectOption.getAttribute("aria-disabled")).toBe("true");
    expect(projectOption.getAttribute("aria-checked")).toBe("false");
    expect(nameOption.getAttribute("aria-checked")).toBe("true");
    expect(iconNames(projectOption)).toEqual(["ArrowUp"]);
    expect(iconNames(nameOption)).toEqual(["ArrowUp"]);
    fireEvent.click(nameOption);
    expect(sortTrigger.querySelector('[data-icon="ArrowUpDown"]')).toBeTruthy();
    expect(iconNames(nameOption)).toEqual(["ArrowDown"]);
    expect(sortTrigger.getAttribute("aria-label")).toBe(
      "Sort: Automation name, descending",
    );
  });

  it("preserves sort selection semantics in the compact viewport drawer", async () => {
    render(
      <CompactViewportOverrideProvider isCompactViewport>
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
        />
      </CompactViewportOverrideProvider>,
    );

    const sortTrigger = screen.getByRole("button", {
      name: "Sort: Automation name, ascending",
    });
    fireEvent.click(sortTrigger);

    const projectOption = await screen.findByRole("menuitemradio", {
      name: "Project",
    });
    const nameOption = screen.getByRole("menuitemradio", {
      name: "Automation name",
    });
    expect(projectOption.getAttribute("aria-checked")).toBe("false");
    expect(projectOption.getAttribute("aria-disabled")).toBe("true");
    expect((projectOption as HTMLButtonElement).disabled).toBe(true);
    expect(nameOption.getAttribute("aria-checked")).toBe("true");
    expect(
      screen
        .getAllByRole("menuitemradio")
        .filter((option) => option.getAttribute("aria-checked") === "true"),
    ).toHaveLength(1);

    fireEvent.click(projectOption);
    expect(sortTrigger.getAttribute("aria-label")).toBe(
      "Sort: Automation name, ascending",
    );
    fireEvent.click(nameOption);
    expect(sortTrigger.getAttribute("aria-label")).toBe(
      "Sort: Automation name, descending",
    );
    expect(nameOption.getAttribute("aria-checked")).toBe("true");
  });

  it("renders template actions as icon-only controls with specific labels", () => {
    const onCreateViaChat = vi.fn();
    const { container } = render(
      <AutomationOverviewView
        entries={[]}
        error={null}
        onRetry={() => {}}
        onOpenDetail={() => {}}
        onEnabledChange={async () => {}}
        onRunNow={async () => {}}
        onDelete={() => {}}
        onCreateViaChat={onCreateViaChat}
        activeMode="browse"
        onModeChange={() => {}}
      />,
    );

    const ciTemplateButton = screen.getByRole("button", {
      name: "Use template: CI failure triage",
    });
    expect(
      ciTemplateButton.querySelector('[data-icon="MessageCirclePlus"]'),
    ).toBeTruthy();
    expect(ciTemplateButton.textContent).toBe("");
    expect(
      screen.getAllByRole("button", {
        name: "Use template: CI failure triage",
      }),
    ).toHaveLength(1);

    fireEvent.click(
      container.querySelector(
        '[data-resource-card-pointer-action=""]',
      ) as HTMLElement,
    );
    expect(onCreateViaChat).toHaveBeenCalledOnce();
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
