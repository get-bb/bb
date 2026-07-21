// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render as renderDom,
  screen,
  waitFor,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { SkillSummary } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { sdk } from "@/lib/sdk";
import { SkillDetailView } from "../components/tools/SkillDetailView";
import {
  fetchRegistrySkills,
  fetchRegistrySkillEntry,
  installRegistrySkill,
  RegistrySkillsBrowsePage,
  resolveInstalledRegistrySkill,
  SkillDetailDialogView,
  SkillsLibrary,
  SkillsOverview,
  type RegistrySkill,
} from "./SkillsView";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function makeSkill(overrides: Partial<SkillSummary> = {}): SkillSummary {
  return {
    id: `skill_${"a".repeat(64)}`,
    name: "code-review",
    description: "Review the current diff.",
    provider: "claude-code",
    scope: "claude-user",
    pluginId: null,
    filePath: "/home/u/.claude/skills/code-review/SKILL.md",
    manageable: true,
    ...overrides,
  };
}

function makeRegistrySkill(
  overrides: Partial<RegistrySkill> = {},
): RegistrySkill {
  return {
    id: "owner/repo/useful-skill",
    source: "owner/repo",
    skillId: "useful-skill",
    name: "Useful skill",
    installs: 100,
    stars: 20,
    installUrl: null,
    url: "https://skills.sh/owner/repo/useful-skill",
    topic: "Development",
    summary: "A useful skill.",
    ...overrides,
  };
}

function renderInstalledSkillRoute() {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            skills: [],
            pagination: { page: 0, perPage: 24, total: 0, hasMore: false },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    ),
  );
  const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
  renderDom(
    <MemoryRouter initialEntries={["/tools/skills/installed/skill_missing"]}>
      <QueryClientWrapper>
        <Routes>
          <Route
            path="/tools/skills/installed/:skillId"
            element={<SkillsLibrary />}
          />
        </Routes>
      </QueryClientWrapper>
    </MemoryRouter>,
  );
}

function render(props: Partial<Parameters<typeof SkillsOverview>[0]>): string {
  return renderToStaticMarkup(
    <SkillsOverview
      skills={props.skills ?? []}
      isLoading={props.isLoading ?? false}
      hasError={props.hasError ?? false}
      onCreateSkill={props.onCreateSkill ?? (() => {})}
      onSelectSkill={props.onSelectSkill ?? (() => {})}
      onRetry={props.onRetry}
    />,
  );
}

