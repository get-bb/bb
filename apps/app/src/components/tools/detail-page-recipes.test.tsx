// @vitest-environment jsdom

/**
 * The Extensions detail pages share a shell, but the thing that actually keeps
 * them consistent is each tool type's *recipe*: which semantic sections appear,
 * in which order, under which label, and which of them are allowed to
 * disappear. These tests read the recipe straight off the rendered DOM via
 * `data-resource-detail-section`, so reordering, relabelling, or dropping a
 * required section fails here rather than silently drifting.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { SkillSummary } from "@bb/server-contract";
import type {
  AgentExecutionUpdate,
  AutomationExecutionOptionsResponse,
  AutomationResponse,
} from "bb-plugin-automations/rpc-types";
import {
  AutomationDetailView as AutomationDetailViewBase,
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
import { SkillDetailView, splitMarkdownIntoChunks } from "./SkillDetailView";
import { projectSkillsQueryKey } from "@/hooks/queries/query-keys";
import { sdk } from "@/lib/sdk";

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  vi.restoreAllMocks();
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
  publisherLabel: "BB Community",
  sourceDisplay: "BB Official · GitHub",
  updateState: EMPTY_PLUGIN_UPDATE_STATE,
};

function renderPlugin(
  plugin: PluginListItem,
  options?: { skills?: SkillSummary[]; seedSkillsCache?: boolean },
) {
  const { wrapper: QueryClientWrapper, queryClient } =
    createQueryClientTestHarness();
  if (options?.seedSkillsCache !== false) {
    queryClient.setQueryData(projectSkillsQueryKey(PERSONAL_PROJECT_ID), {
      skills: options?.skills ?? [],
    });
  }
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
  it("omits Capabilities when the plugin has no capability rows", () => {
    const { container } = renderPlugin(PLUGIN);

    expect(renderedRecipe(container)).toEqual([
      ["overview", "About"],
      ["release", "Release"],
    ]);
  });

  it("names each activity section after its own object, with no Health wrapper", () => {
    const { container } = renderPlugin({
      ...PLUGIN,
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
    const collapseDisclosure = screen.getByRole("button", {
      name: "Show less",
    });
    expect(collapseDisclosure.getAttribute("aria-expanded")).toBe("true");
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

  it("links every capability with a stable destination to its owning surface", () => {
    const listSkills = vi
      .spyOn(sdk.skills, "list")
      .mockResolvedValue({ skills: [] });
    setPluginSlotRegistrations("github", {
      homepageSections: [
        {
          id: "dashboard",
          title: "GitHub dashboard",
          component: () => null,
        },
      ],
      settingsSections: [
        {
          id: "advanced",
          title: "Advanced settings",
          component: () => null,
        },
      ],
      navPanels: [
        {
          id: "issues",
          title: "Issues",
          icon: "Github",
          path: "issues",
          component: () => null,
        },
      ],
      threadPanelActions: [
        {
          id: "inspect",
          title: "Inspect issue",
          component: () => null,
        },
      ],
      sidebarFooterActions: [],
      threadLists: [
        {
          id: "github-threads",
          title: "GitHub threads",
          component: () => null,
        },
      ],
      threadHeaderActions: [
        {
          id: "sync",
          title: "Sync status",
          component: () => null,
        },
      ],
      fileOpeners: [
        {
          id: "markdown",
          title: "Markdown viewer",
          extensions: ["md"],
          component: () => null,
        },
      ],
      messageDirectives: [],
    });
    const { container } = renderPlugin(
      {
        ...PLUGIN,
        app: { hasApp: true, bundle: null },
        capabilities: [
          {
            kind: "theme",
            id: "github.dark",
            label: "GitHub Dark",
            detail: null,
          },
          {
            kind: "skill",
            id: "review",
            label: "review",
            detail: "Reviews pull requests.",
          },
        ],
      },
      {
        skills: [
          {
            id: `skill_${"a".repeat(64)}`,
            name: "review",
            description: "Reviews pull requests.",
            provider: null,
            scope: "plugin",
            pluginId: "github",
            filePath: "/plugins/github/skills/review/SKILL.md",
            manageable: false,
            registrySkillId: null,
          },
        ],
      },
    );

    const destinations = [
      ["Settings", "/settings/plugins/github"],
      ["Issues", "/plugins/github/issues"],
      ["GitHub dashboard", "/#plugin-homepage:github:dashboard"],
      ["GitHub threads", "/settings/appearance"],
      ["Markdown viewer", "/settings/files"],
      ["GitHub Dark", "/settings/appearance"],
      ["review", `/extensions/skills/library/skill_${"a".repeat(64)}`],
    ] as const;
    for (const [name, href] of destinations) {
      expect(screen.getByRole("link", { name }).getAttribute("href")).toBe(
        href,
      );
    }
    expect(renderedRecipe(container)).toContainEqual([
      "configuration",
      "Configuration",
    ]);
    expect(screen.getAllByRole("link", { name: "Settings" })).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "Inspect issue" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Sync status" })).toBeNull();
    expect(listSkills).not.toHaveBeenCalled();
  });

  it("links uncached plugin skills to the library without discovering skills", () => {
    const listSkills = vi
      .spyOn(sdk.skills, "list")
      .mockResolvedValue({ skills: [] });

    renderPlugin(
      {
        ...PLUGIN,
        capabilities: [
          {
            kind: "skill",
            id: "review",
            label: "review",
            detail: "Reviews pull requests.",
          },
        ],
      },
      { seedSkillsCache: false },
    );

    expect(
      screen.getByRole("link", { name: "review" }).getAttribute("href"),
    ).toBe("/extensions/skills?view=library");
    expect(listSkills).not.toHaveBeenCalled();
  });

  it("does not preview an unloaded frontend app as a capability", () => {
    const { container } = renderPlugin({
      ...PLUGIN,
      app: { hasApp: true, bundle: null },
    });

    expect(renderedRecipe(container)).not.toContainEqual([
      "includes",
      "Capabilities",
    ]);
    expect(screen.queryByText("Frontend app")).toBeNull();
  });

  it("hides the entire Capabilities section for a disabled plugin", () => {
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

    expect(renderedRecipe(container)).not.toContainEqual([
      "includes",
      "Capabilities",
    ]);
    expect(screen.queryByText("GitHub Dark")).toBeNull();
    expect(
      screen.queryByText(
        "Some capabilities are only listed while the plugin is enabled.",
      ),
    ).toBeNull();
  });

  it("keeps the Capabilities section for an enabled plugin", () => {
    const { container } = renderPlugin({
      ...PLUGIN,
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

  it("omits Capabilities when an enabled plugin is not running and has no static rows", () => {
    const { container } = renderPlugin({
      ...PLUGIN,
      enabled: true,
      status: "error",
    });

    expect(renderedRecipe(container).map(([, label]) => label)).not.toContain(
      "Capabilities",
    );
  });

  it("omits Capabilities when a disabled plugin has no static rows", () => {
    const { container } = renderPlugin({
      ...PLUGIN,
      enabled: false,
      status: "disabled",
    });

    expect(renderedRecipe(container).map(([, label]) => label)).not.toContain(
      "Capabilities",
    );
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

  it("keeps short skill content in one chunk with no sentinel or pager", () => {
    const { container } = renderSkill(["/skills/writing-voice/SKILL.md"]);
    const viewport = container.querySelector<HTMLElement>(
      "[data-skill-content-viewport]",
    );
    expect(viewport).not.toBeNull();
    expect(
      screen.queryByRole("navigation", { name: "Skill content pagination" }),
    ).toBeNull();
    expect(
      container.querySelector("[data-resource-infinite-sentinel]"),
    ).toBeNull();
  });

  it("loads more chunks as the sentinel is reached, with no page buttons", () => {
    const intersectionCallbacks = new Set<IntersectionObserverCallback>();
    vi.stubGlobal(
      "IntersectionObserver",
      class IntersectionObserverMock {
        constructor(private readonly callback: IntersectionObserverCallback) {
          intersectionCallbacks.add(this.callback);
        }
        observe() {}
        unobserve() {}
        disconnect() {
          intersectionCallbacks.delete(this.callback);
        }
      },
    );
    try {
      // Two 121+ line sections separated by blank lines → two chunks.
      const section = (marker: string) =>
        `## ${marker}\n${Array.from({ length: 125 }, (_, i) => `${marker} line ${i}`).join("\n")}\n`;
      const content = `${section("alpha")}\n${section("omega")}`;
      const { container } = render(
        <SkillDetailView
          title="writing-voice"
          path="/skills/writing-voice/SKILL.md"
          files={["/skills/writing-voice/SKILL.md"]}
          selectedPath="/skills/writing-voice/SKILL.md"
          onSelectFile={() => {}}
          contentState={{ kind: "ready", content }}
        />,
      );

      expect(screen.getByText(/alpha line 0/)).toBeTruthy();
      expect(screen.queryByText(/omega line 0/)).toBeNull();
      expect(
        container.querySelector("[data-resource-infinite-sentinel]"),
      ).not.toBeNull();
      expect(screen.queryByRole("button", { name: /Next/ })).toBeNull();

      act(() => {
        for (const callback of intersectionCallbacks) {
          callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            {} as IntersectionObserver,
          );
        }
      });

      expect(screen.getByText(/omega line 0/)).toBeTruthy();
      // Everything is shown: the sentinel retires.
      expect(
        container.querySelector("[data-resource-infinite-sentinel]"),
      ).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("never splits a chunk inside a code fence", () => {
    // A fence spanning the would-be boundary must hold the chunk open.
    const fenced = [
      "intro",
      "",
      "```bash",
      ...Array.from({ length: 200 }, (_, i) => `command ${i}`),
      "```",
      "",
      "outro",
    ].join("\n");
    const chunks = splitMarkdownIntoChunks(fenced);
    for (const chunk of chunks) {
      const fenceCount = chunk
        .split("\n")
        .filter((line) => line.startsWith("```")).length;
      expect(fenceCount % 2).toBe(0);
    }
    expect(chunks.join("\n")).toBe(fenced);
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

const AUTOMATION_EXECUTION_OPTIONS: AutomationExecutionOptionsResponse = {
  models: [
    {
      id: "claude:claude-opus-5",
      model: "claude-opus-5",
      displayName: "Claude-Opus-5",
    },
    {
      id: "claude:claude-sonnet-5",
      model: "claude-sonnet-5",
      displayName: "Claude-Sonnet-5",
    },
  ],
  permissionModes: ["accept-edits", "auto", "full"],
};

type TestAutomationDetailProps = Omit<
  ComponentProps<typeof AutomationDetailViewBase>,
  | "editing"
  | "executionOptions"
  | "executionOptionsError"
  | "permissionModes"
  | "onCancelEdit"
  | "onUpdateAgent"
> &
  Partial<
    Pick<
      ComponentProps<typeof AutomationDetailViewBase>,
      | "editing"
      | "executionOptions"
      | "executionOptionsError"
      | "permissionModes"
      | "onCancelEdit"
      | "onUpdateAgent"
    >
  >;

function AutomationDetailView({
  editing = false,
  executionOptions = AUTOMATION_EXECUTION_OPTIONS,
  executionOptionsError = null,
  permissionModes = AUTOMATION_EXECUTION_OPTIONS.permissionModes,
  onCancelEdit = () => {},
  onUpdateAgent = async () => {},
  ...props
}: TestAutomationDetailProps) {
  return (
    <AutomationDetailViewBase
      {...props}
      editing={editing}
      executionOptions={executionOptions}
      executionOptionsError={executionOptionsError}
      permissionModes={permissionModes}
      onCancelEdit={onCancelEdit}
      onUpdateAgent={onUpdateAgent}
    />
  );
}

describe("Automation detail recipe", () => {
  it("keeps Definition ahead of Runs, including with no runs yet", async () => {
    const updateAgent = vi.fn(async (_update: AgentExecutionUpdate) => {});
    function Harness() {
      const [editing, setEditing] = useState(false);
      return (
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
    const { container } = render(
      <MemoryRouter>
        <Harness />
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
      '[data-disabled-automation-selector="Provider and model"]',
    ) as HTMLButtonElement;
    const disabledPermissionSelector = container.querySelector(
      '[data-disabled-automation-selector="Permission mode"]',
    ) as HTMLButtonElement;
    expect(disabledModelSelector.disabled).toBe(true);
    expect(disabledPermissionSelector.disabled).toBe(true);
    expect(readOnlyPromptShell.contains(disabledModelSelector)).toBe(true);
    expect(readOnlyPromptShell.contains(disabledPermissionSelector)).toBe(true);
    expect(disabledModelSelector.getAttribute("data-state")).toBeNull();
    expect(
      disabledModelSelector.parentElement?.getAttribute("data-state"),
    ).toBe(null);
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
    expect(promptFooter.textContent).toContain("Local");
    expect(promptFooter.textContent).toContain("Approve for me");
    expect(
      promptFooter.querySelectorAll('[data-option-display=""]'),
    ).toHaveLength(1);
    const accessSelector = promptFooter.querySelector(
      '[data-automation-selector="Permission mode"]',
    ) as HTMLButtonElement;
    expect(accessSelector.disabled).toBe(false);
    expect(accessSelector.getAttribute("aria-label")).toBe("Permission mode");
    expect(
      accessSelector.querySelector('[data-icon="ChevronDown"]'),
    ).not.toBeNull();
    expect(promptPanel.textContent).toContain("Opus 5");
    expect(promptPanel.textContent).toContain("Claude");
    // Scoped to the action row, which is where the model selector lives. The
    // form also contains the footer's Project/Environment labels, and the
    // compact environment label for a project-default environment is literally
    // "Default", so asserting against the whole form would silently guard the
    // wrong subject.
    expect(promptActionRow.textContent).not.toContain("Reasoning");
    expect(promptActionRow.textContent).not.toContain("Default");
    expect(
      container.querySelector('[data-automation-read-only-label=""]'),
    ).toBeNull();
    const modelSelector = promptPanel.querySelector(
      '[data-automation-selector="Provider and model"]',
    ) as HTMLButtonElement;
    expect(modelSelector.disabled).toBe(false);
    expect(modelSelector.getAttribute("aria-label")).toBe(
      "Provider and model: Claude, Opus 5",
    );
    expect(
      modelSelector.querySelector('[data-icon="ChevronDown"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-automation-provider-icon="claude"] svg'),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-automation-provider-icon="claude"] svg.block',
      ),
    ).not.toBeNull();
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
      '[data-automation-selector="Provider and model"]',
    ) as HTMLButtonElement;
    const reopenedAccessSelector = container.querySelector(
      '[data-automation-selector="Permission mode"]',
    ) as HTMLButtonElement;
    const reopenedSavePrompt = screen.getByRole("button", {
      name: "Save Prompt",
    });
    fireEvent.change(reopenedPrompt, {
      target: { value: "Summarize the last two days." },
    });
    fireEvent.keyDown(reopenedModelSelector, { key: "Enter" });
    await screen.findByRole("listbox");
    fireEvent.click(await screen.findByRole("option", { name: "Sonnet 5" }));
    fireEvent.keyDown(reopenedAccessSelector, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "Full Access" }));
    expect((reopenedSavePrompt as HTMLButtonElement).disabled).toBe(false);
    expect(
      (screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(reopenedSavePrompt);
    expect(updateAgent).toHaveBeenCalledWith({
      prompt: "Summarize the last two days.",
      model: "claude-sonnet-5",
      permissionMode: "full",
    });
    expect(
      await screen.findByRole("textbox", { name: "Saved prompt" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("textbox", { name: "Automation prompt" }),
    ).toBeNull();
  });

  it("does not make permission editing wait for model discovery", () => {
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
          editing
          executionOptions={null}
          permissionModes={["accept-edits", "auto", "full"]}
          onToggle={() => {}}
          onEdit={() => {}}
          onRunNow={() => {}}
          onDelete={() => {}}
          onOpenThread={() => {}}
        />
      </MemoryRouter>,
    );

    const permissionSelector = container.querySelector(
      '[data-automation-selector="Permission mode"]',
    ) as HTMLButtonElement;
    const modelSelector = container.querySelector(
      '[data-automation-selector="Provider and model"]',
    ) as HTMLButtonElement;
    expect(permissionSelector.disabled).toBe(false);
    expect(modelSelector.disabled).toBe(true);
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
      promptShell.querySelectorAll("[data-disabled-automation-selector]"),
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

  it("uses the shared shimmer treatment while runs are loading", async () => {
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

    const loading = await screen.findByRole("status", {
      name: "Loading runs",
    });
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
