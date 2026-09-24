// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { ResourceDetailPage } from "@bb/shared-ui/resource-list";
import type { SkillSummary } from "@bb/server-contract";
import { type PluginListItem } from "@/hooks/queries/plugin-settings-queries";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { PluginDetail } from "./PluginDetail";
import { SkillDetailView, splitMarkdownIntoChunks } from "./SkillDetailView";
import { projectSkillsQueryKey } from "@/hooks/queries/query-keys";
import { sdk } from "@/lib/sdk";
import {
  makePluginListItem,
  makePluginRegistrationSet,
} from "@/test/fixtures/plugins";
import { buildMarkdownFileImageRouting } from "@/components/ui/markdown-file-image-routing";

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  vi.restoreAllMocks();
});

function renderedRecipe(container: HTMLElement): Array<[string, string]> {
  return [...container.querySelectorAll("[data-resource-detail-section]")].map(
    (section) => [
      section.getAttribute("data-resource-detail-section") ?? "",
      section.querySelector("h2")?.textContent ?? "",
    ],
  );
}

const PLUGIN: PluginListItem = makePluginListItem({
  id: "github",
  source: "builtin:github",
  rootDir: "/managed/plugins/github",
  description: "Browse GitHub issues and pull requests in BB.",
  name: "GitHub",
  icon: "Github",
  provenance: "catalog",
  catalogEntryId: "github",
  publisherLabel: "BB Community",
  sourceDisplay: "BB Official · GitHub",
});

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
          catalogEntries={[]}
          onOpenPlugin={() => undefined}
        />
      </QueryClientWrapper>
    </MemoryRouter>,
  );
}

describe("Resource detail header", () => {
  it("keeps wrapped title metadata in the title column beside the leading icon", () => {
    render(
      <ResourceDetailPage
        leading={<span>Leading icon</span>}
        title="A long resource title"
        titleMeta={<span>Category</span>}
      >
        <div>Content</div>
      </ResourceDetailPage>,
    );

    const heading = screen.getByRole("heading", {
      name: "A long resource title",
    });
    const titleRow = heading.parentElement;
    const titleColumn = titleRow?.parentElement;
    const titleAndIcon = titleColumn?.parentElement;
    const leading = screen.getByText("Leading icon");

    expect(titleRow?.contains(screen.getByText("Category"))).toBe(true);
    expect(titleColumn?.contains(leading)).toBe(false);
    expect(titleAndIcon?.contains(leading)).toBe(true);
  });
});

describe("Plugin detail recipe", () => {
  it("omits Capabilities when the plugin has no capability rows", () => {
    const { container } = renderPlugin(PLUGIN);

    expect(renderedRecipe(container)).toEqual([
      ["overview", ""],
      ["release", "Details"],
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
      ["overview", ""],
      ["release", "Details"],
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
      ["overview", ""],
      ["release", "Details"],
      ["activity", "Background services"],
    ]);
  });

  it("keeps the description present when a plugin declares no description", () => {
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
    setPluginSlotRegistrations(
      "github",
      makePluginRegistrationSet({
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
      }),
    );
    renderPlugin({ ...PLUGIN, app: { hasApp: true, bundle: null } });

    expect(screen.getByText("Issues")).toBeTruthy();
  });

  it("links every capability with a stable destination to its owning surface", () => {
    const listSkills = vi
      .spyOn(sdk.skills, "list")
      .mockResolvedValue({ skills: [] });
    setPluginSlotRegistrations(
      "github",
      makePluginRegistrationSet({
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
      }),
    );
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
      ["review", `/skills/library/skill_${"a".repeat(64)}`],
    ] as const;
    for (const [name, href] of destinations) {
      expect(screen.getByRole("link", { name }).getAttribute("href")).toBe(
        href,
      );
    }
    expect(
      screen.getByRole("button", { name: "GitHub settings" }),
    ).toBeTruthy();
    expect(renderedRecipe(container).map(([kind]) => kind)).not.toContain(
      "configuration",
    );
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
    ).toBe("/skills?view=library");
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
  it("routes relative images from Markdown skill files", () => {
    const markdownLinkRouting = buildMarkdownFileImageRouting({
      path: "/skills/writing-voice/SKILL.md",
      rootPath: "/skills/writing-voice",
      threadId: null,
      resolveRelativeSrc: (path) => `/skill-preview/${path}`,
    });
    render(
      <SkillDetailView
        title="writing-voice"
        path="/skills/writing-voice/SKILL.md"
        files={["SKILL.md"]}
        selectedPath="SKILL.md"
        onSelectFile={() => {}}
        contentState={{
          kind: "ready",
          content: "![example](assets/example.png)",
        }}
        markdownLinkRouting={markdownLinkRouting}
      />,
    );

    expect(
      screen.getByRole("img", { name: "example" }).getAttribute("src"),
    ).toBe("/skill-preview/assets/example.png");
  });

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
      expect(
        container.querySelector("[data-resource-infinite-sentinel]"),
      ).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("never splits a chunk inside a code fence", () => {
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
