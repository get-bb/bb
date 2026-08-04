// @vitest-environment jsdom

/**
 * The Tools Hub detail pages share a shell, but the thing that actually keeps
 * them consistent is each tool type's *recipe*: which semantic sections appear,
 * in which order, under which label, and which of them are allowed to
 * disappear. These tests read the recipe straight off the rendered DOM via
 * `data-resource-detail-section`, so reordering, relabelling, or dropping a
 * required section fails here rather than silently drifting.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AutomationResponse,
  AutomationRunResponse,
} from "bb-plugin-automations/rpc-types";
import {
  AutomationDetailView,
  AutomationRunStatusIndicator,
} from "bb-plugin-automations/detail-view";
import {
  EMPTY_PLUGIN_UPDATE_STATE,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { PluginDetail } from "./PluginDetail";
import { SkillDetailView } from "./SkillDetailView";

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
});

/** The rendered recipe: each section's kind and its visible label, in order. */
function renderedRecipe(container: HTMLElement): Array<[string, string]> {
  return [...container.querySelectorAll("[data-resource-detail-section]")].map(
    (section) => [
      section.getAttribute("data-resource-detail-section") ?? "",
      section.querySelector("h2")?.textContent ?? "",
    ],
  );
}

const PLUGIN: PluginListItem = {
  id: "github",
  source: "builtin:github",
  rootDir: "/managed/plugins/github",
  version: "0.1.0",
  enabled: true,
  status: "running",
  statusDetail: null,
  description: "Browse GitHub issues and pull requests in BB.",
  name: "GitHub",
  icon: "Github",
  compactIconUrl: null,
  logoUrl: null,
  logoDarkUrl: null,
  hasSettings: false,
  handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
  services: [],
  schedules: [],
  cliCommand: null,
  capabilities: [],
  app: { hasApp: false, bundle: null },
  provenance: "catalog",
  isOrphanedBuiltin: false,
  catalogEntryId: "github",
  sourceDisplay: "BB Official · GitHub",
  updateState: EMPTY_PLUGIN_UPDATE_STATE,
};

function renderPlugin(plugin: PluginListItem) {
  const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
  return render(
    <MemoryRouter>
      <QueryClientWrapper>
        <PluginDetail
          isLoading={false}
          plugin={plugin}
          pending={false}
          openSourceDisabled
          onToggle={() => {}}
          onEdit={() => {}}
          onOpenSource={() => {}}
          onDelete={() => {}}
        />
      </QueryClientWrapper>
    </MemoryRouter>,
  );
}