describe("SkillsOverview", () => {
  it("renders flat rows with provider filter and sort controls", () => {
    const markup = render({
      skills: [
        makeSkill({ name: "claude-skill", provider: "claude-code" }),
        makeSkill({ name: "bb-skill", provider: null, scope: "bb-user" }),
      ],
    });
    expect(markup).toContain("claude-skill");
    expect(markup).toContain("Review the current diff.");
    expect(markup).toContain('aria-label="Agent"');
    expect(markup).toContain("Sort");
    expect(markup).toContain('role="tab"');
    expect(markup).toContain("Installed");
    expect(markup).toContain("Browse");
    expect(markup).not.toContain('aria-label="Open bb-skill"');
    expect(markup).not.toContain("group-hover:translate-x-1");
    expect(markup).toContain("group-hover:opacity-100");
    expect(markup.indexOf("Installed")).toBeLessThan(
      markup.indexOf('placeholder="Search skills"'),
    );
    expect(markup.indexOf("bb-skill")).toBeLessThan(
      markup.indexOf("claude-skill"),
    );
    expect(markup).not.toContain('aria-expanded="true"');
  });

  it("marks built-in skill rows with the shared provenance badge", () => {
    renderDom(
      <SkillsOverview
        skills={[
          makeSkill({
            name: "bb-cli",
            provider: null,
            scope: "bb-builtin",
            manageable: false,
          }),
        ]}
        isLoading={false}
        hasError={false}
        onCreateSkill={() => {}}
        onSelectSkill={() => {}}
      />,
    );

    const builtInPill = screen.getByText("Built-in").parentElement;
    expect(builtInPill?.className).toContain("rounded-md");
    expect(builtInPill?.className).toContain("bg-surface-recessed/45");
    expect(builtInPill?.className).toContain("text-subtle-foreground");
    expect(builtInPill?.className).toContain("font-medium");
    expect(builtInPill?.className).toContain("px-1.5");
    expect(builtInPill?.className).toContain("py-0");
  });

  it("renders browse content as the active full-page collection mode", () => {
    const registrySkill = makeRegistrySkill({ installs: 123_456, stars: 654 });
    const markup = renderToStaticMarkup(
      <SkillsOverview
        skills={[]}
        isLoading={false}
        hasError={false}
        activeMode="browse"
        browseContent={
          <RegistrySkillsBrowsePage
            skills={[registrySkill]}
            pagination={{ page: 0, perPage: 24, total: 1, hasMore: false }}
            isLoading={false}
            hasError={false}
            query=""
            pendingSkillId={null}
            onQueryChange={() => {}}
            onPageChange={() => {}}
            onInstall={() => {}}
            onUninstall={() => {}}
            onSelect={() => {}}
            isInstalled={() => true}
            canUninstall={() => true}
          />
        }
        onCreateSkill={() => {}}
        onSelectSkill={() => {}}
      />,
    );

    expect(markup).toContain("Useful skill");
    expect(markup).toContain('href="https://www.skills.sh/"');
    expect(markup).toContain("powered by");
    expect(markup).toContain('aria-label="123.5K installs"');
    expect(markup).toContain('aria-label="654 stars"');
    expect(markup).toContain(
      "grid grid-cols-[repeat(auto-fit,minmax(min(100%,23rem),1fr))] gap-2.5",
    );
    expect(markup).not.toContain("overflow-x-auto");
    expect(markup).toContain("Uninstall Useful skill from bb");
    expect(markup).toContain('aria-label="View details for Useful skill"');
  });

  it("paginates installed skills after sorting and filtering", () => {
    const skills = Array.from({ length: 12 }, (_, index) => {
      const ordinal = String(index + 1).padStart(2, "0");
      return makeSkill({
        name: `skill-${ordinal}`,
        filePath: `/skills/skill-${ordinal}/SKILL.md`,
      });
    });
    renderDom(
      <SkillsOverview
        skills={skills}
        isLoading={false}
        hasError={false}
        onCreateSkill={() => {}}
        onSelectSkill={() => {}}
      />,
    );

    expect(screen.getByText("1–10 of 12")).toBeTruthy();
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
    expect(screen.getByText("skill-10")).toBeTruthy();
    expect(screen.queryByText("skill-11")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("11–12 of 12")).toBeTruthy();
    expect(screen.getByText("Page 2 of 2")).toBeTruthy();
    expect(screen.queryByText("skill-10")).toBeNull();
    expect(screen.getByText("skill-11")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Next" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("confirms before uninstalling an installed skill from a Browse card", () => {
    const registrySkill = makeRegistrySkill();
    const onUninstall = vi.fn();
    renderDom(
      <RegistrySkillsBrowsePage
        skills={[registrySkill]}
        pagination={{ page: 0, perPage: 24, total: 1, hasMore: false }}
        isLoading={false}
        hasError={false}
        query=""
        pendingSkillId={null}
        onQueryChange={() => {}}
        onPageChange={() => {}}
        onInstall={() => {}}
        onUninstall={onUninstall}
        onSelect={() => {}}
        isInstalled={() => true}
        canUninstall={() => true}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Uninstall Useful skill from bb",
      }),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      screen.getByText('Remove "Useful skill" from your bb skills?'),
    ).toBeTruthy();
    expect(onUninstall).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Uninstall skill" }));
    expect(onUninstall).toHaveBeenCalledOnce();
    expect(onUninstall).toHaveBeenCalledWith(registrySkill);
  });

  it("keeps name-only installed matches passive without proven provenance", () => {
    const registrySkill = makeRegistrySkill();
    renderDom(
      <RegistrySkillsBrowsePage
        skills={[registrySkill]}
        pagination={{ page: 0, perPage: 24, total: 1, hasMore: false }}
        isLoading={false}
        hasError={false}
        query=""
        pendingSkillId={null}
        onQueryChange={() => {}}
        onPageChange={() => {}}
        onInstall={() => {}}
        onUninstall={() => {}}
        onSelect={() => {}}
        isInstalled={() => true}
        canUninstall={() => false}
      />,
    );

    expect(
      screen.getByLabelText("Installed Useful skill as a bb skill"),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: "Uninstall Useful skill from bb",
      }),
    ).toBeNull();
  });

  it("disables provider filters that have no matching skills", async () => {
    renderDom(
      <SkillsOverview
        skills={[
          makeSkill({
            name: "codex-skill",
            provider: "codex",
            scope: "codex-user",
          }),
        ]}
        isLoading={false}
        hasError={false}
        onCreateSkill={() => {}}
        onSelectSkill={() => {}}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Agent" }));

    await waitFor(() => {
      expect(
        screen
          .getByRole("menuitemcheckbox", { name: "Claude Code" })
          .getAttribute("aria-disabled"),
      ).toBe("true");
    });
    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "Codex" })
        .getAttribute("aria-disabled"),
    ).toBeNull();
  });

  it("renders a New bb skill create action", () => {
    expect(render({ skills: [] })).toContain("New bb skill");
  });

  it("keeps edit and delete actions in detail rather than overview rows", () => {
    const markup = render({
      skills: [
        makeSkill({
          name: "bb-skill",
          provider: null,
          scope: "bb-user",
          manageable: true,
        }),
        makeSkill({ name: "provider-skill" }),
      ],
    });
    expect(markup).not.toContain('aria-label="Edit bb-skill"');
    expect(markup).not.toContain('aria-label="Delete bb-skill"');
    expect(markup).not.toContain('aria-label="Edit provider-skill"');
    expect(markup).not.toContain('aria-label="Delete provider-skill"');
  });

  it("keeps create out of the list (templates live in the menu, not a panel)", () => {
    // The page is never truly empty (built-ins always ship), so there is no
    // persistent teaching panel; the create templates live in the closed menu.
    const markup = render({ skills: [] });
    expect(markup).toContain("New bb skill");
    expect(markup).not.toContain("Start from an example");
  });

  it("shows a loading skeleton", () => {
    const markup = render({ skills: [], isLoading: true });
    expect(markup).toContain('role="status"');
    expect(markup).toContain("Loading skills");
    expect(markup).toContain("animate-pulse");
    expect(markup).not.toContain("Start from an example");
  });

  it("shows a recoverable error state with a retry", () => {
    const markup = render({ skills: [], hasError: true, onRetry: () => {} });
    // Apostrophe is HTML-escaped in static markup, so match the stable fragment.
    expect(markup).toContain("load skills.");
    expect(markup).toContain("Retry");
    expect(markup).toContain('role="alert"');
  });
});

