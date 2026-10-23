// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NewThreadRequest } from "@get-bb/plugin-sdk";
import type {
  ExperimentalPermissionModePickerProps,
  ExperimentalProviderModelPickerProps,
  NewThreadComposerProps,
} from "@get-bb/plugin-sdk/app";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { toast } from "sonner";
import type {
  AgentExecutionUpdate,
  AutomationDetailResponse,
  DefaultEnvironment,
} from "./rpc-types.js";
import {
  AutomationDetailView as AutomationDetailViewBase,
  AgentAutomationDefinition,
  ScriptAutomationDefinition,
} from "../detail-view.js";
import {
  summarizeProjectDefaultEnvironment,
  type ProjectDefaultEnvironmentSummary,
} from "../lib/project-default-environment.js";
import type { EnvironmentCatalog } from "../lib/automation-environment.js";

const composerHarness = vi.hoisted(() => ({
  props: null as NewThreadComposerProps | null,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => ({
  ...(await importOriginal()),
  experimental_NewThreadComposer: (props: NewThreadComposerProps) => {
    composerHarness.props = props;
    return <div data-testid="bb-new-thread-composer" />;
  },
  experimental_ProviderModelPicker: ({
    value,
    onChange,
    routing,
    allowProviderChange,
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
      data-provider-change-allowed={
        allowProviderChange === false ? "false" : "true"
      }
      disabled={disabled}
      onClick={() =>
        onChange({
          providerId: "claude",
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
    routing,
    disabled,
  }: ExperimentalPermissionModePickerProps) => (
    <button
      type="button"
      aria-label="Permission mode"
      data-testid="bb-permission-mode-picker"
      data-provider-id={providerId}
      data-routing-kind={routing?.kind ?? "primary"}
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

afterEach(() => {
  cleanup();
  composerHarness.props = null;
  vi.mocked(toast.error).mockClear();
});

function renderedComposer(): NewThreadComposerProps {
  const props = composerHarness.props;
  if (props === null) throw new Error("The composer editor is not rendered");
  return props;
}

async function submitComposer(request: NewThreadRequest): Promise<unknown> {
  const { onSubmit } = renderedComposer();
  let outcome: unknown = "saved";
  await act(async () => {
    try {
      await onSubmit(request);
    } catch (error: unknown) {
      outcome = error;
    }
  });
  return outcome;
}

function composerRequest(
  overrides: Partial<NewThreadRequest> = {},
): NewThreadRequest {
  return {
    projectId: "proj_personal",
    providerId: "claude",
    model: "claude-sonnet-5",
    reasoningLevel: "high",
    permissionMode: "full",
    executionInputSources: {},
    environment: { type: "project-default" },
    input: [
      { type: "text", text: "Summarize the last two days.", mentions: [] },
    ],
    ...overrides,
  };
}

const ENVIRONMENT_CATALOG: EnvironmentCatalog = {
  providers: [
    {
      id: "git-worktree",
      displayName: "Worktree",
      icon: "FolderGit",
      logoUrl: null,
      machineProviderId: null,
    },
    {
      id: "project-checkout",
      displayName: "Project checkout",
      icon: "Laptop",
      logoUrl: null,
      machineProviderId: null,
    },
    {
      id: "personal-workspace",
      displayName: "Personal workspace",
      icon: "Folder",
      logoUrl: null,
      machineProviderId: null,
    },
    {
      id: "berth",
      displayName: "Berth",
      icon: "Cloud",
      logoUrl: null,
      machineProviderId: "berth",
    },
  ],
  machines: [{ id: "host_david", name: "david" }],
};

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
  lastRunAt: null,
  runCount: 0,
  lastRunStatus: null,
  lastRunThreadId: null,
  lastError: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

const REUSE_ENVIRONMENT_EXECUTION = {
  mode: "agent",
  prompt: "Summarize the inbox",
  providerId: "codex",
  model: "gpt-5.6-codex",
  reasoningLevel: "medium",
  permissionMode: "accept-edits",
  environment: { type: "reuse", environmentId: "env_test" },
} satisfies AutomationDetailResponse["execution"];

const REUSE_ENVIRONMENT_AUTOMATION: AutomationDetailResponse = {
  ...AUTOMATION,
  execution: REUSE_ENVIRONMENT_EXECUTION,
};

const NO_RUNS = {
  runs: [],
  nextCursor: null,
  loading: false,
  loadingMore: false,
  error: null,
  loadMore: () => {},
  retry: () => {},
};

type DefaultedDetailProp =
  | "editing"
  | "onCancelEdit"
  | "onUpdateAgent"
  | "projectDefaultEnvironment"
  | "environmentCatalog";

type TestAutomationDetailProps = Omit<
  ComponentProps<typeof AutomationDetailViewBase>,
  DefaultedDetailProp
> &
  Partial<
    Pick<ComponentProps<typeof AutomationDetailViewBase>, DefaultedDetailProp>
  >;

function AutomationDetailView({
  editing = false,
  onCancelEdit = () => {},
  onUpdateAgent = async () => {},
  projectDefaultEnvironment = null,
  environmentCatalog = null,
  ...props
}: TestAutomationDetailProps) {
  return (
    <AutomationDetailViewBase
      {...props}
      editing={editing}
      onCancelEdit={onCancelEdit}
      onUpdateAgent={onUpdateAgent}
      projectDefaultEnvironment={projectDefaultEnvironment}
      environmentCatalog={environmentCatalog}
    />
  );
}

type AgentExecution = Extract<
  AutomationDetailResponse["execution"],
  { mode: "agent" }
>;

function renderAgentDefinition({
  execution = REUSE_ENVIRONMENT_EXECUTION,
  editing = false,
  onUpdate = async () => {},
}: {
  execution?: AgentExecution;
  editing?: boolean;
  onUpdate?: (update: AgentExecutionUpdate) => Promise<void>;
} = {}) {
  const { container } = render(
    <AgentAutomationDefinition
      automationId="auto_1"
      projectId="proj_personal"
      execution={execution}
      editing={editing}
      personalProject={false}
      projectContextLabel="bb"
      projectDefaultEnvironment={null}
      environmentCatalog={ENVIRONMENT_CATALOG}
      pending={false}
      onCancel={() => {}}
      onUpdate={onUpdate}
    />,
  );
  return {
    environmentTitle: container.querySelector<HTMLElement>(
      '[data-automation-prompt-footer] [title^="Environment:"]',
    )?.title,
    problem:
      container.querySelector("[data-automation-environment-problem]")
        ?.textContent ?? null,
  };
}

describe("Automation detail recipe", () => {
  it("explains a failed agent run in the header and in its run row", () => {
    const error = "Target thread thr_target was archived";
    const run = {
      automationId: "auto_1",
      runMode: "agent",
      trigger: "schedule",
      skipReason: null,
      output: null,
      exitCode: null,
      scheduledFor: 1_800_000_000_000,
      startedAt: 1_800_000_000_000,
      finishedAt: 1_800_000_000_030,
    } as const;
    const { container } = render(
      <AutomationDetailView
        automation={{
          ...AUTOMATION,
          enabled: false,
          nextRunAt: null,
          lastRunStatus: "failed",
          lastError: error,
        }}
        projectLabel="Personal"
        runsState={{
          ...NO_RUNS,
          runs: [
            {
              ...run,
              id: "run_failed",
              threadId: null,
              status: "failed",
              error,
            },
            {
              ...run,
              id: "run_succeeded",
              threadId: "thr_target",
              status: "succeeded",
              error: null,
            },
          ],
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
      container.querySelector('[data-automation-error=""]')?.textContent,
    ).toBe(error);
    expect(
      [...container.querySelectorAll("pre")].map((block) => block.textContent),
    ).toEqual([error]);
  });

  it("renders the personal workspace through the host's environment provider icon", () => {
    const { container } = render(
      <AgentAutomationDefinition
        automationId="auto_1"
        projectId="proj_personal"
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
        projectDefaultEnvironment={null}
        environmentCatalog={ENVIRONMENT_CATALOG}
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
    expect(screen.getByRole("img", { name: "Project: Personal" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Schedule" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Next run" })).toBeTruthy();
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

    expect(
      container.querySelector('[data-automation-prompt-readonly-shell=""]'),
    ).toBeNull();
    expect(screen.getByText("Editing automation")).toBeTruthy();
    const composer = renderedComposer();
    expect(composer).toMatchObject({
      defaultProjectId: "proj_personal",
      allowProjectChange: false,
      allowProjectDefaultEnvironment: true,
      allowAttachments: false,
      allowPluginCustomizations: false,
      persistDraft: false,
      draftKey: "automation-edit:auto_1",
      initialPrompt: "Summarize yesterday's commits.",
      defaultProviderId: "claude",
      defaultModel: "claude-opus-5",
      defaultReasoningLevel: "medium",
      defaultPermissionMode: "auto",
      defaultEnvironment: { type: "host", workspace: { type: "personal" } },
    });
    expect(composer).not.toHaveProperty("defaultServiceTier");
    expect(composer).not.toHaveProperty("defaultSessionOptions");

    fireEvent.click(screen.getByRole("button", { name: "Cancel editing" }));
    expect(
      await screen.findByRole("textbox", { name: "Saved prompt" }),
    ).toBeTruthy();
    expect(updateAgent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Edit prompt" }));
    expect(
      await submitComposer(
        composerRequest({
          serviceTier: "fast",
          environment: {
            type: "provider",
            environmentProviderId: "git-worktree",
            machine: { type: "existing", hostId: "host_david" },
            inputs: { branch: { kind: "named", name: "dev" } },
          },
        }),
      ),
    ).toBe("saved");
    expect(updateAgent).toHaveBeenCalledWith({
      prompt: "Summarize the last two days.",
      providerId: "claude",
      model: "claude-sonnet-5",
      reasoningLevel: "high",
      serviceTier: "fast",
      permissionMode: "full",
      sessionOptions: null,
      target: {
        type: "environment",
        environment: {
          type: "provider",
          environmentProviderId: "git-worktree",
          machine: { type: "existing", hostId: "host_david" },
          inputs: { branch: { kind: "named", name: "dev" } },
        },
      },
    });
    expect(
      await screen.findByRole("textbox", { name: "Saved prompt" }),
    ).toBeTruthy();
    expect(screen.queryByText("Editing automation")).toBeNull();
  });

  it("opens the composer to complete an automation with a missing prompt", async () => {
    const onUpdate = vi.fn(async (_update: AgentExecutionUpdate) => {});
    render(
      <AutomationDetailView
        automation={{
          ...REUSE_ENVIRONMENT_AUTOMATION,
          execution: { ...REUSE_ENVIRONMENT_EXECUTION, prompt: "" },
        }}
        projectLabel="Test project"
        runsState={NO_RUNS}
        actionPending={false}
        editing
        onUpdateAgent={onUpdate}
        onToggle={() => {}}
        onEdit={() => {}}
        onRunNow={() => {}}
        onDelete={() => {}}
        onOpenThread={() => {}}
      />,
    );

    expect(
      (screen.getByRole("button", { name: "Edit prompt" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Run now" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(renderedComposer()).toMatchObject({
      initialPrompt: "",
      defaultEnvironment: { type: "reuse", environmentId: "env_test" },
    });

    const reusedEnvironment = {
      providerId: "codex",
      model: "gpt-5.6-codex",
      reasoningLevel: "medium",
      permissionMode: "accept-edits",
      environment: { type: "reuse", environmentId: "env_test" },
    } satisfies Partial<NewThreadRequest>;
    expect(
      await submitComposer(
        composerRequest({
          ...reusedEnvironment,
          input: [{ type: "text", text: " \n", mentions: [] }],
        }),
      ),
    ).toBeInstanceOf(Error);
    expect(toast.error).toHaveBeenCalledWith("Add a prompt before saving.");
    expect(onUpdate).not.toHaveBeenCalled();

    expect(
      await submitComposer(
        composerRequest({
          ...reusedEnvironment,
          input: [
            { type: "text", text: "Review the failed build", mentions: [] },
          ],
        }),
      ),
    ).toBe("saved");
    expect(onUpdate).toHaveBeenCalledWith({
      prompt: "Review the failed build",
      providerId: "codex",
      model: "gpt-5.6-codex",
      reasoningLevel: "medium",
      serviceTier: null,
      permissionMode: "accept-edits",
      sessionOptions: null,
      target: {
        type: "environment",
        environment: { type: "reuse", environmentId: "env_test" },
      },
    });
  });

  it("routes the read-only pickers to a reused environment", () => {
    render(
      <AutomationDetailView
        automation={REUSE_ENVIRONMENT_AUTOMATION}
        projectLabel="Test project"
        runsState={NO_RUNS}
        actionPending={false}
        onToggle={() => {}}
        onEdit={() => {}}
        onRunNow={() => {}}
        onDelete={() => {}}
        onOpenThread={() => {}}
      />,
    );

    const picker = screen.getByTestId("bb-provider-model-picker");
    expect(picker.getAttribute("data-routing-kind")).toBe("environment");
    expect(picker.getAttribute("data-routing-id")).toBe("env_test");
    expect(
      screen.getByLabelText("Permission mode").getAttribute("data-routing-kind"),
    ).toBe("environment");
  });

  it("keeps the prompt editor for an automation that messages an existing thread", () => {
    const onUpdate = vi.fn(async (_update: AgentExecutionUpdate) => {});
    renderAgentDefinition({
      execution: { ...REUSE_ENVIRONMENT_EXECUTION, targetThreadId: "thr_target" },
      editing: true,
      onUpdate,
    });

    expect(composerHarness.props).toBeNull();
    expect(
      screen
        .getByTestId("bb-provider-model-picker")
        .getAttribute("data-provider-change-allowed"),
    ).toBe("false");
    fireEvent.change(screen.getByLabelText("Automation prompt"), {
      target: { value: "Post the nightly summary" },
    });
    fireEvent.click(screen.getByLabelText("Permission mode"));
    fireEvent.click(screen.getByRole("button", { name: "Save Prompt" }));

    expect(onUpdate).toHaveBeenCalledWith({
      prompt: "Post the nightly summary",
      providerId: "codex",
      model: "gpt-5.6-codex",
      reasoningLevel: "medium",
      serviceTier: null,
      permissionMode: "full",
    });
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
});

describe("Automation project default environment", () => {
  const PROJECT_DEFAULT_EXECUTION = {
    mode: "agent",
    prompt: "Triage new issues",
    providerId: "codex",
    model: "gpt-5.6-codex",
    reasoningLevel: "medium",
    permissionMode: "auto",
    environment: { type: "project-default" },
  } satisfies AutomationDetailResponse["execution"];

  const PROVIDERS = [
    {
      id: "git-worktree",
      displayName: "Worktree",
      icon: "FolderGit",
      logoUrl: null,
    },
    { id: "berth", displayName: "Berth", icon: "Cloud", logoUrl: null },
  ];

  function summary(
    defaultEnvironment: DefaultEnvironment | null,
    problem: string | null = null,
  ) {
    return summarizeProjectDefaultEnvironment({
      defaultEnvironment,
      defaultEnvironmentProblem: problem === null ? null : { message: problem },
      providers: PROVIDERS,
      machines: [{ id: "host_david", name: "david" }],
    });
  }

  const WORKTREE_ON_DAVID: DefaultEnvironment = {
    type: "provider",
    environmentProviderId: "git-worktree",
    machine: { type: "existing", hostId: "host_david" },
  };

  function renderDefinition(
    projectDefaultEnvironment: ProjectDefaultEnvironmentSummary | null,
    execution: AgentExecution = PROJECT_DEFAULT_EXECUTION,
  ) {
    const { container } = render(
      <AgentAutomationDefinition
        automationId="auto_1"
        projectId="proj_bb"
        execution={execution}
        editing={false}
        personalProject={false}
        projectContextLabel="bb"
        projectDefaultEnvironment={projectDefaultEnvironment}
        environmentCatalog={ENVIRONMENT_CATALOG}
        pending={false}
        onCancel={() => {}}
        onUpdate={async () => {}}
      />,
    );
    const environment = container.querySelector(
      '[data-automation-prompt-footer] [title^="Environment:"]',
    ) as HTMLElement;
    return {
      container,
      environment,
      compactLabel: environment.querySelector("[data-promptbox-compact-label]")
        ?.textContent,
      problem: container.querySelector("[data-automation-environment-problem]"),
      modelRouting: screen.getByTestId("bb-provider-model-picker").dataset,
      permissionRouting: screen.getByTestId("bb-permission-mode-picker")
        .dataset,
    };
  }

  it("routes both pickers to the machine a usable project default runs on", () => {
    const view = renderDefinition(summary(WORKTREE_ON_DAVID));

    expect(view.environment.title).toBe(
      "Environment: Project default · Worktree on david",
    );
    expect(view.compactLabel).toBe("Worktree");
    expect(view.modelRouting.routingKind).toBe("host");
    expect(view.modelRouting.routingId).toBe("host_david");
    expect(view.permissionRouting.routingKind).toBe("host");
    expect(view.problem).toBeNull();
  });

  it("names a composition default by its catalog entry and keeps primary routing", () => {
    const view = renderDefinition(
      summary({
        type: "provider",
        environmentProviderId: "berth",
        machine: { type: "new" },
      }),
    );

    expect(view.environment.title).toBe("Environment: Project default · Berth");
    expect(
      view.environment
        .querySelector('[data-provider-kind="environment"]')
        ?.getAttribute("data-provider-id"),
    ).toBe("berth");
    expect(view.modelRouting.routingKind).toBe("primary");
    expect(view.permissionRouting.routingKind).toBe("primary");
  });

  it("says Automatic when the project has no default environment", () => {
    const view = renderDefinition(summary(null));

    expect(view.environment.title).toBe(
      "Environment: Project default · Automatic",
    );
    expect(view.compactLabel).toBe("Automatic");
    expect(view.modelRouting.routingKind).toBe("primary");
  });

  it("flags an unavailable default with its reason and stops routing to its machine", () => {
    const view = renderDefinition(
      summary(WORKTREE_ON_DAVID, "david has no checkout of bb"),
    );

    expect(view.environment.title).toBe(
      "Environment: Project default · Worktree on david (unavailable)",
    );
    expect(
      view.environment.querySelector('[data-icon="AlertTriangle"]'),
    ).not.toBeNull();
    expect(view.problem?.textContent).toBe(
      "Project default unavailable: david has no checkout of bb. Runs fail until it is fixed.",
    );
    expect(view.modelRouting.routingKind).toBe("primary");
    expect(view.permissionRouting.routingKind).toBe("primary");
  });

  it.each([
    ["usable", summary(WORKTREE_ON_DAVID)],
    ["unavailable", summary(WORKTREE_ON_DAVID, "its machine no longer exists")],
  ])(
    "ignores a %s project default when runs go to an existing thread",
    (_state, projectDefaultEnvironment) => {
      const view = renderDefinition(projectDefaultEnvironment, {
        ...PROJECT_DEFAULT_EXECUTION,
        targetThreadId: "thr_target",
      });

      expect(view.environment.title).toBe("Environment: Existing thread");
      expect(view.problem).toBeNull();
      expect(view.modelRouting.routingKind).toBe("primary");
    },
  );
});

describe("Automation environment", () => {
  it("names a worktree's machine and base branch and routes both pickers there", () => {
    const view = renderAgentDefinition({
      execution: {
        ...REUSE_ENVIRONMENT_EXECUTION,
        environment: {
          type: "provider",
          environmentProviderId: "git-worktree",
          machine: { type: "existing", hostId: "host_david" },
          inputs: { branch: { kind: "named", name: "dev" } },
        },
      },
    });

    expect(view.environmentTitle).toBe(
      "Environment: Worktree on david · from dev",
    );
    expect(view.problem).toBeNull();
    for (const picker of [
      screen.getByTestId("bb-provider-model-picker"),
      screen.getByTestId("bb-permission-mode-picker"),
    ]) {
      expect(picker.dataset.routingKind).toBe("host");
    }
    expect(
      screen.getByTestId("bb-provider-model-picker").dataset.routingId,
    ).toBe("host_david");
  });

  it("shows the checkout path a saved workspace keeps", () => {
    const view = renderAgentDefinition({
      execution: {
        ...REUSE_ENVIRONMENT_EXECUTION,
        environment: {
          type: "provider",
          environmentProviderId: "project-checkout",
          machine: { type: "existing", hostId: "host_david" },
          inputs: { path: "/Users/you/Code/bb" },
        },
      },
    });

    expect(view.environmentTitle).toBe("Environment: ~/Code/bb");
  });

  it("warns that runs fail while the environment's provider is missing", () => {
    const view = renderAgentDefinition({
      execution: {
        ...REUSE_ENVIRONMENT_EXECUTION,
        environment: {
          type: "provider",
          environmentProviderId: "modal-sandbox",
          inputs: null,
        },
      },
    });

    expect(view.problem).toBe(
      "Environment unavailable: the modal-sandbox environment provider is not installed. Runs fail until it is fixed.",
    );
  });
});

describe("Automation composer editor", () => {
  it("seeds the stored service tier and agent options", () => {
    renderAgentDefinition({
      execution: {
        ...REUSE_ENVIRONMENT_EXECUTION,
        serviceTier: "fast",
        sessionOptions: { "web-search": true },
      },
      editing: true,
    });

    expect(renderedComposer()).toMatchObject({
      defaultServiceTier: "fast",
      defaultSessionOptions: { "web-search": true },
    });
  });

  it.each([
    [
      "an attachment",
      composerRequest({
        input: [
          { type: "text", text: "Compare with this", mentions: [] },
          { type: "localImage", path: "/tmp/screenshot.png" },
        ],
      }),
      "An automation prompt is text only. Remove the attachment to save.",
    ],
    [
      "another project",
      composerRequest({ projectId: "proj_other" }),
      "An automation stays in its project.",
    ],
  ])(
    "refuses %s with a toast and rejects so the composer keeps the draft",
    async (_case, request, message) => {
      const onUpdate = vi.fn(async (_update: AgentExecutionUpdate) => {});
      renderAgentDefinition({ editing: true, onUpdate });

      expect(await submitComposer(request)).toBeInstanceOf(Error);
      expect(toast.error).toHaveBeenCalledWith(message);
      expect(onUpdate).not.toHaveBeenCalled();
    },
  );

  it("rejects when the server refuses the update, so the composer keeps the draft", async () => {
    const refusal = new Error("the berth provider is not installed");
    renderAgentDefinition({
      editing: true,
      onUpdate: async () => {
        throw refusal;
      },
    });

    expect(await submitComposer(composerRequest())).toBe(refusal);
  });
});
