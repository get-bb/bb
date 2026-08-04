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

function renderLibrarySkillRoute() {
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
    <MemoryRouter initialEntries={["/tools/skills/library/skill_missing"]}>
      <QueryClientWrapper>
        <Routes>
          <Route
            path="/tools/skills/library/:skillId"
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
      pendingSkillIds={new Set()}
      pagination={{ page: 0, perPage: 24, total: 1, hasMore: false }}
      isLoading={false}
      hasError={false}
      query=""
      onQueryChange={() => {}}
      onPageChange={() => {}}
      onFork={() => {}}
      onSelect={() => {}}
      {...overrides}
    />,
  );
}

function stubRegistryFetch(
  registrySkill: RegistrySkill,
  options: {
    detail?: boolean;
    list?: boolean;
  } = {},
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
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
    return new Response(null, { status: 404 });
  });
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
  it("defaults to BB skills and places BB Official skills first", () => {
    const markup = render({
      skills: [
        makeSkill({ name: "claude-skill", provider: "claude-code" }),
        makeSkill({
          name: "aa-user-skill",
          provider: null,
          scope: "bb-user",
        }),
        makeSkill({
          name: "zz-official-skill",
          provider: null,
          scope: "bb-builtin",
          manageable: false,
        }),
      ],
    });
    expect(markup).not.toContain("claude-skill");
    expect(markup).toContain("Review the current diff.");
    expect(markup).toContain('aria-label="Provider: 1 selected"');
    expect(markup).toContain("Sort");
    expect(markup).toContain('role="tab"');
    expect(markup).toContain("Library");
    expect(markup).toContain("Browse");
    expect(markup).toContain("BB Official");
    expect(markup).toContain("New bb skill");
    expect(markup).not.toContain('aria-label="Open zz-official-skill"');
    expect(markup.indexOf("Library")).toBeLessThan(
      markup.indexOf('placeholder="Search skills"'),
    );
    expect(markup.indexOf("zz-official-skill")).toBeLessThan(
      markup.indexOf("aa-user-skill"),
    );
  });

  it("labels skills bundled with plugins", () => {
    const markup = render({
      skills: [
        makeSkill({
          name: "automations",
          provider: null,
          scope: "plugin",
          pluginId: "automations",
          manageable: false,
        }),
      ],
    });

    expect(markup).toContain(">Included<");
    expect(markup).toContain(
      'aria-label="automations is included with Automations (bb plugin)"',
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
            pendingSkillIds={new Set()}
            pagination={{ page: 0, perPage: 24, total: 1, hasMore: false }}
            isLoading={false}
            hasError={false}
            query=""
            onQueryChange={() => {}}
            onPageChange={() => {}}
            onFork={() => {}}
            onSelect={() => {}}
          />
        }
        onCreateSkill={() => {}}
        onSelectSkill={() => {}}
      />,
    );

    expect(markup).toContain("Useful skill");
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

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Provider: 1 selected" }),
    );

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
    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "Codex" })
        .querySelector("svg"),
    ).not.toBeNull();
    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "bb" })
        .getAttribute("aria-disabled"),
    ).toBeNull();
  });

  it("keeps the default BB filter selected when only provider skills exist", async () => {
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

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Provider: 1 selected" }),
      ).toBeTruthy();
      expect(screen.queryByText("codex-skill")).toBeNull();
    });

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Provider: 1 selected" }),
    );
    const bbFilter = screen.getByRole("menuitemcheckbox", { name: "bb" });
    expect(bbFilter.getAttribute("aria-checked")).toBe("true");
    expect(bbFilter.getAttribute("aria-disabled")).toBeNull();

    fireEvent.click(bbFilter);

    expect(await screen.findByText("codex-skill")).toBeTruthy();
  });

  it("preserves a user-selected provider filter across library refreshes", async () => {
    const initialSkills = [
      makeSkill({
        id: `skill_${"b".repeat(64)}`,
        name: "bb-skill",
        provider: null,
        scope: "bb-user",
      }),
      makeSkill({ name: "claude-skill", provider: "claude-code" }),
    ];
    const view = renderDom(
      <SkillsOverview
        skills={initialSkills}
        isLoading={false}
        hasError={false}
        onCreateSkill={() => {}}
        onSelectSkill={() => {}}
      />,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Provider: 1 selected" }),
    );
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "bb" }));
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Claude Code" }),
    );

    await waitFor(() => {
      expect(screen.getByText("claude-skill")).toBeTruthy();
      expect(screen.queryByText("bb-skill")).toBeNull();
    });

    view.rerender(
      <SkillsOverview
        skills={[
          ...initialSkills,
          makeSkill({
            id: `skill_${"c".repeat(64)}`,
            name: "new-bb-skill",
            provider: null,
            scope: "bb-user",
          }),
        ]}
        isLoading={false}
        hasError={false}
        onCreateSkill={() => {}}
        onSelectSkill={() => {}}
      />,
    );

    expect(screen.getByText("claude-skill")).toBeTruthy();
    expect(screen.queryByText("new-bb-skill")).toBeNull();
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