describe("SkillsLibrary installed detail routing", () => {
  it("keeps a detail loading state while the installed skill list resolves", () => {
    vi.spyOn(sdk.skills, "list").mockImplementation(
      () => new Promise(() => {}),
    );

    renderInstalledSkillRoute();

    expect(screen.getByText("Loading skill")).toBeTruthy();
    expect(screen.queryByText("New bb skill")).toBeNull();
  });

  it("shows a retryable detail error when installed skills fail to load", async () => {
    vi.spyOn(sdk.skills, "list").mockRejectedValue(
      new Error("skills unavailable"),
    );

    renderInstalledSkillRoute();

    expect(await screen.findByText("Couldn't load skill.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByText("New bb skill")).toBeNull();
  });

  it("shows not found on an unknown installed skill detail route", async () => {
    vi.spyOn(sdk.skills, "list").mockResolvedValue({ skills: [] });

    renderInstalledSkillRoute();

    expect(await screen.findByText("Skill not found.")).toBeTruthy();
    expect(screen.queryByText("New bb skill")).toBeNull();
  });
});

describe("SkillsLibrary registry detail lifecycle", () => {
  it("updates an installed detail in place and keeps uninstall available", async () => {
    const registrySkill = makeRegistrySkill();
    vi.spyOn(sdk.skills, "list").mockResolvedValue({ skills: [] });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith("/api/v1/skills-registry?")) {
          return new Response(
            JSON.stringify({
              skills: [registrySkill],
              pagination: { page: 0, perPage: 24, total: 1, hasMore: false },
            }),
            { status: 200 },
          );
        }
        if (url.startsWith("/api/v1/skills-registry/detail?")) {
          return new Response(
            JSON.stringify({
              id: registrySkill.id,
              source: registrySkill.source,
              skillId: registrySkill.skillId,
              hash: null,
              files: [{ path: "SKILL.md", contents: "# Useful skill" }],
            }),
            { status: 200 },
          );
        }
        if (
          url === "/api/v1/skills-registry/install" &&
          init?.method === "POST"
        ) {
          return new Response(
            JSON.stringify({
              ok: true,
              filePath: "/home/u/.bb/skills/useful-skill/SKILL.md",
            }),
            { status: 200 },
          );
        }
        return new Response(null, { status: 404 });
      }),
    );
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    const view = renderDom(
      <MemoryRouter
        initialEntries={["/tools/skills/registry/owner%2Frepo%2Fuseful-skill"]}
      >
        <QueryClientWrapper>
          <Routes>
            <Route
              path="/tools/skills/registry/:registrySkillId"
              element={<SkillsLibrary />}
            />
          </Routes>
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    const install = await screen.findByRole("button", {
      name: "Install Useful skill as a bb skill",
    });
    expect(install.querySelector('[data-icon="Download"]')).not.toBeNull();
    expect(view.container.querySelector('img[src="/bb-mark.svg"]')).toBeNull();
    fireEvent.click(install);

    const uninstall = await screen.findByRole("button", {
      name: "Uninstall Useful skill from bb",
    });
    expect(uninstall.textContent).toContain("Installed");
    fireEvent.click(uninstall);
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("does not offer installation when a direct registry source is unavailable", async () => {
    const registrySkill = makeRegistrySkill();
    vi.spyOn(sdk.skills, "list").mockResolvedValue({ skills: [] });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/v1/skills-registry?")) {
          return new Response(
            JSON.stringify({
              skills: [],
              pagination: { page: 0, perPage: 24, total: 0, hasMore: false },
            }),
            { status: 200 },
          );
        }
        if (url.startsWith("/api/v1/skills-registry/entry?")) {
          return new Response(JSON.stringify(registrySkill), { status: 200 });
        }
        return new Response(null, { status: 404 });
      }),
    );
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    renderDom(
      <MemoryRouter
        initialEntries={["/tools/skills/registry/owner%2Frepo%2Fuseful-skill"]}
      >
        <QueryClientWrapper>
          <Routes>
            <Route
              path="/tools/skills/registry/:registrySkillId"
              element={<SkillsLibrary />}
            />
          </Routes>
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(
        "This registry skill is no longer available from its source.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Install Useful skill/ }),
    ).toBeNull();
  });
});

