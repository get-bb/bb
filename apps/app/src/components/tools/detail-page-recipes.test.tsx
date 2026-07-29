// @vitest-environment jsdom

/**
 * The Tools Hub detail pages share a shell, but the thing that actually keeps
 * them consistent is each tool type's *recipe*: which semantic sections appear,
 * in which order, under which label, and which of them are allowed to
 * disappear. These tests read the recipe straight off the rendered DOM via
 * `data-resource-detail-section`, so reordering, relabelling, or dropping a
 * required section fails here rather than silently drifting.
 */

import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { AutomationResponse } from "bb-plugin-automations/rpc-types";
import { AutomationDetailView } from "bb-plugin-automations/detail-view";
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
  it("keeps Release directly below About, followed by Includes", () => {
    const { container } = renderPlugin(PLUGIN);

    expect(renderedRecipe(container)).toEqual([
      ["overview", "About"],
      ["release", "Release"],
      ["includes", "Includes"],
    ]);
  });

  it("places Settings and Activity after Includes when they apply", () => {
    const { container } = renderPlugin({
      ...PLUGIN,
      hasSettings: true,
      services: [{ name: "sync", state: "running" }],
    });

    expect(renderedRecipe(container)).toEqual([
      ["overview", "About"],
      ["release", "Release"],
      ["includes", "Includes"],
      ["configuration", "Settings"],
      ["activity", "Activity"],
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

  it("groups declared capabilities under product-facing Includes headings", () => {
    renderPlugin({
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

    // Bind each item to its own heading. Asserting that both strings merely
    // exist somewhere on the page passes even when two kinds are wired to each
    // other's groups, which is exactly the mis-wiring this guards against.
    for (const [heading, item] of [
      ["Command", "bb gh"],
      ["Skills", "review"],
      ["Agent tools", "gh_search"],
      ["Thread integrations", "Pull requests"],
      ["Themes", "GitHub Dark"],
    ] as const) {
      const group = screen
        .getByText(heading)
        .closest("[data-plugin-capability-group]");
      expect(group, `no group rendered for ${heading}`).not.toBeNull();
      expect(within(group as HTMLElement).getByText(item)).toBeTruthy();
    }
  });

  it("keeps browser-registered app surfaces in Includes", () => {
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

    expect(screen.getByText("App surfaces")).toBeTruthy();
    expect(screen.getByText("Issues")).toBeTruthy();
  });

  it("explains an empty Includes instead of dropping the section", () => {
    const { container } = renderPlugin(PLUGIN);

    expect(renderedRecipe(container)).toContainEqual(["includes", "Includes"]);
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

    expect(renderedRecipe(container)).toContainEqual(["includes", "Includes"]);
    expect(screen.getByText("GitHub Dark")).toBeTruthy();
    expect(
      screen.getByText(
        "Commands, settings, agent tools, app surfaces, and thread integrations are listed once this plugin is enabled.",
      ),
    ).toBeTruthy();
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
  it("renders actions, lifecycle control, and overflow menu together", () => {
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
        headerControl={{
          kind: "status",
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
});

const AUTOMATION: AutomationResponse = {
  id: "auto_1",
  projectId: "proj_1",
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

describe("Automation detail recipe", () => {
  it("keeps Definition ahead of Run history, including with no runs yet", () => {
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
    expect(recipe.at(-1)?.[1]).toBe("Run history");
  });
});