describe("Plugin detail recipe", () => {
  it("places quiet release facts between About and Capabilities", () => {
    const { container } = renderPlugin(PLUGIN);

    expect(renderedRecipe(container)).toEqual([
      ["overview", "About"],
      ["release", "Release"],
      ["includes", "Capabilities"],
    ]);
  });

  it("names each activity section after its own object, with no Health wrapper", () => {
    const { container } = renderPlugin({
      ...PLUGIN,
      hasSettings: true,
      services: [{ name: "sync", state: "running" }],
      schedules: [
        {
          name: "nightly",
          cron: "0 3 * * *",
          nextRunAt: 1_800_000_000_000,
          lastRunAt: null,
          lastStatus: null,
          lastError: null,
        },
      ],
    });

    expect(renderedRecipe(container)).toEqual([
      ["overview", "About"],
      ["release", "Release"],
      ["includes", "Capabilities"],
      ["activity", "Background services"],
      ["activity", "Scheduled jobs"],
    ]);
  });

  it("omits an activity section the plugin has no rows for", () => {
    const { container } = renderPlugin({
      ...PLUGIN,
      services: [{ name: "sync", state: "running" }],
    });

    expect(renderedRecipe(container)).toEqual([
      ["overview", "About"],
      ["release", "Release"],
      ["includes", "Capabilities"],
      ["activity", "Background services"],
    ]);
  });

  it("keeps About present when a plugin declares no description", () => {
    const { container } = renderPlugin({ ...PLUGIN, description: null });

    expect(renderedRecipe(container).map(([kind]) => kind)).toContain(
      "overview",
    );
    expect(
      screen.getByText("This plugin does not describe itself."),
    ).toBeTruthy();
  });

  it("lists declared capabilities without category chrome", () => {
    const { container } = renderPlugin({
      ...PLUGIN,
      cliCommand: { name: "gh", summary: "Work with GitHub" },
      capabilities: [
        {
          kind: "skill",
          id: "review",
          label: "review",
          detail: "Skill this plugin adds to your agents",
        },
        {
          kind: "theme",
          id: "github.dark",
          label: "GitHub Dark",
          detail: null,
        },
        {
          kind: "agent-tool",
          id: "gh_search",
          label: "gh_search",
          detail: "Search GitHub",
        },
        {
          kind: "thread-integration",
          id: "mention:pr",
          label: "Pull requests",
          detail: "Mentions with #",
        },
      ],
    });

    const capabilities = container.querySelector(
      '[data-resource-detail-section="includes"]',
    );
    expect(capabilities?.querySelector("table")).not.toBeNull();
    expect(
      capabilities?.querySelector("[data-plugin-capability-group]"),
    ).toBeNull();

    for (const item of [
      "bb gh",
      "review",
      "gh_search",
      "Pull requests",
      "GitHub Dark",
    ] as const) {
      expect(screen.getByText(item)).toBeTruthy();
    }
  });

  it("collapses long capability descriptions until requested", () => {
    const description = "Long capability guidance ".repeat(20).trim();
    const { container } = renderPlugin({
      ...PLUGIN,
      capabilities: [
        {
          kind: "agent-tool",
          id: "long-tool",
          label: "Long tool",
          detail: description,
        },
      ],
    });

    const detail = screen.getByText(description);
    expect(detail.className).toContain("line-clamp-3");
    const disclosure = screen.getByRole("button", {
      name: "Show full description",
    });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(disclosure);

    expect(detail.className).not.toContain("line-clamp-3");
    expect(
      screen.getByRole("button", { name: "Show less" }).getAttribute(
        "aria-expanded",
      ),
    ).toBe("true");
    expect(container.textContent).toContain(description);
  });

  it("keeps browser-registered app surfaces in Capabilities", () => {
    setPluginSlotRegistrations("github", {
      homepageSections: [],
      settingsSections: [],
      navPanels: [
        {
          id: "issues",
          title: "Issues",
          icon: "Github",
          path: "issues",
          component: () => null,
        },
      ],
      threadPanelActions: [],
      sidebarFooterActions: [],
      fileOpeners: [],
      messageDirectives: [],
    });
    renderPlugin({ ...PLUGIN, app: { hasApp: true, bundle: null } });

    expect(screen.getByText("Issues")).toBeTruthy();
  });

  it("explains empty capabilities instead of dropping the section", () => {
    const { container } = renderPlugin(PLUGIN);

    expect(renderedRecipe(container)).toContainEqual([
      "includes",
      "Capabilities",
    ]);
    expect(
      screen.getByText("This plugin declares no user-facing capabilities."),
    ).toBeTruthy();
  });

  it("keeps a disabled plugin's static capabilities and explains the missing live ones", () => {
    const { container } = renderPlugin({
      ...PLUGIN,
      enabled: false,
      status: "disabled",
      capabilities: [
        {
          kind: "theme",
          id: "github.dark",
          label: "GitHub Dark",
          detail: null,
        },
      ],
    });

    expect(renderedRecipe(container)).toContainEqual([
      "includes",
      "Capabilities",
    ]);
    expect(screen.getByText("GitHub Dark")).toBeTruthy();
    expect(
      screen.getByText(
        "Some capabilities are only listed while the plugin is enabled.",
      ),
    ).toBeTruthy();
    expect(container.querySelector('[data-icon="Info"]')).toBeNull();
  });

  it("does not contradict a degraded plugin's still-running health banner", () => {
    renderPlugin({
      ...PLUGIN,
      status: "degraded",
      capabilities: [
        {
          kind: "theme",
          id: "github.dark",
          label: "GitHub Dark",
          detail: null,
        },
      ],
    });

    expect(screen.getByText("GitHub Dark")).toBeTruthy();
    expect(screen.queryByText(/This plugin isn't running/)).toBeNull();
    expect(screen.queryByText(/commands, settings, agent tools/)).toBeNull();
  });

  it("says an enabled plugin is not running rather than claiming it declares nothing", () => {
    renderPlugin({ ...PLUGIN, enabled: true, status: "error" });

    expect(
      screen.getByText(
        "This plugin isn't running yet, so what it adds can't be listed.",
      ),
    ).toBeTruthy();
  });

  it("keeps a disabled plugin with nothing static on the same explanation", () => {
    renderPlugin({ ...PLUGIN, enabled: false, status: "disabled" });

    expect(
      screen.getByText("Enable this plugin to see what it adds to bb."),
    ).toBeTruthy();
  });
});

describe("Detail page header slots", () => {
  it("renders actions, provenance badge, and overflow menu together", () => {
    // These used to be mutually exclusive — passing `actions` suppressed the
    // other two, which silently dropped the registry skill page's overflow
    // menu. All three now compose; this fails if the suppression returns.
    const { container } = render(
      <SkillDetailView
        title="writing-voice"
        path="/skills/writing-voice/SKILL.md"
        files={["/skills/writing-voice/SKILL.md"]}
        selectedPath="/skills/writing-voice/SKILL.md"
        onSelectFile={() => {}}
        contentState={{ kind: "ready", content: "# writing-voice" }}
        headerActions={<button type="button">Fork</button>}
        titleBadge={{
          label: "Imported",
          tooltip: "Discovered in Claude Code",
        }}
        overflowMenu={<button type="button">More</button>}
      />,
    );

    const header = container.querySelector("h1")?.closest("div")?.parentElement;
    expect(header).not.toBeNull();
    expect(screen.getByRole("button", { name: "Fork" })).toBeTruthy();
    expect(screen.getByText("Imported")).toBeTruthy();
    expect(screen.getByRole("button", { name: "More" })).toBeTruthy();
  });
});

describe("Plugin detail route states", () => {
  it("keeps the detail page width while loading and when the plugin is missing", () => {
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    const { container, rerender } = render(
      <QueryClientWrapper>
        <PluginDetail
          isLoading
          plugin={null}
          pending={false}
          openSourceDisabled
          onToggle={() => {}}
          onEdit={() => {}}
          onOpenSource={() => {}}
          onDelete={() => {}}
        />
      </QueryClientWrapper>,
    );
    expect(
      container.querySelector("[data-resource-detail-state]")?.className,
    ).toContain("max-w-5xl");

    rerender(
      <QueryClientWrapper>
        <PluginDetail
          isLoading={false}
          plugin={null}
          pending={false}
          openSourceDisabled
          onToggle={() => {}}
          onEdit={() => {}}
          onOpenSource={() => {}}
          onDelete={() => {}}
        />
      </QueryClientWrapper>,
    );
    expect(
      container.querySelector("[data-resource-detail-state]")?.className,
    ).toContain("max-w-5xl");
    expect(screen.getByText("Plugin not found.")).toBeTruthy();
  });
});

function renderSkill(files: readonly string[]) {
  return render(
    <SkillDetailView
      title="writing-voice"
      path="/skills/writing-voice/SKILL.md"
      files={files}
      selectedPath="/skills/writing-voice/SKILL.md"
      onSelectFile={() => {}}
      contentState={{ kind: "ready", content: "# writing-voice" }}
    />,
  );
}

describe("Skill detail recipe", () => {
  it("shows only Definition for a single-file skill", () => {
    const { container } = renderSkill(["/skills/writing-voice/SKILL.md"]);

    expect(renderedRecipe(container)).toEqual([
      ["definition", "/skills/writing-voice/SKILL.md"],
    ]);
  });

  it("puts Files ahead of Definition for a multi-file skill", () => {
    const { container } = renderSkill([
      "/skills/writing-voice/SKILL.md",
      "/skills/writing-voice/reference.md",
    ]);

    expect(renderedRecipe(container)).toEqual([
      ["includes", "Files"],
      ["definition", "/skills/writing-voice/SKILL.md"],
    ]);
  });

  it("keeps file-load failure copy neutral and puts severity on the icon", () => {
    const { container } = render(
      <SkillDetailView
        title="writing-voice"
        path="/skills/writing-voice/SKILL.md"
        files={["/skills/writing-voice/SKILL.md"]}
        selectedPath="/skills/writing-voice/SKILL.md"
        onSelectFile={() => {}}
        contentState={{
          kind: "error",
          message: "Could not load this file.",
          onRetry: () => {},
        }}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Could not load this file.");
    expect(alert.className).not.toContain("text-destructive");
    expect(
      container.querySelector('[data-icon="CircleX"]')?.getAttribute("class"),
    ).toContain("text-destructive");
  });
});

const AUTOMATION: AutomationResponse = {
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

const FAILED_SCRIPT_RUN: AutomationRunResponse = {
  id: "run_failed",
  automationId: AUTOMATION.id,
  runMode: "script",
  threadId: null,
  status: "failed",
  trigger: "schedule",
  skipReason: null,
  error: "provider timed out",
  output: null,
  exitCode: 1,
  scheduledFor: 1_700_000_000_000,
  startedAt: 1_700_000_000_000,
  finishedAt: 1_700_000_001_000,
};

describe("Automation detail recipe", () => {
  it("keeps Definition ahead of Runs, including with no runs yet", async () => {
    const { container } = render(
      <MemoryRouter>
        <AutomationDetailView
          automation={AUTOMATION}
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
        />
      </MemoryRouter>,
    );

    const recipe = renderedRecipe(container);
    expect(recipe.map(([kind]) => kind)).toEqual(["definition", "activity"]);
    expect(recipe.at(-1)?.[1]).toBe("Runs");
    const projectMetadataIcon = screen.getByRole("img", {
      name: "Local project",
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
      projectMetadataIcon.querySelector('[data-icon="Laptop"]'),
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
    expect(emptyRuns.className).toContain("items-center");
    expect(emptyRuns.className).toContain("text-center");
    const runsTable = emptyRuns.parentElement as HTMLElement;
    expect(runsTable.className).toContain("border");
    expect(runsTable.className).toContain("border-border");
    expect(runsTable.className).not.toContain("inline-block");

    const promptPanel = screen.getByText("Summarize yesterday's commits.")
      .parentElement as HTMLElement;
    expect(promptPanel.className).toContain("bg-background");
    expect(promptPanel.className).toContain("rounded-xl");
    expect(promptPanel.className).not.toContain("rounded-md");
    expect(promptPanel.className).not.toContain("shadow-xs");
    expect(promptPanel.className).not.toContain("shadow-sm");
    expect(promptPanel.lastElementChild?.className).not.toContain("border-t");
    const promptContent = promptPanel.querySelector(
      '[data-resource-prompt-content=""]',
    ) as HTMLElement;
    expect(promptContent.getAttribute("role")).toBe("textbox");
    expect(promptContent.getAttribute("aria-label")).toBe("Saved prompt");
    expect(promptContent.getAttribute("aria-readonly")).toBe("true");
    expect(promptContent.className).toContain("min-h-[68px]");
    expect(promptContent.className).toContain("px-4");
    expect(promptContent.className).toContain("pt-3");
    expect(promptContent.className).toContain("pb-1");
    const promptFooter = container.querySelector(
      '[data-automation-prompt-footer=""]',
    ) as HTMLElement;
    expect(promptFooter.className).toContain("justify-between");
    expect(promptFooter.className).toContain("px-3.5");
    expect(promptFooter.textContent).toContain("Local");
    expect(promptFooter.textContent).toContain("Approve for me");
    expect(
      promptFooter.querySelectorAll('[data-option-display=""]'),
    ).toHaveLength(1);
    const accessSelector = promptFooter.querySelector(
      '[data-disabled-automation-selector="Permission mode"]',
    ) as HTMLButtonElement;
    expect(accessSelector.disabled).toBe(true);
    expect(accessSelector.getAttribute("aria-label")).toBe(
      "Permission mode: Approve for me. Read only",
    );
    expect(
      accessSelector.querySelector('[data-icon="ChevronDown"]'),
    ).not.toBeNull();
    expect(promptPanel.textContent).toContain("Opus 5");
    expect(promptPanel.textContent).toContain("Claude");
    expect(promptPanel.textContent).not.toContain("Reasoning");
    expect(promptPanel.textContent).not.toContain("Default");
    expect(
      container.querySelector('[data-automation-read-only-label=""]'),
    ).toBeNull();
    const modelSelector = promptPanel.querySelector(
      '[data-disabled-automation-selector="Provider and model"]',
    ) as HTMLButtonElement;
    expect(modelSelector.disabled).toBe(true);
    expect(modelSelector.getAttribute("aria-label")).toBe(
      "Provider and model: Claude, Opus 5. Read only",
    );
    expect(
      modelSelector.querySelector('[data-icon="ChevronDown"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-automation-provider-icon="claude"] svg'),
    ).not.toBeNull();
    const modelDisabledTrigger = screen.getByLabelText(
      "Provider and model. Use Edit with chat to change the provider and model.",
    );
    expect(modelDisabledTrigger.className).toContain("cursor-not-allowed");
    fireEvent.focus(modelDisabledTrigger);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Use Edit with chat to change the provider and model.",
    );
    fireEvent.blur(modelDisabledTrigger);

    const permissionDisabledTrigger = screen.getByLabelText(
      "Permission mode. Use Edit with chat to change permissions.",
    );
    expect(permissionDisabledTrigger.className).toContain("cursor-not-allowed");
    fireEvent.focus(permissionDisabledTrigger);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Use Edit with chat to change permissions.",
    );
  });

  it("uses the composer metadata treatment without inventing reasoning", () => {
    const { container } = render(
      <MemoryRouter>
        <AutomationDetailView
          automation={{
            ...AUTOMATION,
            projectId: "proj_bb",
            execution: {
              mode: "agent",
              prompt: "Summarize yesterday's commits.",
              providerId: "claude",
              model: "claude-opus-5",
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
        />
      </MemoryRouter>,
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
    expect(promptShell.textContent).not.toContain("Reasoning");
    expect(
      promptShell.querySelectorAll('[data-option-display=""]'),
    ).toHaveLength(2);
    expect(
      promptShell.querySelectorAll(
        "[data-disabled-automation-selector]:disabled",
      ),
    ).toHaveLength(2);
  });

  it.each([
    {
      providerId: "claude",
      model: "claude-opus-5[1m]",
      providerLabel: "Claude",
      modelLabel: "Opus 5 (1M)",
      iconId: "claude",
    },
    {
      providerId: "codex",
      model: "gpt-5.6-sol",
      providerLabel: "Codex",
      modelLabel: "5.6 Sol",
      iconId: "codex",
    },
    {
      providerId: "pi",
      model: "pi-model",
      providerLabel: "Pi",
      modelLabel: "Pi Model",
      iconId: "pi",
    },
    {
      providerId: "acp-cursor",
      model: "cursor-small",
      providerLabel: "Cursor",
      modelLabel: "Cursor Small",
      iconId: "acp-cursor",
    },
    {
      providerId: "custom-provider",
      model: "custom-model-v2",
      providerLabel: "Custom-provider",
      modelLabel: "Custom Model v2",
      iconId: null,
    },
  ])(
    "renders the $providerLabel provider identity in saved prompt metadata",
    ({ providerId, model, providerLabel, modelLabel, iconId }) => {
      const { container } = render(
        <MemoryRouter>
          <AutomationDetailView
            automation={{
              ...AUTOMATION,
              execution: {
                mode: "agent",
                prompt: "Summarize yesterday's commits.",
                providerId,
                model,
                permissionMode: "auto",
                environment: {
                  type: "host",
                  workspace: { type: "personal" },
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
          />
        </MemoryRouter>,
      );

      const selector = container.querySelector(
        '[data-disabled-automation-selector="Provider and model"]',
      ) as HTMLButtonElement;
      expect(selector.getAttribute("aria-label")).toBe(
        `Provider and model: ${providerLabel}, ${modelLabel}. Read only`,
      );
      expect(selector.textContent).toContain(modelLabel);
      expect(
        selector.querySelector('[data-promptbox-compact-label=""]'),
      ).toBeNull();
      if (iconId) {
        expect(
          selector.querySelector(
            `[data-automation-provider-icon="${iconId}"] svg`,
          ),
        ).not.toBeNull();
      } else {
        const fallback = selector.querySelector(
          `[data-automation-provider-label="${providerId}"]`,
        );
        expect(fallback?.textContent).toBe(providerLabel);
      }
    },
  );

  it("does not treat a project named Local as the personal project", () => {
    const { container } = render(
      <MemoryRouter>
        <AutomationDetailView
          automation={{
            ...AUTOMATION,
            projectId: "proj_local_named",
            execution: {
              mode: "agent",
              prompt: "Summarize yesterday's commits.",
              providerId: "codex",
              model: "gpt-5",
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
        />
      </MemoryRouter>,
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
      container
        .querySelector(
          '[data-disabled-automation-selector="Provider and model"]',
        )
        ?.getAttribute("aria-label"),
    ).toBe("Provider and model: Codex, 5. Read only");
  });

  it("shows the stored script with capped overflow and no environment values", () => {
    const storedScript = Array.from(
      { length: 20 },
      (_, index) => `echo "report ${index + 1}"`,
    ).join("\n");
    const { container } = render(
      <MemoryRouter>
        <AutomationDetailView
          automation={{
            ...AUTOMATION,
            execution: {
              mode: "script",
              script: storedScript,
              interpreter: "bash",
              timeoutMs: 60_000,
              env: {
                REPORT_OUTPUT: "/private/reports",
                GH_TOKEN: "secret-token",
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
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Script" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Script file" })).toBeNull();
    expect(container.textContent).toContain("2 env vars");
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

  it("uses the shared shimmer treatment while runs are loading", () => {
    const { container } = render(
      <MemoryRouter>
        <AutomationDetailView
          automation={AUTOMATION}
          projectLabel="Local"
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
        />
      </MemoryRouter>,
    );

    const loading = screen.getByRole("status", { name: "Loading runs" });
    expect(loading.textContent).toBe("");
    expect(loading.querySelectorAll(".animate-pulse")).toHaveLength(3);
    expect(container.textContent).not.toContain("Loading…");
  });

  it("keeps run-load failure quiet and actionable", () => {
    const { container } = render(
      <MemoryRouter>
        <AutomationDetailView
          automation={AUTOMATION}
          projectLabel="Local"
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
        />
      </MemoryRouter>,
    );

    const errorState = screen
      .getByText("Runs unavailable.")
      .closest('[data-automation-runs-state="error"]') as HTMLElement;
    expect(errorState.className).not.toContain("text-destructive");
    expect(container.querySelector('[data-icon="CircleX"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("keeps failed script details readable without repeating severity color", () => {
    render(
      <MemoryRouter>
        <AutomationDetailView
          automation={{
            ...AUTOMATION,
            execution: {
              mode: "script",
              script: "pnpm test",
              interpreter: "bash",
              timeoutMs: 60_000,
            },
          }}
          projectLabel="Local"
          runsState={{
            runs: [FAILED_SCRIPT_RUN],
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
        />
      </MemoryRouter>,
    );

    const details = screen.getByText("provider timed out");
    expect(details.tagName).toBe("PRE");
    expect(details.className).toContain("text-foreground");
    expect(details.className).not.toContain("text-destructive");
  });

  it.each([
    ["failed", "CircleX", "text-destructive"],
    ["succeeded", "CircleCheck", "text-success"],
    ["running", "Loading", "text-muted-foreground"],
    ["skipped", "ArrowTurnForward", "text-subtle-foreground"],
  ] as const)(
    "keeps the %s run label neutral and semantic color on its icon",
    (status, iconName, iconClass) => {
      const { container } = render(
        <AutomationRunStatusIndicator status={status} showLabel />,
      );

      const indicator = screen.getByRole("img", {
        name: status[0]!.toUpperCase() + status.slice(1),
      });
      expect(indicator.className).toContain("text-muted-foreground");
      expect(indicator.className).not.toContain("text-destructive");
      expect(indicator.className).not.toContain("text-success");
      expect(
        container
          .querySelector(`[data-icon="${iconName}"]`)
          ?.getAttribute("class"),
      ).toContain(iconClass);
    },
  );

  it("renders a subdued glyph for skipped runs", () => {
    const { container } = render(
      <AutomationRunStatusIndicator status="skipped" />,
    );

    expect(screen.getByRole("img", { name: "Skipped" })).toBeTruthy();
    // Not CircleDashed: icon.tsx aliases it to Spinner, so a skipped run drew
    // the same shape as a running one.
    const icon = container.querySelector('[data-icon="ArrowTurnForward"]');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("class")).toContain("text-subtle-foreground");
  });
});