describe("RegistrySkillsBrowsePage", () => {
  it("renders the authoritative page order, exposes social proof, and pages forward", async () => {
    const onPageChange = vi.fn();
    const alpha = makeRegistrySkill({
      id: "owner/repo/alpha",
      skillId: "alpha",
      name: "Alpha",
      installs: 10,
      stars: 100,
    });
    const zulu = makeRegistrySkill({
      id: "owner/repo/zulu",
      skillId: "zulu",
      name: "Zulu",
      installs: 20,
      stars: 10,
    });
    const onSelect = vi.fn();
    renderDom(
      <RegistrySkillsBrowsePage
        skills={[alpha, zulu]}
        pagination={{ page: 0, perPage: 24, total: 48, hasMore: true }}
        isLoading={false}
        hasError={false}
        query=""
        pendingSkillId={null}
        onQueryChange={() => {}}
        onPageChange={onPageChange}
        onInstall={() => {}}
        onUninstall={() => {}}
        onSelect={onSelect}
        isInstalled={(skill) => skill.id === alpha.id}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "View details for Alpha" }),
    );
    expect(onSelect).toHaveBeenCalledWith(alpha);
    expect(screen.getByText("1–2 of 48")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Search skills" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /skills\.sh/ })).toBeTruthy();
    expect(screen.getByText("powered by")).toBeTruthy();
    expect(screen.getByLabelText("10 installs")).toBeTruthy();
    expect(screen.getByLabelText("100 stars")).toBeTruthy();
    expect(screen.getByLabelText("Installed Alpha as a bb skill")).toBeTruthy();
    expect(
      screen
        .getByLabelText("Installed Alpha as a bb skill")
        .querySelector('[data-icon="Check"]'),
    ).not.toBeNull();
    const zuluInstall = screen.getByRole("button", {
      name: "Install Zulu as a bb skill",
    });
    expect(zuluInstall.textContent).toBe("");
    expect(zuluInstall.querySelector('[data-icon="Download"]')).not.toBeNull();
    fireEvent.pointerMove(zuluInstall);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Install Zulu",
    );

    expect(screen.queryByRole("button", { name: "Sort" })).toBeNull();
    const alphaTitle = screen.getByText("Alpha");
    const zuluTitle = screen.getByText("Zulu");
    expect(
      alphaTitle.compareDocumentPosition(zuluTitle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });
});