describe("SkillsLibrary library detail routing", () => {
  it("keeps a detail loading state while the skill library resolves", () => {
    vi.spyOn(sdk.skills, "list").mockImplementation(
      () => new Promise(() => {}),
    );

    renderLibrarySkillRoute();

    expect(screen.getByText("Loading skill")).toBeTruthy();
    expect(screen.queryByText("New bb skill")).toBeNull();
  });

  it("shows a retryable detail error when the skill library fails to load", async () => {
    vi.spyOn(sdk.skills, "list").mockRejectedValue(
      new Error("skills unavailable"),
    );

    renderLibrarySkillRoute();

    expect(await screen.findByText("Couldn't load skill.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByText("New bb skill")).toBeNull();
  });

  it("shows not found on an unknown library skill detail route", async () => {
    vi.spyOn(sdk.skills, "list").mockResolvedValue({ skills: [] });

    const fetchMock = renderLibrarySkillRoute();

    const notFound = await screen.findByText("Skill not found.");
    // Skill detail-route states use the same detail-width treatment as the
    // plugin and automation routes rather than a list-shaped empty state.
    expect(notFound.closest("[data-resource-detail-state]")).not.toBeNull();
    expect(screen.queryByText("New bb skill")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("SkillsLibrary registry detail lifecycle", () => {
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
      screen.queryByRole("button", { name: /Fork Useful skill/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: /Fork Useful skill/,
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
        name: "Fork Useful skill into a new bb skill",
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

  it("reveals registry cards only after repository stars finish loading", async () => {
    const firstSkill = makeRegistrySkill({
      id: "owner/shared-repo/first-skill",
      source: "owner/shared-repo",
      skillId: "first-skill",
      name: "First skill",
      stars: null,
    });
    const secondSkill = makeRegistrySkill({
      id: "owner/shared-repo/second-skill",
      source: "owner/shared-repo",
      skillId: "second-skill",
      name: "Second skill",
      stars: null,
    });
    let resolveStars: ((response: Response) => void) | undefined;
    const starsResponse = new Promise<Response>((resolve) => {
      resolveStars = resolve;
    });
    vi.spyOn(sdk.skills, "list").mockResolvedValue({ skills: [] });
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = requestPath(input);
      if (url.startsWith("/api/v1/skills-registry?")) {
        return Promise.resolve(
          Response.json({
            skills: [firstSkill, secondSkill],
            pagination: {
              page: 0,
              perPage: 24,
              total: 2,
              hasMore: false,
            },
          }),
        );
      }
      if (
        url ===
        "/api/v1/skills-registry/repository-stars?source=owner%2Fshared-repo"
      ) {
        return starsResponse;
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    renderDom(
      <MemoryRouter initialEntries={["/tools/skills?view=browse"]}>
        <QueryClientWrapper>
          <Routes>
            <Route path="/tools/skills" element={<SkillsLibrary />} />
          </Routes>
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(
          ([input]) =>
            requestPath(input) ===
            "/api/v1/skills-registry/repository-stars?source=owner%2Fshared-repo",
        ),
      ).toHaveLength(1);
    });
    expect(screen.queryByText("First skill")).toBeNull();
    expect(screen.queryByText("Second skill")).toBeNull();
    expect(
      screen.getByRole("status", { name: "Loading First skill" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("status", { name: "Loading Second skill" }),
    ).toBeTruthy();

    resolveStars?.(Response.json({ stars: 27_053 }));

    expect(await screen.findByText("First skill")).toBeTruthy();
    expect(screen.getByText("Second skill")).toBeTruthy();
    expect(await screen.findAllByLabelText("27.1K stars")).toHaveLength(2);
  });

  it("reveals each registry card as soon as that card is complete", async () => {
    const firstSkill = makeRegistrySkill({
      id: "owner/repo/first-skill",
      skillId: "first-skill",
      name: "First skill",
      summary: null,
    });
    const secondSkill = makeRegistrySkill({
      id: "owner/repo/second-skill",
      skillId: "second-skill",
      name: "Second skill",
      summary: null,
    });
    const entryResolvers = new Map<string, (response: Response) => void>();
    const entryResponses = new Map(
      [firstSkill, secondSkill].map((skill) => [
        skill.id,
        new Promise<Response>((resolve) => {
          entryResolvers.set(skill.id, resolve);
        }),
      ]),
    );
    vi.spyOn(sdk.skills, "list").mockResolvedValue({ skills: [] });
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = requestPath(input);
      if (url.startsWith("/api/v1/skills-registry?")) {
        return Promise.resolve(
          Response.json({
            skills: [firstSkill, secondSkill],
            pagination: {
              page: 0,
              perPage: 24,
              total: 2,
              hasMore: false,
            },
          }),
        );
      }
      const entryId = new URL(url, "http://localhost").searchParams.get("id");
      if (url.startsWith("/api/v1/skills-registry/entry?") && entryId) {
        return (
          entryResponses.get(entryId) ??
          Promise.resolve(new Response(null, { status: 404 }))
        );
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    renderDom(
      <MemoryRouter initialEntries={["/tools/skills?view=browse"]}>
        <QueryClientWrapper>
          <Routes>
            <Route path="/tools/skills" element={<SkillsLibrary />} />
          </Routes>
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(([input]) =>
          requestPath(input).startsWith("/api/v1/skills-registry/entry?"),
        ),
      ).toHaveLength(2);
    });
    expect(screen.queryByText("First skill")).toBeNull();
    expect(screen.queryByText("Second skill")).toBeNull();

    entryResolvers.get(firstSkill.id)?.(
      Response.json({
        ...firstSkill,
        summary: "First description",
      }),
    );

    expect(await screen.findByText("First skill")).toBeTruthy();
    expect(screen.getByText("First description")).toBeTruthy();
    expect(screen.queryByText("Second skill")).toBeNull();
    expect(
      screen.getByRole("status", { name: "Loading Second skill" }),
    ).toBeTruthy();

    entryResolvers.get(secondSkill.id)?.(
      Response.json({
        ...secondSkill,
        summary: "Second description",
      }),
    );

    expect(await screen.findByText("Second skill")).toBeTruthy();
    expect(screen.getByText("Second description")).toBeTruthy();
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

  it("renders the authoritative page order, exposes social proof, and pages forward", () => {
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
    const onFork = vi.fn();
    renderRegistryBrowse({
      skills: [alpha, zulu],
      pagination: { page: 0, perPage: 24, total: 48, hasMore: true },
      onPageChange,
      onFork,
      onSelect,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "View details for Alpha" }),
    );
    expect(onSelect).toHaveBeenCalledWith(alpha);
    expect(screen.getByText("1–2 of 48")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Search skills" })).toBeTruthy();
    expect(screen.getByLabelText("10 installs")).toBeTruthy();
    expect(screen.getByLabelText("100 stars")).toBeTruthy();
    for (const byline of screen.getAllByText("by owner/repo")) {
      expect(byline.className).toContain("text-xs");
    }
    expect(
      screen.getByRole("button", {
        name: "Fork Alpha into a new bb skill",
      }).textContent,
    ).toBe("");
    const zuluCreate = screen.getByRole("button", {
      name: "Fork Zulu into a new bb skill",
    });
    fireEvent.click(zuluCreate);
    expect(onFork).toHaveBeenCalledWith(zulu);
    expect(screen.queryByRole("button", { name: /Save .* to bb/ })).toBeNull();

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
  it("keeps forking available whether or not a local copy exists", () => {
    const registrySkill = makeRegistrySkill();
    const onFork = vi.fn();
    const props = {
      skill: registrySkill,
      detail: {
        id: registrySkill.id,
        source: registrySkill.source,
        skillId: registrySkill.skillId,
        hash: null,
        files: [{ path: "SKILL.md", contents: "# Useful skill" }],
      },
      localSkill: null,
      localPath: null,
      onRetry: () => {},
      onFork,
      onEditLocalSkill: () => {},
    };
    const view = renderDom(<RegistrySkillDetailView {...props} />);

    const forkButton = screen.getByRole("button", {
      name: "Fork Useful skill into a new bb skill",
    });
    expect(forkButton.textContent).toContain("Fork");
    fireEvent.click(forkButton);
    expect(onFork).toHaveBeenCalledWith(registrySkill);
    expect(screen.queryByRole("button", { name: /Save .* to bb/ })).toBeNull();

    view.rerender(
      <RegistrySkillDetailView
        {...props}
        localSkill={makeSkill({
          name: registrySkill.skillId,
          provider: null,
          scope: "bb-user",
          registrySkillId: registrySkill.id,
        })}
        localPath="/home/u/.bb/skills/useful-skill/SKILL.md"
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Fork Useful skill into a new bb skill",
      }),
    );
    expect(onFork).toHaveBeenCalledTimes(2);
  });
});

describe("SkillDetailDialogView", () => {
  it("presents a built-in skill as BB Official without an actions menu", async () => {
    const skill = makeSkill({
      name: "bb-cli",
      provider: null,
      scope: "bb-builtin",
      manageable: false,
    });
    renderSkillDetailDialog(skill);

    const official = screen.getByLabelText("bb-cli is BB Official");
    expect(official.textContent).toBe("BB Official");
    expect(screen.queryByRole("button", { name: "bb-cli actions" })).toBeNull();
    fireEvent.pointerMove(official);
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
      tooltipName: "Documents plugin.",
      providerIcon: "codex",
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
      tooltipName: "Skill catalog fixture plugin.",
      providerIcon: "bb",
    },
  ])("presents $skill.name as plugin-provided", async (example) => {
    renderSkillDetailDialog(example.skill);

    const included = screen.getByLabelText(example.accessibleLabel);
    expect(included.textContent).toBe("Included");
    expect(
      screen.queryByRole("button", { name: `${example.skill.name} actions` }),
    ).toBeNull();
    fireEvent.pointerMove(included);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toContain("Included with");
    expect(tooltip.textContent).toContain(example.tooltipName);
    expect(
      tooltip.querySelector(`[data-provider-icon="${example.providerIcon}"]`),
    ).not.toBeNull();
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
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toContain("Discovered from");
    expect(tooltip.textContent).toContain("Claude Code");
    expect(
      tooltip.querySelector('[data-provider-icon="claude-code"]'),
    ).not.toBeNull();
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
    expect(screen.getByText("~/.bb/skills/bb-skill")).toBeTruthy();
    expect(screen.queryByText("BB Official", { exact: true })).toBeNull();
    expect(screen.queryByText("Included", { exact: true })).toBeNull();
    expect(screen.queryByText("Imported", { exact: true })).toBeNull();
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
  it("links to the source and omits social proof", () => {
    // Fork is the sole registry acquisition action and lives on
    // RegistrySkillDetailView, so this page renders no acquisition control at
    // all — only the external source link and the skill body.
    renderDom(
      <SkillDetailView
        leading={<span>Skill</span>}
        title="find-skills"
        path="skills.sh/vercel-labs/skills/find-skills"
        pathHref="https://www.skills.sh/vercel-labs/skills/find-skills"
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
    expect(screen.queryByRole("button", { name: /Save/ })).toBeNull();
  });
});
