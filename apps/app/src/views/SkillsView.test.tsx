// @vitest-environment jsdom

import type { ComponentProps } from "react";
import {
  cleanup,
  fireEvent,
  render as renderDom,
  screen,
  waitFor,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { SkillSummary } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { sdk } from "@/lib/sdk";
import { buildRegistrySkillReferencePrompt } from "@/lib/skills-registry";
import { SkillDetailView } from "../components/tools/SkillDetailView";
import { RegistrySkillDetailView } from "../components/tools/SkillsBrowse";
import {
  RegistrySkillsBrowsePage,
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
    registrySkillId: null,
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

function requestPath(input: RequestInfo | URL): string {
  const url = new URL(String(input), window.location.origin);
  return `${url.pathname}${url.search}`;
}

function LocationStateProbe() {
  const location = useLocation();
  return (
    <output data-testid="location-state">
      {JSON.stringify(location.state)}
    </output>
  );
}

function renderInstalledSkillRoute() {
  const fetchMock = vi.fn(
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
  );
  vi.stubGlobal("fetch", fetchMock);
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
  return fetchMock;
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

function renderSkillDetailDialog(
  skill: SkillSummary,
  overrides: Partial<ComponentProps<typeof SkillDetailDialogView>> = {},
) {
  return renderDom(
    <SkillDetailDialogView
      skill={skill}
      files={["SKILL.md"]}
      selectedPath="SKILL.md"
      onSelectPath={() => {}}
      content={`# ${skill.name}`}
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
      {...overrides}
    />,
  );
}

function renderRegistryBrowse(
  overrides: Partial<ComponentProps<typeof RegistrySkillsBrowsePage>> = {},
) {
  return renderDom(
    <RegistrySkillsBrowsePage
      skills={[makeRegistrySkill()]}
      pagination={{ page: 0, perPage: 24, total: 1, hasMore: false }}
      isLoading={false}
      hasError={false}
      query=""
      pendingSkillId={null}
      onQueryChange={() => {}}
      onPageChange={() => {}}
      onInstall={() => {}}
      onUninstall={() => {}}
      onCreateFromReference={() => {}}
      onSelect={() => {}}
      isInstalled={() => false}
      {...overrides}
    />,
  );
}

function stubRegistryFetch(
  registrySkill: RegistrySkill,
  options: {
    detail?: boolean;
    installedSkill?: SkillSummary;
    list?: boolean;
  } = {},
) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestPath(input);
      if (url.startsWith("/api/v1/skills-registry?")) {
        return new Response(
          JSON.stringify({
            skills: options.list ? [registrySkill] : [],
            pagination: {
              page: 0,
              perPage: 24,
              total: options.list ? 1 : 0,
              hasMore: false,
            },
          }),
          { status: 200 },
        );
      }
      if (url.startsWith("/api/v1/skills-registry/entry?")) {
        return new Response(JSON.stringify(registrySkill), { status: 200 });
      }
      if (
        url.startsWith("/api/v1/skills-registry/detail?") &&
        options.detail !== false
      ) {
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
        init?.method === "POST" &&
        options.installedSkill
      ) {
        return new Response(
          JSON.stringify({
            ok: true,
            filePath: options.installedSkill.filePath,
            skill: options.installedSkill,
          }),
          { status: 200 },
        );
      }
      return new Response(null, { status: 404 });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderRegistrySkillRoute() {
  const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
  return renderDom(
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
}

describe("SkillsOverview", () => {
  it("renders flat rows with provider filter and sort controls", () => {
    const markup = render({
      skills: [
        makeSkill({ name: "claude-skill", provider: "claude-code" }),
        makeSkill({
          name: "bb-skill",
          provider: null,
          scope: "bb-builtin",
          manageable: false,
        }),
      ],
    });
    expect(markup).toContain("claude-skill");
    expect(markup).toContain("Review the current diff.");
    expect(markup).toContain('aria-label="Agent"');
    expect(markup).toContain("Sort");
    expect(markup).toContain('role="tab"');
    expect(markup).toContain("Installed");
    expect(markup).toContain("Browse");
    expect(markup).toContain("Built-in");
    expect(markup).toContain("New bb skill");
    expect(markup).not.toContain('aria-label="Open bb-skill"');
    expect(markup.indexOf("Installed")).toBeLessThan(
      markup.indexOf('placeholder="Search skills"'),
    );
    expect(markup.indexOf("bb-skill")).toBeLessThan(
      markup.indexOf("claude-skill"),
    );
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
            onCreateFromReference={() => {}}
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
  });

  it("confirms before removing a saved skill from a Browse card", () => {
    const registrySkill = makeRegistrySkill();
    const onUninstall = vi.fn();
    renderRegistryBrowse({
      skills: [registrySkill],
      onUninstall,
      isInstalled: () => true,
      canUninstall: () => true,
    });

    fireEvent.pointerDown(
      screen.getByRole("button", {
        name: "More actions for Useful skill",
      }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Remove saved skill" }),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      screen.getByText('Remove "Useful skill" from your bb skills?'),
    ).toBeTruthy();
    expect(onUninstall).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remove skill" }));
    expect(onUninstall).toHaveBeenCalledOnce();
    expect(onUninstall).toHaveBeenCalledWith(registrySkill);
  });

  it("keeps name-only saved matches passive without proven provenance", () => {
    const registrySkill = makeRegistrySkill();
    renderRegistryBrowse({
      skills: [registrySkill],
      isInstalled: () => true,
      canUninstall: () => false,
    });

    fireEvent.pointerDown(
      screen.getByRole("button", {
        name: "More actions for Useful skill",
      }),
    );
    expect(
      screen
        .getByRole("menuitem", { name: "Saved" })
        .hasAttribute("data-disabled"),
    ).toBe(true);
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

  it("shows a loading skeleton", () => {
    const markup = render({ skills: [], isLoading: true });
    expect(markup).toContain('role="status"');
    expect(markup).toContain("Loading skills");
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

    const fetchMock = renderInstalledSkillRoute();

    expect(await screen.findByText("Skill not found.")).toBeTruthy();
    expect(screen.queryByText("New bb skill")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("SkillsLibrary registry detail lifecycle", () => {
  it("keeps removal available for a saved registry skill after reload", async () => {
    const registrySkill = makeRegistrySkill();
    const installedSkill = makeSkill({
      name: registrySkill.skillId,
      provider: null,
      scope: "bb-user",
      filePath: "/home/u/.bb/skills/useful-skill/SKILL.md",
      registrySkillId: registrySkill.id,
    });
    vi.spyOn(sdk.skills, "list").mockResolvedValue({
      skills: [installedSkill],
    });
    const removeSkill = vi
      .spyOn(sdk.skills, "remove")
      .mockResolvedValue({ deletedPath: "/home/u/.bb/skills/useful-skill" });
    stubRegistryFetch(registrySkill);
    renderRegistrySkillRoute();

    fireEvent.pointerDown(
      await screen.findByRole("button", {
        name: "More actions for Useful skill",
      }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Remove saved skill" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove skill" }));
    await waitFor(() => {
      expect(removeSkill).toHaveBeenCalledWith({
        projectId: PERSONAL_PROJECT_ID,
        skillId: installedSkill.id,
        environmentId: null,
      });
    });
  });

  it("updates a saved detail in place and keeps removal available", async () => {
    const registrySkill = makeRegistrySkill();
    const installedSkill = makeSkill({
      name: registrySkill.skillId,
      provider: null,
      scope: "bb-user",
      filePath: "/home/u/.bb/skills/useful-skill/SKILL.md",
      registrySkillId: registrySkill.id,
    });
    vi.spyOn(sdk.skills, "list")
      .mockResolvedValueOnce({ skills: [] })
      .mockResolvedValue({ skills: [installedSkill] });
    stubRegistryFetch(registrySkill, { installedSkill });
    renderRegistrySkillRoute();

    fireEvent.pointerDown(
      await screen.findByRole("button", {
        name: "More actions for Useful skill",
      }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Save" }));

    const actions = await screen.findByRole("button", {
      name: "More actions for Useful skill",
    });
    fireEvent.pointerDown(actions);
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Remove saved skill" }),
    );
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("does not offer installation when a direct registry source is unavailable", async () => {
    const registrySkill = makeRegistrySkill();
    vi.spyOn(sdk.skills, "list").mockResolvedValue({ skills: [] });
    stubRegistryFetch(registrySkill, { detail: false });
    renderRegistrySkillRoute();

    expect(
      await screen.findByText(
        "This registry skill is no longer available from its source.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /More actions for Useful skill/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: /Create a new skill from Useful skill as a reference/,
      }),
    ).toBeNull();
  });

  it("opens the composer from a registry card with the reference prompt", async () => {
    const registrySkill = makeRegistrySkill();
    vi.spyOn(sdk.skills, "list").mockResolvedValue({ skills: [] });
    const fetchMock = stubRegistryFetch(registrySkill, { list: true });
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    renderDom(
      <MemoryRouter initialEntries={["/tools/skills?view=browse"]}>
        <QueryClientWrapper>
          <Routes>
            <Route path="/tools/skills" element={<SkillsLibrary />} />
            <Route path="/" element={<LocationStateProbe />} />
          </Routes>
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Create a new skill from Useful skill as a reference",
      }),
    );

    const state = JSON.parse(
      (await screen.findByTestId("location-state")).textContent ?? "null",
    );
    expect(state).toEqual({
      focusPrompt: true,
      initialPrompt: buildRegistrySkillReferencePrompt(registrySkill),
      replaceInitialPrompt: true,
      createDraftKind: "skill",
    });
    expect(
      fetchMock.mock.calls.some(
        ([input]) => requestPath(input) === "/api/v1/skills-registry/install",
      ),
    ).toBe(false);
  });
});

describe("RegistrySkillsBrowsePage", () => {
  it("uses the shared error state and retry action", () => {
    const onRetry = vi.fn();
    renderRegistryBrowse({
      skills: [],
      pagination: { page: 0, perPage: 24, total: 0, hasMore: false },
      hasError: true,
      onRetry,
    });

    expect(screen.getByRole("alert").textContent).toContain(
      "Couldn't load skills.sh.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

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
    const onInstall = vi.fn();
    const onCreateFromReference = vi.fn();
    renderRegistryBrowse({
      skills: [alpha, zulu],
      pagination: { page: 0, perPage: 24, total: 48, hasMore: true },
      onPageChange,
      onCreateFromReference,
      onInstall,
      onSelect,
      isInstalled: (skill) => skill.id === alpha.id,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "View details for Alpha" }),
    );
    expect(onSelect).toHaveBeenCalledWith(alpha);
    expect(screen.getByText("1–2 of 48")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Search skills" })).toBeTruthy();
    expect(screen.getByLabelText("10 installs")).toBeTruthy();
    expect(screen.getByLabelText("100 stars")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "More actions for Alpha" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Create a new skill from Alpha as a reference",
      }),
    ).toBeTruthy();
    const zuluCreate = screen.getByRole("button", {
      name: "Create a new skill from Zulu as a reference",
    });
    fireEvent.click(zuluCreate);
    expect(onCreateFromReference).toHaveBeenCalledWith(zulu);
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "More actions for Zulu" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Save" }));
    expect(onInstall).toHaveBeenCalledWith(zulu);

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

describe("RegistrySkillDetailView reference creation", () => {
  it("keeps creation available before and after installing without installing itself", () => {
    const registrySkill = makeRegistrySkill();
    const onCreateFromReference = vi.fn();
    const onInstall = vi.fn();
    const props = {
      skill: registrySkill,
      detail: {
        id: registrySkill.id,
        source: registrySkill.source,
        skillId: registrySkill.skillId,
        hash: null,
        files: [{ path: "SKILL.md", contents: "# Useful skill" }],
      },
      installed: false,
      installedSkill: null,
      installedPath: null,
      pending: false,
      uninstallPending: false,
      onRetry: () => {},
      onInstall,
      onUninstall: undefined,
      onCreateFromReference,
      onEditInstalledSkill: () => {},
    };
    const view = renderDom(<RegistrySkillDetailView {...props} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Create a new skill from Useful skill as a reference",
      }),
    );
    expect(onCreateFromReference).toHaveBeenCalledWith(registrySkill);
    expect(onInstall).not.toHaveBeenCalled();

    view.rerender(
      <RegistrySkillDetailView
        {...props}
        installed
        installedSkill={makeSkill({
          name: registrySkill.skillId,
          provider: null,
          scope: "bb-user",
          registrySkillId: registrySkill.id,
        })}
        installedPath="/home/u/.bb/skills/useful-skill/SKILL.md"
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Create a new skill from Useful skill as a reference",
      }),
    );
    expect(onCreateFromReference).toHaveBeenCalledTimes(2);
    expect(onInstall).not.toHaveBeenCalled();
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
    renderSkillDetailDialog(skill);

    const builtIn = screen.getByLabelText("bb-cli is built into bb");
    expect(builtIn.textContent).toBe("Built-in");
    expect(screen.queryByRole("button", { name: "bb-cli actions" })).toBeNull();
    fireEvent.pointerMove(builtIn);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Ships with bb",
    );
  });

  it.each([
    {
      skill: makeSkill({
        name: "documents",
        provider: "codex",
        scope: "plugin",
        pluginId: "documents",
        manageable: false,
      }),
      accessibleLabel: "documents is included with Documents (Codex plugin)",
      tooltip: "Included with Documents (Codex plugin)",
    },
    {
      skill: makeSkill({
        name: "plugin-notes",
        provider: null,
        scope: "plugin",
        pluginId: "skill-catalog-fixture",
        manageable: false,
      }),
      accessibleLabel:
        "plugin-notes is included with Skill catalog fixture (bb plugin)",
      tooltip: "Included with Skill catalog fixture (bb plugin)",
    },
  ])("presents $skill.name as plugin-provided", async (example) => {
    renderSkillDetailDialog(example.skill);

    const included = screen.getByLabelText(example.accessibleLabel);
    expect(included.textContent).toBe("Included");
    expect(
      screen.queryByRole("button", { name: `${example.skill.name} actions` }),
    ).toBeNull();
    fireEvent.pointerMove(included);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      example.tooltip,
    );
  });

  it("labels externally discovered provider skills as imported", async () => {
    const skill = makeSkill({
      name: "code-review",
      provider: "claude-code",
      scope: "claude-user",
      manageable: true,
    });
    renderSkillDetailDialog(skill, { canEdit: true, canDelete: true });

    const imported = screen.getByLabelText(
      "code-review is imported from Claude Code",
    );
    expect(imported.textContent).toBe("Imported");
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
    renderSkillDetailDialog(skill, {
      canEdit: true,
      canDelete: true,
      onEdit,
    });

    screen.getByRole("button", {
      name: "Copy skill path: /home/u/.bb/skills/bb-skill",
    });
    expect(screen.queryByText("Editable", { exact: true })).toBeNull();
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "bb-skill actions" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledOnce();
    expect(screen.queryByRole("textbox", { name: "Edit SKILL.md" })).toBeNull();
  });
});

describe("SkillDetailView registry states", () => {
  it("omits social proof, links before saving, and confirms removal", () => {
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
    const saveButton = screen.getByRole("button", {
      name: /Save find-skills/,
    });
    fireEvent.click(saveButton);
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
    const removeButton = screen.getByRole("button", {
      name: "Remove saved find-skills from bb",
    });
    fireEvent.click(removeButton);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(onUninstall).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remove skill" }));
    expect(onUninstall).toHaveBeenCalledOnce();
  });
});