describe("SkillDetailDialogView", () => {
  it("presents built-in ownership passively without an actions menu", async () => {
    const skill = makeSkill({
      name: "bb-cli",
      provider: null,
      scope: "bb-builtin",
      manageable: false,
    });
    renderDom(
      <SkillDetailDialogView
        skill={skill}
        files={["SKILL.md"]}
        selectedPath="SKILL.md"
        onSelectPath={() => {}}
        content="# bb CLI"
        isLoadingContent={false}
        isContentError={false}
        canEdit={false}
        canDelete={false}
        canOpenInEditor={false}
        isDeleting={false}
        onEdit={() => {}}
        onRetry={() => {}}
        onDelete={() => {}}
        onOpenInEditor={() => {}}
      />,
    );

    const builtIn = screen.getByLabelText("bb-cli is built into bb");
    expect(builtIn.textContent).toBe("Built-in");
    expect(builtIn.className).toContain("bg-surface-recessed/75");
    expect(screen.queryByRole("button", { name: "bb-cli actions" })).toBeNull();
    fireEvent.pointerMove(builtIn);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Ships with bb",
    );
  });

  it("shows plugin-provided provenance as a passive lifecycle status", async () => {
    const skill = makeSkill({
      name: "documents",
      provider: "codex",
      scope: "plugin",
      pluginId: "documents",
      manageable: false,
    });
    renderDom(
      <SkillDetailDialogView
        skill={skill}
        files={["SKILL.md"]}
        selectedPath="SKILL.md"
        onSelectPath={() => {}}
        content="# Documents"
        isLoadingContent={false}
        isContentError={false}
        canEdit={false}
        canDelete={false}
        canOpenInEditor
        isDeleting={false}
        onEdit={() => {}}
        onRetry={() => {}}
        onDelete={() => {}}
        onOpenInEditor={() => {}}
      />,
    );

    const included = screen.getByLabelText(
      "documents is included with Documents (Codex plugin)",
    );
    expect(included.textContent).toBe("Included");
    expect(
      screen.queryByRole("button", { name: /documents plugin/i }),
    ).toBeNull();
    expect(screen.queryByTestId("plugin-logo-documents")).toBeNull();
    expect(screen.queryByText("Editable", { exact: true })).toBeNull();

    fireEvent.pointerMove(included);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Included with Documents (Codex plugin)",
    );
    expect(
      screen.queryByRole("button", { name: "documents actions" }),
    ).toBeNull();
  });

  it("identifies a bb plugin-provided skill without provider provenance", async () => {
    const skill = makeSkill({
      name: "plugin-notes",
      provider: null,
      scope: "plugin",
      pluginId: "skill-catalog-fixture",
      manageable: false,
    });
    renderDom(
      <SkillDetailDialogView
        skill={skill}
        files={["SKILL.md"]}
        selectedPath="SKILL.md"
        onSelectPath={() => {}}
        content="# Plugin notes"
        isLoadingContent={false}
        isContentError={false}
        canEdit={false}
        canDelete={false}
        canOpenInEditor={false}
        isDeleting={false}
        onEdit={() => {}}
        onRetry={() => {}}
        onDelete={() => {}}
        onOpenInEditor={() => {}}
      />,
    );

    const included = screen.getByLabelText(
      "plugin-notes is included with Skill catalog fixture (bb plugin)",
    );
    expect(included.textContent).toBe("Included");
    fireEvent.pointerMove(included);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Included with Skill catalog fixture (bb plugin)",
    );
    expect(screen.queryByText("Imported", { exact: true })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "plugin-notes actions" }),
    ).toBeNull();
  });

  it("labels externally discovered provider skills as imported", async () => {
    const skill = makeSkill({
      name: "code-review",
      provider: "claude-code",
      scope: "claude-user",
      manageable: true,
    });
    renderDom(
      <SkillDetailDialogView
        skill={skill}
        files={["SKILL.md"]}
        selectedPath="SKILL.md"
        onSelectPath={() => {}}
        content="# Code review"
        isLoadingContent={false}
        isContentError={false}
        canEdit
        canDelete
        canOpenInEditor={false}
        isDeleting={false}
        onEdit={() => {}}
        onRetry={() => {}}
        onDelete={() => {}}
        onOpenInEditor={() => {}}
      />,
    );

    const imported = screen.getByLabelText(
      "code-review is imported from Claude Code",
    );
    expect(imported.textContent).toBe("Imported");
    expect(imported.className).toContain("min-w-20");
    expect(imported.className).toContain("border");
    expect(imported.querySelector('[data-icon="Download"]')).not.toBeNull();
    fireEvent.pointerMove(imported);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Discovered from Claude Code",
    );
  });

  it("uses a hoverable copy target and delegates editing to the thread flow", () => {
    const skill = makeSkill({
      name: "bb-skill",
      provider: null,
      scope: "bb-user",
      manageable: true,
      filePath: "/home/u/.bb/skills/bb-skill/SKILL.md",
    });
    const onEdit = vi.fn();
    renderDom(
      <SkillDetailDialogView
        skill={skill}
        files={["SKILL.md"]}
        selectedPath="SKILL.md"
        onSelectPath={() => {}}
        content="# bb skill"
        isLoadingContent={false}
        isContentError={false}
        canEdit
        canDelete
        canOpenInEditor={false}
        isDeleting={false}
        onEdit={onEdit}
        onRetry={() => {}}
        onDelete={() => {}}
        onOpenInEditor={() => {}}
      />,
    );

    const pathButton = screen.getByRole("button", {
      name: "Copy skill path: /home/u/.bb/skills/bb-skill",
    });
    expect(screen.queryByText("Editable", { exact: true })).toBeNull();
    expect(pathButton.className).toContain("cursor-pointer");
    expect(pathButton.className).toContain("hover:bg-state-hover");
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "bb-skill actions" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledOnce();
    expect(screen.queryByRole("textbox", { name: "Edit SKILL.md" })).toBeNull();
  });
});

