// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutomationOverviewView } from "bb-plugin-automations/overview-view";
import type { AutomationsOverviewResponse } from "bb-plugin-automations/rpc-types";

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
    const entry = (
      name: string,
      overrides: Partial<(typeof baseEntry)["automation"]> = {},
    ) => ({
      ...baseEntry,
      automation: {
        ...baseEntry.automation,
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
        onCreateViaChat={() => {}}
        activeMode="installed"
        onModeChange={() => {}}
      />,
    );

    expect(screen.getByRole("tab", { name: "Installed0" })).toBeTruthy();
    expect(screen.getByText("No automations installed.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New automation" })).toBeTruthy();
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

    fireEvent.focus(nextRunIcon);
    expect((await screen.findByRole("tooltip")).textContent).toBe("Next run");
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
