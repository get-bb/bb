// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ExperimentalPermissionModePickerProps,
  ExperimentalProviderModelPickerProps,
} from "@get-bb/plugin-sdk/app";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import type {
  AgentExecutionUpdate,
  AutomationDetailResponse,
  AutomationRunResponse,
} from "./rpc-types.js";
import {
  AutomationDetailView as AutomationDetailViewBase,
  AgentAutomationDefinition,
  ScriptAutomationDefinition,
} from "../detail-view.js";

vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => ({
  ...(await importOriginal()),
  experimental_ProviderModelPicker: ({
    value,
    onChange,
    routing,
    disabled,
  }: ExperimentalProviderModelPickerProps) => (
    <button
      type="button"
      data-testid="bb-provider-model-picker"
      data-routing-kind={routing?.kind ?? "primary"}
      data-routing-id={
        routing === undefined
          ? ""
          : routing.kind === "host"
            ? routing.hostId
            : routing.environmentId
      }
      disabled={disabled}
      onClick={() =>
        onChange({
          providerId: value.providerId,
          model: "claude-sonnet-5",
          reasoningLevel: "high",
          serviceTier: "fast",
        })
      }
    >
      {value.providerId === "claude" ? "Claude" : value.providerId} ·{" "}
      {value.model === "claude-opus-5" ? "Opus 5" : value.model} ·{" "}
      {value.reasoningLevel}
    </button>
  ),
  experimental_PermissionModePicker: ({
    providerId,
    value,
    onChange,
    disabled,
  }: ExperimentalPermissionModePickerProps) => (
    <button
      type="button"
      aria-label="Permission mode"
      data-testid="bb-permission-mode-picker"
      data-provider-id={providerId}
      disabled={disabled}
      onClick={() => onChange(value === "full" ? "auto" : "full")}
    >
      {value === "accept-edits"
        ? "Accept Edits"
        : value === "auto"
          ? "Approve for me"
          : "Full Access"}
    </button>
  ),
}));

installTestPluginRuntime();

afterEach(cleanup);

function renderedRecipe(container: HTMLElement): Array<[string, string]> {
  return [...container.querySelectorAll("[data-resource-detail-section]")].map(
    (section) => [
      section.getAttribute("data-resource-detail-section") ?? "",
      section.querySelector("h2")?.textContent ?? "",
    ],
  );
}