describe("SkillDetailView registry states", () => {
  it("lets short Markdown previews end with their content", () => {
    renderDom(
      <SkillDetailView
        title="grill-me"
        path="skills.sh/mattpocock/skills/grill-me"
        files={["SKILL.md"]}
        selectedPath="SKILL.md"
        onSelectFile={() => {}}
        contentState={{
          kind: "ready",
          content: "# grill-me\n\nRun a `/grilling` session.",
        }}
      />,
    );

    const definition = screen
      .getByText("SKILL.md")
      .closest("[data-resource-detail-section]");
    const previewPanel = definition?.querySelector(".rounded-md.border");

    expect(previewPanel).not.toBeNull();
    expect(previewPanel?.className).not.toContain("min-h-80");
    expect(previewPanel?.className).not.toContain("overflow-auto");
  });

  it("omits social proof, links before install, and confirms uninstall", () => {
    const onInstall = vi.fn();
    const onUninstall = vi.fn();
    const view = renderDom(
      <SkillDetailView
        leading={<span>Skill</span>}
        title="find-skills"
        path="skills.sh/vercel-labs/skills/find-skills"
        pathHref="https://www.skills.sh/vercel-labs/skills/find-skills"
        headerControl={{
          kind: "install",
          skillName: "find-skills",
          installed: false,
          pending: false,
          onInstall,
          onUninstall,
        }}
        files={["SKILL.md"]}
        selectedPath="SKILL.md"
        onSelectFile={() => {}}
        contentState={{ kind: "ready", content: "# Find skills" }}
      />,
    );

    const sourceLink = screen.getByRole("link", {
      name: "Open skills.sh/vercel-labs/skills/find-skills in a new tab",
    });
    expect(sourceLink.getAttribute("href")).toBe(
      "https://www.skills.sh/vercel-labs/skills/find-skills",
    );
    expect(sourceLink.getAttribute("target")).toBe("_blank");
    expect(sourceLink.textContent).not.toContain("/SKILL.md");
    expect(screen.queryByText("Registry social proof")).toBeNull();
    expect(
      screen
        .getByRole("heading", { name: "Find skills" })
        .closest(".overflow-auto"),
    ).toBeNull();
    const installButton = screen.getByRole("button", {
      name: /Install find-skills/,
    });
    expect(installButton.className).toContain("border-input");
    fireEvent.click(installButton);
    expect(onInstall).toHaveBeenCalledOnce();

    view.rerender(
      <SkillDetailView
        leading={<span>Skill</span>}
        title="find-skills"
        path="~/.bb/skills/find-skills/SKILL.md"
        headerControl={{
          kind: "install",
          skillName: "find-skills",
          installed: true,
          pending: false,
          onInstall,
          onUninstall,
        }}
        files={["SKILL.md"]}
        selectedPath="SKILL.md"
        onSelectFile={() => {}}
        contentState={{ kind: "ready", content: "# Find skills" }}
      />,
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("Registry social proof")).toBeNull();
    const uninstallButton = screen.getByRole("button", {
      name: "Uninstall find-skills from bb",
    });
    expect(uninstallButton.className).toContain("group/install");
    expect(uninstallButton.className).toContain("border-success/30");
    expect(uninstallButton.className).toContain("bg-success/10");
    expect(uninstallButton.querySelector('[data-icon="Check"]')).not.toBeNull();
    expect(uninstallButton.innerHTML).toContain("group-hover/install:opacity");
    fireEvent.click(uninstallButton);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(onUninstall).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Uninstall skill" }));
    expect(onUninstall).toHaveBeenCalledOnce();
  });
});

describe("installRegistrySkill", () => {
  it("imports one bb-owned user skill", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => ({
        ok: true,
        json: async () => ({
          ok: true,
          filePath: "/home/u/.bb/skills/skill/SKILL.md",
        }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const skill = makeRegistrySkill({
      id: "owner/repo/skill",
      skillId: "skill",
      name: "Skill",
      url: "https://skills.sh/owner/repo/skill",
    });

    await expect(installRegistrySkill({ skill })).resolves.toEqual({
      ok: true,
      filePath: "/home/u/.bb/skills/skill/SKILL.md",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0];
    expect(request?.[0]).toBe("/api/v1/skills-registry/install");
    expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({
      registrySkillId: "owner/repo/skill",
      projectId: PERSONAL_PROJECT_ID,
    });
    expect(JSON.parse(String(request?.[1]?.body))).not.toHaveProperty(
      "providers",
    );
    expect(JSON.parse(String(request?.[1]?.body))).not.toHaveProperty("scope");
  });
});

describe("resolveInstalledRegistrySkill", () => {
  it("resolves a registry entry only to its canonical bb-user detail", () => {
    const registrySkill = makeRegistrySkill({
      skillId: "Useful Skill",
      name: "Useful skill",
    });
    const installed = makeSkill({
      name: "useful-skill",
      provider: null,
      scope: "bb-user",
      filePath: "/home/u/.bb/skills/useful-skill/SKILL.md",
    });

    expect(
      resolveInstalledRegistrySkill(registrySkill, [
        makeSkill({ name: "useful-skill", scope: "bb-builtin" }),
        installed,
      ]),
    ).toBe(installed);
    expect(
      resolveInstalledRegistrySkill(registrySkill, [
        makeSkill({ name: "useful-skill", provider: "codex" }),
      ]),
    ).toBeNull();
  });
});

describe("fetchRegistrySkills", () => {
  it("requests and validates a registry page", async () => {
    const skill = makeRegistrySkill();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        skills: [skill],
        pagination: { page: 2, perPage: 24, total: 73, hasMore: true },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRegistrySkills({ query: "useful", page: 2 });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/skills-registry?q=useful&page=2&perPage=24",
    );
    expect(result.skills).toEqual([skill]);
    expect(result.pagination).toEqual({
      page: 2,
      perPage: 24,
      total: 73,
      hasMore: true,
    });
  });
});

describe("fetchRegistrySkillEntry", () => {
  it("loads a canonical entry independently of the current browse page", async () => {
    const skill = makeRegistrySkill();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => skill,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchRegistrySkillEntry(skill.id)).resolves.toEqual(skill);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/skills-registry/entry?id=owner%2Frepo%2Fuseful-skill",
    );
  });
});