const AUTOMATION: AutomationDetailResponse = {
  id: "auto_1",
  projectId: "proj_personal",
  name: "Nightly digest",
  enabled: true,
  trigger: { triggerType: "schedule", cron: "0 9 * * *", timezone: "UTC" },
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
  retryAt: null,
  lastRunAt: null,
  runCount: 0,
  lastRunStatus: null,
  lastRunThreadId: null,
  lastError: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

type TestAutomationDetailProps = Omit<
  ComponentProps<typeof AutomationDetailViewBase>,
  "editing" | "onCancelEdit" | "onUpdateAgent"
> &
  Partial<
    Pick<
      ComponentProps<typeof AutomationDetailViewBase>,
      "editing" | "onCancelEdit" | "onUpdateAgent"
    >
  >;

function AutomationDetailView({
  editing = false,
  onCancelEdit = () => {},
  onUpdateAgent = async () => {},
  ...props
}: TestAutomationDetailProps) {
  return (
    <AutomationDetailViewBase
      {...props}
      editing={editing}
      onCancelEdit={onCancelEdit}
      onUpdateAgent={onUpdateAgent}
    />
  );
}

describe("Automation detail recipe", () => {
  it("renders the personal workspace through the host's environment provider icon", () => {
    const { container } = render(
      <AgentAutomationDefinition
        execution={{
          mode: "agent",
          prompt: "Check",
          providerId: "codex",
          model: "test",
          reasoningLevel: "medium",
          permissionMode: "auto",
          environment: { type: "host", workspace: { type: "personal" } },
        }}
        editing={false}
        personalProject
        projectContextLabel="Personal"
        pending={false}
        onCancel={() => {}}
        onUpdate={async () => {}}
      />,
    );
    const footer = container.querySelector("[data-automation-prompt-footer]")!;
    const icon = footer.querySelector('[data-provider-kind="environment"]');
    expect(icon?.getAttribute("data-provider-id")).toBe("personal-workspace");
    expect(icon?.getAttribute("data-provider-fallback")).toBe("Folder");
  });

  it("keeps Definition ahead of Runs, including with no runs yet", async () => {
    const updateAgent = vi.fn(async (_update: AgentExecutionUpdate) => {});
    function Harness() {
      const [editing, setEditing] = useState(false);
      return (
        <AutomationDetailView
          automation={AUTOMATION}
          projectLabel="Personal"
          runsState={{
            runs: [],
            nextCursor: null,
            loading: false,
            loadingMore: false,
            error: null,
            loadMore: () => {},
            retry: () => {},
          }}
          actionPending={false}
          editing={editing}
          onUpdateAgent={async (update) => {
            await updateAgent(update);
            setEditing(false);
          }}
          onToggle={() => {}}
          onEdit={() => setEditing(true)}
          onCancelEdit={() => setEditing(false)}
          onRunNow={() => {}}
          onDelete={() => {}}
          onOpenThread={() => {}}
        />
      );
    }
    const { container } = render(<Harness />);

    const recipe = renderedRecipe(container);
    expect(recipe.map(([kind]) => kind)).toEqual(["definition", "activity"]);
    expect(recipe.at(-1)?.[1]).toBe("Runs");
    const projectMetadataIcon = screen.getByRole("img", {
      name: "Project: Personal",
    });
    const scheduleMetadataIcon = screen.getByRole("img", {
      name: "Schedule",
    });
    const nextRunMetadataIcon = screen.getByRole("img", {
      name: "Next run",
    });
    expect(projectMetadataIcon.tabIndex).toBe(0);
    expect(scheduleMetadataIcon.tabIndex).toBe(0);
    expect(nextRunMetadataIcon.tabIndex).toBe(0);
    expect(
      projectMetadataIcon.querySelector('[data-icon="Folder"]'),
    ).toBeTruthy();
    expect(
      scheduleMetadataIcon.querySelector('[data-icon="DateTime"]'),
    ).toBeTruthy();
    expect(
      nextRunMetadataIcon.querySelector('[data-icon="CalendarCheckOut02"]'),
    ).toBeTruthy();
    expect(screen.queryByText("Next run:")).toBeNull();

    const emptyRuns = screen
      .getByText("No runs yet.")
      .closest('[data-automation-runs-state="empty"]') as HTMLElement;
    expect(emptyRuns).not.toBeNull();

    const savedPrompt = screen.getByRole("textbox", { name: "Saved prompt" });
    expect(savedPrompt.getAttribute("aria-readonly")).toBe("true");
    expect(savedPrompt.getAttribute("aria-disabled")).toBe("true");
    const readOnlyPromptShell = container.querySelector(
      '[data-automation-prompt-readonly-shell=""]',
    ) as HTMLElement;
    expect(readOnlyPromptShell.contains(savedPrompt)).toBe(true);
    expect(savedPrompt.textContent).toBe("Summarize yesterday's commits.");
    expect(screen.queryByRole("button", { name: "Save Prompt" })).toBeNull();
    const disabledModelSelector = container.querySelector(
      '[data-testid="bb-provider-model-picker"]',
    ) as HTMLButtonElement;
    const disabledPermissionSelector = container.querySelector(
      '[data-testid="bb-permission-mode-picker"]',
    ) as HTMLButtonElement;
    expect(disabledModelSelector.disabled).toBe(true);
    expect(disabledPermissionSelector.disabled).toBe(true);
    expect(readOnlyPromptShell.contains(disabledModelSelector)).toBe(true);
    expect(readOnlyPromptShell.contains(disabledPermissionSelector)).toBe(true);
    const readOnlyPromptFooter = container.querySelector(
      '[data-automation-prompt-footer=""]',
    ) as HTMLElement;
    expect(readOnlyPromptShell.contains(readOnlyPromptFooter)).toBe(true);
    const editButton = screen.getByRole("button", { name: "Edit prompt" });
    expect(editButton.querySelector('[data-icon="Edit"]')).not.toBeNull();
    fireEvent.pointerMove(editButton);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Edit prompt",
    );

    fireEvent.click(editButton);

    const promptContent = screen.getByRole("textbox", {
      name: "Automation prompt",
    }) as HTMLTextAreaElement;
    const promptPanel = promptContent.closest("form") as HTMLElement;
    expect(
      container.querySelector('[data-automation-prompt-readonly-shell=""]'),
    ).toBeNull();
    expect(promptContent.value).toBe("Summarize yesterday's commits.");
    expect(promptContent.readOnly).toBe(false);
    const promptActionRow = container.querySelector(
      '[data-automation-prompt-action-row=""]',
    ) as HTMLElement;
    expect(promptPanel.contains(promptActionRow)).toBe(true);
    const promptFooter = container.querySelector(
      '[data-automation-prompt-footer=""]',
    ) as HTMLElement;
    expect(promptFooter.textContent).toContain("Personal workspace");
    expect(
      promptFooter.querySelector('[title="Environment: Personal workspace"]'),
    ).not.toBeNull();
    expect(promptFooter.textContent).toContain("Approve for me");
    expect(
      promptFooter.querySelectorAll('[data-option-display=""]'),
    ).toHaveLength(1);
    const accessSelector = promptFooter.querySelector(
      '[data-testid="bb-permission-mode-picker"]',
    ) as HTMLButtonElement;
    expect(accessSelector.disabled).toBe(false);
    expect(accessSelector.getAttribute("aria-label")).toBe("Permission mode");
    expect(promptPanel.textContent).toContain("Opus 5");
    expect(promptPanel.textContent).toContain("Claude");
    const modelSelector = promptPanel.querySelector(
      '[data-testid="bb-provider-model-picker"]',
    ) as HTMLButtonElement;
    expect(modelSelector.disabled).toBe(false);
    expect(modelSelector.textContent).toContain("medium");
    const savePrompt = screen.getByRole("button", { name: "Save Prompt" });
    expect(promptPanel.contains(savePrompt)).toBe(true);
    expect(savePrompt.querySelector('[data-icon="Check"]')).not.toBeNull();
    expect((savePrompt as HTMLButtonElement).disabled).toBe(true);
    const cancelEditing = screen.getByRole("button", { name: "Cancel" });
    expect((cancelEditing as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(cancelEditing);
    expect(
      await screen.findByRole("textbox", { name: "Saved prompt" }),
    ).toBeTruthy();
    expect(updateAgent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Edit prompt" }));
    const reopenedPrompt = screen.getByRole("textbox", {
      name: "Automation prompt",
    }) as HTMLTextAreaElement;
    const reopenedPanel = reopenedPrompt.closest("form") as HTMLElement;
    const reopenedModelSelector = reopenedPanel.querySelector(
      '[data-testid="bb-provider-model-picker"]',
    ) as HTMLButtonElement;
    const reopenedAccessSelector = container.querySelector(
      '[data-testid="bb-permission-mode-picker"]',
    ) as HTMLButtonElement;
    const reopenedSavePrompt = screen.getByRole("button", {
      name: "Save Prompt",
    });
    fireEvent.change(reopenedPrompt, {
      target: { value: "Summarize the last two days." },
    });
    fireEvent.click(reopenedModelSelector);
    fireEvent.click(reopenedAccessSelector);
    expect((reopenedSavePrompt as HTMLButtonElement).disabled).toBe(false);
    expect(
      (screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(reopenedSavePrompt);
    expect(updateAgent).toHaveBeenCalledWith({
      prompt: "Summarize the last two days.",
      providerId: "claude",
      model: "claude-sonnet-5",
      reasoningLevel: "high",
      serviceTier: "fast",
      permissionMode: "full",
    });
    expect(
      await screen.findByRole("textbox", { name: "Saved prompt" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("textbox", { name: "Automation prompt" }),
    ).toBeNull();
  });

  it("keeps project and environment metadata beside the host picker", () => {
    const { container } = render(
      <AutomationDetailView
        automation={{
          ...AUTOMATION,
          projectId: "proj_bb",
          execution: {
            mode: "agent",
            prompt: "Summarize yesterday's commits.",
            providerId: "claude",
            model: "claude-opus-5",
            reasoningLevel: "medium",
            permissionMode: "auto",
            environment: {
              type: "host",
              hostId: "host_local",
              workspace: {
                type: "unmanaged",
                path: "/Users/you/Code/bb",
                branch: {
                  kind: "existing",
                  name: "agent/tools-hub-schedules",
                },
              },
            },
          },
        }}
        projectLabel="bb"
        runsState={{
          runs: [],
          nextCursor: null,
          loading: false,
          loadingMore: false,
          error: null,
          loadMore: () => {},
          retry: () => {},
        }}
        actionPending={false}
        onToggle={() => {}}
        onEdit={() => {}}
        onRunNow={() => {}}
        onDelete={() => {}}
        onOpenThread={() => {}}
      />,
    );

    const promptShell = container.querySelector(
      '[data-promptbox-shell=""]',
    ) as HTMLElement;
    const promptFooter = promptShell.querySelector(
      '[data-automation-prompt-footer=""]',
    ) as HTMLElement;
    expect(promptShell.textContent).toContain("Claude");
    expect(promptShell.textContent).toContain("Opus 5");
    expect(promptFooter.textContent).toContain("bb");
    expect(promptFooter.textContent).toContain("~/Code/bb");
    expect(promptFooter.textContent).toContain("Approve for me");
    expect(promptShell.textContent).toContain("medium");
    expect(
      promptShell.querySelectorAll('[data-option-display=""]'),
    ).toHaveLength(2);
    expect(
      promptShell.querySelectorAll('[data-testid="bb-provider-model-picker"]'),
    ).toHaveLength(1);
  });

  it("does not treat a project named Local as the personal project", () => {
    const { container } = render(
      <AutomationDetailView
        automation={{
          ...AUTOMATION,
          projectId: "proj_local_named",
          execution: {
            mode: "agent",
            prompt: "Summarize yesterday's commits.",
            providerId: "codex",
            model: "gpt-5",
            reasoningLevel: "medium",
            permissionMode: "auto",
            environment: {
              type: "host",
              hostId: "host_local",
              workspace: {
                type: "unmanaged",
                path: "/Users/you/Code/local-project",
              },
            },
          },
        }}
        projectLabel="Local"
        runsState={{
          runs: [],
          nextCursor: null,
          loading: false,
          loadingMore: false,
          error: null,
          loadMore: () => {},
          retry: () => {},
        }}
        actionPending={false}
        onToggle={() => {}}
        onEdit={() => {}}
        onRunNow={() => {}}
        onDelete={() => {}}
        onOpenThread={() => {}}
      />,
    );

    expect(
      container.querySelector('[aria-label="Project"] [data-icon="Folder"]'),
    ).toBeTruthy();
    const promptFooter = container.querySelector(
      '[data-automation-prompt-footer=""]',
    ) as HTMLElement;
    expect(promptFooter.textContent).toContain("Local");
    expect(
      promptFooter.querySelectorAll('[data-option-display=""]'),
    ).toHaveLength(2);
    expect(
      container.querySelector('[data-testid="bb-provider-model-picker"]'),
    ).not.toBeNull();
  });

  it("shows the stored script with capped overflow and no environment values", () => {
    const storedScript = Array.from(
      { length: 20 },
      (_, index) => `echo "report ${index + 1}"`,
    ).join("\n");
    const { container } = render(
      <AutomationDetailView
        automation={{
          ...AUTOMATION,
          execution: {
            mode: "script",
            workingDirectory: { type: "project" },
            resolvedWorkingDirectory: "/srv/projects/digest",
            script: storedScript,
            interpreter: "bash",
            timeoutMs: 60_000,
            env: {
              REPORT_OUTPUT: "/private/reports",
              GH_TOKEN: "secret-token",
            },
          },
        }}
        projectLabel="Personal"
        runsState={{
          runs: [],
          nextCursor: null,
          loading: false,
          loadingMore: false,
          error: null,
          loadMore: () => {},
          retry: () => {},
        }}
        actionPending={false}
        onToggle={() => {}}
        onEdit={() => {}}
        onRunNow={() => {}}
        onDelete={() => {}}
        onOpenThread={() => {}}
      />,
    );

    expect(screen.getByRole("heading", { name: "Script" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Script file" })).toBeNull();
    expect(container.textContent).toContain("2 env vars");
    expect(container.textContent).toContain("/srv/projects/digest");
    expect(container.textContent).not.toContain("Project source");
    expect(container.textContent).not.toContain("/private/reports");
    expect(container.textContent).not.toContain("secret-token");

    const scriptScroll = screen.getByRole("region", {
      name: "Script contents",
    });
    expect(scriptScroll.querySelector("pre")?.textContent).toContain(
      storedScript,
    );
    expect(scriptScroll.className).toContain("max-h-64");
    expect(scriptScroll.className).toContain("transient-scrollbar");
    expect(scriptScroll.hasAttribute("data-scrollbar-scrolling")).toBe(false);
    Object.defineProperties(scriptScroll, {
      clientHeight: { configurable: true, value: 160 },
      scrollHeight: { configurable: true, value: 320 },
      scrollTop: { configurable: true, value: 0, writable: true },
    });
    fireEvent.scroll(scriptScroll);
    expect(scriptScroll.dataset.scrollbarScrolling).toBe("true");
    expect(
      container.querySelector('[data-automation-script-fade="below"]'),
    ).not.toBeNull();

    scriptScroll.scrollTop = 160;
    fireEvent.scroll(scriptScroll);
    expect(
      container.querySelector('[data-automation-script-fade="below"]'),
    ).toBeNull();

    const scriptPanel = scriptScroll.parentElement
      ?.parentElement as HTMLElement;
    expect(scriptPanel.className).toContain("bg-background");
    expect(scriptPanel.className).not.toContain("shadow-xs");
    expect(scriptPanel.className).not.toContain("shadow-sm");
    expect(scriptPanel.lastElementChild?.className).toContain(
      "bg-surface-recessed/55",
    );
  });

  it.each([
    [
      { type: "automation-storage" } as const,
      "/var/lib/bb/plugins/automations/scripts/auto_1",
      "/var/lib/bb/plugins/automations/scripts/auto_1",
    ],
    [{ type: "project" } as const, "/srv/projects/bb", "/srv/projects/bb"],
    [
      { type: "path", path: "/srv/automation-work" } as const,
      "/srv/automation-work",
      "/srv/automation-work",
    ],
    [{ type: "project" } as const, null, "Working directory unavailable"],
  ])(
    "shows the resolved script working directory",
    (workingDirectory, resolvedWorkingDirectory, label) => {
      const { container } = render(
        <ScriptAutomationDefinition
          execution={{
            mode: "script",
            script: "pwd\n",
            workingDirectory,
            resolvedWorkingDirectory,
            timeoutMs: 60_000,
          }}
        />,
      );

      expect(container.textContent).toContain(label);
      expect(
        container.querySelector(
          `[aria-label="${
            label === "Working directory unavailable"
              ? label
              : `Working directory: ${label}`
          }"]`,
        ),
      ).not.toBeNull();
    },
  );

  it("uses the shared shimmer treatment while runs are loading", async () => {
    const { container } = render(
      <AutomationDetailView
        automation={AUTOMATION}
        projectLabel="Personal"
        runsState={{
          runs: [],
          nextCursor: null,
          loading: true,
          loadingMore: false,
          error: null,
          loadMore: () => {},
          retry: () => {},
        }}
        actionPending={false}
        onToggle={() => {}}
        onEdit={() => {}}
        onRunNow={() => {}}
        onDelete={() => {}}
        onOpenThread={() => {}}
      />,
    );

    const loading = await screen.findByRole("status", {
      name: "Loading runs",
    });
    expect(loading.textContent).toBe("");
    expect(loading.querySelectorAll(".animate-pulse")).toHaveLength(3);
    expect(container.textContent).not.toContain("Loading…");
  });

  it("keeps run-load failure quiet and actionable", () => {
    const { container } = render(
      <AutomationDetailView
        automation={AUTOMATION}
        projectLabel="Personal"
        runsState={{
          runs: [],
          nextCursor: null,
          loading: false,
          loadingMore: false,
          error: "network unavailable",
          loadMore: () => {},
          retry: () => {},
        }}
        actionPending={false}
        onToggle={() => {}}
        onEdit={() => {}}
        onRunNow={() => {}}
        onDelete={() => {}}
        onOpenThread={() => {}}
      />,
    );

    const errorState = screen
      .getByText("Runs unavailable.")
      .closest('[data-automation-runs-state="error"]') as HTMLElement;
    expect(errorState.className).not.toContain("text-destructive");
    expect(container.querySelector('[data-icon="CircleX"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it.each([
    ["failed", "Failed", "CircleX", "text-destructive"],
    ["succeeded", "Succeeded", "CircleCheck", "text-success"],
    ["running", "Running", "Loading", "text-muted-foreground"],
    ["skipped", "Skipped", "ArrowTurnForward", "text-subtle-foreground"],
  ] as const)(
    "renders a %s run row with its semantic status glyph",
    (status, label, iconName, iconClass) => {
      const startedAt = 1_750_000_000_000;
      const run: AutomationRunResponse = {
        id: `run_${status}`,
        automationId: AUTOMATION.id,
        runMode: "agent",
        threadId: null,
        status,
        trigger: "schedule",
        skipReason: null,
        error: null,
        output: null,
        exitCode: null,
        scheduledFor: startedAt,
        startedAt,
        finishedAt: status === "running" ? null : startedAt + 42_000,
      };
      render(
        <AutomationDetailView
          automation={AUTOMATION}
          projectLabel="Local"
          runsState={{
            runs: [run],
            nextCursor: null,
            loading: false,
            loadingMore: false,
            error: null,
            loadMore: () => {},
            retry: () => {},
          }}
          actionPending={false}
          onToggle={() => {}}
          onEdit={() => {}}
          onRunNow={() => {}}
          onDelete={() => {}}
          onOpenThread={() => {}}
        />,
      );

      const indicator = screen.getByRole("img", { name: label });
      expect(
        indicator
          .querySelector(`[data-icon="${iconName}"]`)
          ?.getAttribute("class"),
      ).toContain(iconClass);
    },
  );
});
