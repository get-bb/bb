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
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { focusManager } from "@tanstack/react-query";
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
  focusManager.setFocused(undefined);
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
    scope: "provider-user",
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
  // The library names providers from the roster; stub it so the fetch spy below
  // only ever sees requests this route made for its own data.
  vi.spyOn(sdk.providers, "list").mockResolvedValue([]);
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
    <MemoryRouter initialEntries={["/extensions/skills/library/skill_missing"]}>
      <QueryClientWrapper>
        <Routes>
          <Route
            path="/extensions/skills/library/:skillId"
            element={<SkillsLibrary />}
          />
        </Routes>
      </QueryClientWrapper>
    </MemoryRouter>,
  );
  return fetchMock;
}

const NO_PROVIDER_DISPLAY_NAMES: ReadonlyMap<string, string> = new Map();

function render(props: Partial<Parameters<typeof SkillsOverview>[0]>): string {
  return renderToStaticMarkup(
    <SkillsOverview
      providerDisplayNames={
        props.providerDisplayNames ?? NO_PROVIDER_DISPLAY_NAMES
      }
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
      providerDisplayNames={NO_PROVIDER_DISPLAY_NAMES}
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
      unknownInstallSkillIds={new Set()}
      isLoading={false}
      loadingMore={false}
      hasMore={false}
      hasError={false}
      query=""
      onQueryChange={() => {}}
      onLoadMore={() => {}}
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
    /** Lets a test give the per-skill entry different data than the list. */
    entry?: RegistrySkill;
    /** Fails every per-skill entry request, as a dead detail page would. */
    entryFails?: boolean;
    ranking?: "trending" | "all-time";
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
          ranking: options.ranking ?? "trending",
        }),
        { status: 200 },
      );
    }
    if (url.startsWith("/api/v1/skills-registry/entry?")) {
      if (options.entryFails) return new Response(null, { status: 404 });
      return new Response(JSON.stringify(options.entry ?? registrySkill), {
        status: 200,
      });
    }
    if (url === "/api/v1/skills-registry/entries") {
      // The batch route omits unresolved ids instead of failing the request.
      return Response.json({
        entries: options.entryFails ? [] : [options.entry ?? registrySkill],
      });
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
      initialEntries={[
        "/extensions/skills/registry/owner%2Frepo%2Fuseful-skill",
      ]}
    >
      <QueryClientWrapper>
        <Routes>
          <Route
            path="/extensions/skills/registry/:registrySkillId"
            element={<SkillsLibrary />}
          />
        </Routes>
      </QueryClientWrapper>
    </MemoryRouter>,
  );
}

function NavigateButton({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)}>
      {label}
    </button>
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
    expect(markup).toContain('aria-label="Filters: Provider: bb"');
    expect(markup).not.toContain("Provider: 1 selected");
    expect(markup).toContain("Sort");
    // Browse and Library are top-nav destinations now; the page renders no
    // tab layer of its own.
    expect(markup).not.toContain('role="tab"');
    expect(markup).toContain("BB Official");
    expect(markup).toContain("New bb skill");
    expect(markup).not.toContain('aria-label="Open zz-official-skill"');
    expect(markup.indexOf("zz-official-skill")).toBeLessThan(
      markup.indexOf("aa-user-skill"),
    );
  });

  it("labels the Type filter and preserves independent source toggles", async () => {
    renderDom(
      <SkillsOverview
        providerDisplayNames={NO_PROVIDER_DISPLAY_NAMES}
        skills={[
          makeSkill({
            name: "official-skill",
            provider: null,
            scope: "bb-builtin",
            manageable: false,
          }),
          makeSkill({
            name: "automations",
            provider: null,
            scope: "plugin",
            pluginId: "automations",
            manageable: false,
          }),
          makeSkill({
            name: "user-skill",
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

    // Nothing selected is the default and means every type is shown.
    expect(screen.getByText("official-skill")).toBeTruthy();
    expect(screen.getByText("user-skill")).toBeTruthy();
    expect(screen.getByText("automations")).toBeTruthy();
    const typeTrigger = screen.getByRole("button", { name: /^Filters/ });
    fireEvent.focus(typeTrigger);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Provider: bb",
    );
    fireEvent.blur(typeTrigger);
    fireEvent.pointerDown(typeTrigger);
    expect(screen.getByText("Type")).toBeTruthy();
    // The explicit "All" row is gone; an empty selection carries that meaning.
    expect(screen.queryByRole("menuitemcheckbox", { name: "All" })).toBeNull();
    for (const name of ["BB Official", "Included in plugin", "User"]) {
      expect(
        screen
          .getByRole("menuitemcheckbox", { name })
          .getAttribute("aria-checked"),
      ).toBe("false");
    }
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Included in plugin" }),
    );

    expect(await screen.findByText("automations")).toBeTruthy();
    expect(
      screen.getByLabelText(
        "automations is included with Automations (bb plugin)",
      ).textContent,
    ).toBe("Included");
    expect(screen.queryByText("official-skill")).toBeNull();
    // A user-authored skill has its own bucket, so it is narrowed out here
    // rather than being silently unreachable through the filter.
    expect(screen.queryByText("user-skill")).toBeNull();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "User" }));
    expect(await screen.findByText("user-skill")).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "User" }));
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Included in plugin" }),
    );
    expect(await screen.findByText("official-skill")).toBeTruthy();
    expect(screen.getByText("automations")).toBeTruthy();
  });

  // The "user" bucket is a fallthrough — every scope that is not bb-builtin or
  // plugin lands in it. Exercising only a bb-user fixture would leave that
  // claim untested for the claude-*/codex-* scopes, which is exactly where the
  // old code returned null and let skills bypass the Type filter entirely.
  // This also covers AND-across-groups, which no other test does.
  it("puts every non-builtin, non-plugin scope in the User bucket", async () => {
    renderDom(
      <SkillsOverview
        providerDisplayNames={NO_PROVIDER_DISPLAY_NAMES}
        skills={[
          makeSkill({
            name: "claude-authored",
            provider: "claude-code",
            scope: "provider-user",
          }),
          makeSkill({
            name: "codex-authored",
            provider: "codex",
            scope: "provider-project",
          }),
          makeSkill({
            name: "official-skill",
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

    const trigger = screen.getByRole("button", { name: /^Filters/ });
    fireEvent.pointerDown(trigger);
    // Provider defaults to `bb`, which would hide both fixtures before the
    // Type filter is reached — clear it so this test observes Type alone.
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "bb" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "User" }));

    // Both provider-scoped skills reach the User bucket; the builtin does not.
    expect(await screen.findByText("claude-authored")).toBeTruthy();
    expect(screen.getByText("codex-authored")).toBeTruthy();
    expect(screen.queryByText("official-skill")).toBeNull();

    // Groups combine as AND: narrowing Provider to Claude Code drops the
    // codex-scoped skill while the User type selection still holds.
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Claude Code" }),
    );
    expect(await screen.findByText("claude-authored")).toBeTruthy();
    expect(screen.queryByText("codex-authored")).toBeNull();
    expect(screen.queryByText("official-skill")).toBeNull();

    // Clearing Type leaves the Provider selection filtering on its own.
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "User" }));
    expect(await screen.findByText("claude-authored")).toBeTruthy();
    expect(screen.queryByText("codex-authored")).toBeNull();
  });

  it("toggles BB Official independently from Included in plugin", async () => {
    renderDom(
      <SkillsOverview
        providerDisplayNames={NO_PROVIDER_DISPLAY_NAMES}
        skills={[
          makeSkill({
            name: "official-skill",
            provider: null,
            scope: "bb-builtin",
            manageable: false,
          }),
          makeSkill({
            name: "automations",
            provider: null,
            scope: "plugin",
            pluginId: "automations",
            manageable: false,
          }),
        ]}
        isLoading={false}
        hasError={false}
        onCreateSkill={() => {}}
        onSelectSkill={() => {}}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: /^Filters/ }));
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Included in plugin" }),
    );

    // One source selected narrows to that source alone.
    expect(await screen.findByText("automations")).toBeTruthy();
    expect(screen.queryByText("official-skill")).toBeNull();

    // Adding the second source widens the selection rather than replacing it.
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "BB Official" }),
    );
    expect(await screen.findByText("official-skill")).toBeTruthy();
    expect(screen.getByText("automations")).toBeTruthy();

    // Clearing both returns to the unfiltered default.
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Included in plugin" }),
    );
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "BB Official" }),
    );
    expect(await screen.findByText("official-skill")).toBeTruthy();
    expect(screen.getByText("automations")).toBeTruthy();
    // The open menu hides the trigger from the a11y tree, so close it first.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("button", { name: /^Filters/ })).toBeTruthy();
  });

  it("uses filter-neutral copy when a Type selection removes every skill", async () => {
    renderDom(
      <SkillsOverview
        providerDisplayNames={NO_PROVIDER_DISPLAY_NAMES}
        skills={[
          makeSkill({
            name: "official-skill",
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

    fireEvent.pointerDown(screen.getByRole("button", { name: /^Filters/ }));
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Included in plugin" }),
    );

    expect(
      await screen.findByText("No skills match these filters."),
    ).toBeTruthy();
    expect(screen.queryByText("No skills match these providers.")).toBeNull();
  });

  it("renders browse content as the active full-page collection mode", () => {
    const registrySkill = makeRegistrySkill({ installs: 123_456, stars: 654 });
    const markup = renderToStaticMarkup(
      <SkillsOverview
        providerDisplayNames={NO_PROVIDER_DISPLAY_NAMES}
        skills={[]}
        isLoading={false}
        hasError={false}
        activeMode="browse"
        browseContent={
          <RegistrySkillsBrowsePage
            skills={[registrySkill]}
            pendingSkillIds={new Set()}
            unknownInstallSkillIds={new Set()}
            isLoading={false}
            loadingMore={false}
            hasMore={false}
            hasError={false}
            query=""
            onQueryChange={() => {}}
            onLoadMore={() => {}}
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

  // Provider ids are an open vocabulary, so the filter rows come from the
  // listed skills rather than a hardcoded provider table: a provider with no
  // skills has no row at all instead of a permanently greyed one.
  // Provider ids are open-ended: every custom ACP agent is one, and they all
  // share a single per-tier icon label ("ACP provider"). Only the server's
  // display names can tell two of them apart in the filter and the scope label.
  it("names custom ACP agents from the provider roster", async () => {
    renderDom(
      <SkillsOverview
        providerDisplayNames={
          new Map([
            ["acp-foo", "Foo Agent"],
            ["acp-bar", "Bar Agent"],
          ])
        }
        skills={[
          makeSkill({
            name: "foo-skill",
            description: null,
            provider: "acp-foo",
            scope: "provider-user",
          }),
          makeSkill({
            name: "bar-skill",
            description: null,
            provider: "acp-bar",
            scope: "provider-user",
          }),
        ]}
        isLoading={false}
        hasError={false}
        onCreateSkill={() => {}}
        onSelectSkill={() => {}}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: /^Filters/ }));

    await waitFor(() => {
      expect(
        screen.getByRole("menuitemcheckbox", { name: "Foo Agent" }),
      ).not.toBeNull();
    });
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Bar Agent" }),
    ).not.toBeNull();
    expect(
      screen.queryByRole("menuitemcheckbox", { name: "ACP provider" }),
    ).toBeNull();
  });

  it("lists a provider filter only for providers present in the skills", async () => {
    renderDom(
      <SkillsOverview
        providerDisplayNames={NO_PROVIDER_DISPLAY_NAMES}
        skills={[
          makeSkill({
            name: "codex-skill",
            provider: "codex",
            scope: "provider-user",
          }),
        ]}
        isLoading={false}
        hasError={false}
        onCreateSkill={() => {}}
        onSelectSkill={() => {}}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: /^Filters/ }));

    await waitFor(() => {
      expect(
        screen.getByRole("menuitemcheckbox", { name: "Codex" }),
      ).not.toBeNull();
    });
    expect(
      screen.queryByRole("menuitemcheckbox", { name: "Claude Code" }),
    ).toBeNull();
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

  it("labels the Provider filter and prefixes its logo tooltip", async () => {
    renderDom(
      <SkillsOverview
        providerDisplayNames={NO_PROVIDER_DISPLAY_NAMES}
        skills={[
          makeSkill({
            name: "bb-skill",
            provider: null,
            scope: "bb-user",
          }),
          makeSkill({ name: "claude-skill", provider: "claude-code" }),
        ]}
        isLoading={false}
        hasError={false}
        onCreateSkill={() => {}}
        onSelectSkill={() => {}}
      />,
    );

    const providerTrigger = screen.getByRole("button", { name: /^Filters/ });
    fireEvent.focus(providerTrigger);
    // Merging Provider into the grouped Filters menu replaced the trigger's
    // logo tooltip with the group summary; the logos moved onto the rows.
    expect((await screen.findByRole("tooltip")).textContent?.trim()).toBe(
      "Provider: bb",
    );
    fireEvent.blur(providerTrigger);

    fireEvent.pointerDown(providerTrigger);
    expect(screen.getByText("Provider")).toBeTruthy();
    expect(
      screen.getByRole("menuitemcheckbox", { name: "bb" }).querySelector("img"),
    ).not.toBeNull();
  });

  it("keeps the default BB filter selected when only provider skills exist", async () => {
    renderDom(
      <SkillsOverview
        providerDisplayNames={NO_PROVIDER_DISPLAY_NAMES}
        skills={[
          makeSkill({
            name: "codex-skill",
            provider: "codex",
            scope: "provider-user",
          }),
        ]}
        isLoading={false}
        hasError={false}
        onCreateSkill={() => {}}
        onSelectSkill={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Filters/ })).toBeTruthy();
      expect(screen.queryByText("codex-skill")).toBeNull();
    });

    fireEvent.pointerDown(screen.getByRole("button", { name: /^Filters/ }));
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
        providerDisplayNames={NO_PROVIDER_DISPLAY_NAMES}
        skills={initialSkills}
        isLoading={false}
        hasError={false}
        onCreateSkill={() => {}}
        onSelectSkill={() => {}}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: /^Filters/ }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "bb" }));
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Claude Code" }),
    );
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.getByText("claude-skill")).toBeTruthy();
      expect(screen.queryByText("bb-skill")).toBeNull();
      expect(
        screen.getByRole("button", { name: /Provider: Claude Code/ }),
      ).toBeTruthy();
    });

    view.rerender(
      <SkillsOverview
        providerDisplayNames={NO_PROVIDER_DISPLAY_NAMES}
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

  it("waits for hover intent before warming a row's detail queries", () => {
    vi.useFakeTimers();
    try {
      const onPrefetchSkill = vi.fn();
      renderDom(
        <SkillsOverview
          providerDisplayNames={NO_PROVIDER_DISPLAY_NAMES}
          skills={[makeSkill({ provider: null, scope: "bb-user" })]}
          isLoading={false}
          hasError={false}
          onCreateSkill={() => {}}
          onSelectSkill={() => {}}
          onPrefetchSkill={onPrefetchSkill}
        />,
      );
      const row = screen.getByRole("button", { name: "code-review" });
      // A sweep across the row — in and out inside the intent delay — must not
      // fire the prefetch; that sweep is what used to cost two requests per
      // row crossed.
      fireEvent.focus(row);
      vi.advanceTimersByTime(100);
      fireEvent.blur(row);
      vi.advanceTimersByTime(1_000);
      expect(onPrefetchSkill).not.toHaveBeenCalled();

      fireEvent.focus(row);
      vi.advanceTimersByTime(150);
      expect(onPrefetchSkill).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
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

  it("opens on Browse before Library and can start a skill from the registry", async () => {
    const registrySkill = makeRegistrySkill();
    vi.spyOn(sdk.skills, "list").mockResolvedValue({ skills: [] });
    const fetchMock = stubRegistryFetch(registrySkill, { list: true });
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    renderDom(
      <MemoryRouter initialEntries={["/extensions/skills"]}>
        <QueryClientWrapper>
          <Routes>
            <Route path="/extensions/skills" element={<SkillsLibrary />} />
            <Route path="/" element={<LocationStateProbe />} />
          </Routes>
          <NavigateButton
            to="/extensions/skills?view=library"
            label="go-library"
          />
          <NavigateButton to="/extensions/skills" label="go-browse" />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    let forkButton = await screen.findByRole("button", {
      name: "Fork Useful skill into a new bb skill",
    });
    // Browse and Library are top-nav destinations; the page has no tab row.
    expect(screen.queryByRole("tab")).toBeNull();
    const registryListRequests = () =>
      fetchMock.mock.calls.filter(([input]) =>
        requestPath(input).startsWith("/api/v1/skills-registry?"),
      );
    expect(registryListRequests()).toHaveLength(1);

    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await waitFor(() => expect(registryListRequests()).toHaveLength(1));

    // A Browse → My skills → Browse round trip (the sidebar's URL-driven mode
    // switch) must serve the cached registry list, not refetch it.
    fireEvent.click(screen.getByText("go-library"));
    expect(
      await screen.findByRole("textbox", { name: "Search skills" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByText("go-browse"));
    forkButton = await screen.findByRole("button", {
      name: "Fork Useful skill into a new bb skill",
    });
    expect(registryListRequests()).toHaveLength(1);

    fireEvent.click(forkButton);

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

  it("shows the lifetime install count, not the trending window the list ranks by", async () => {
    // Browsing ranks by the trending leaderboard, whose `installs` only counts
    // the ranking window. The card has to report the registry's lifetime count.
    const trendingEntry = makeRegistrySkill({ installs: 42, summary: null });
    vi.spyOn(sdk.skills, "list").mockResolvedValue({ skills: [] });
    stubRegistryFetch(trendingEntry, {
      list: true,
      entry: makeRegistrySkill({ installs: 9_000 }),
    });
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    renderDom(
      <MemoryRouter initialEntries={["/extensions/skills?view=browse"]}>
        <QueryClientWrapper>
          <Routes>
            <Route path="/extensions/skills" element={<SkillsLibrary />} />
          </Routes>
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText("9.0K installs")).toBeTruthy();
    expect(screen.queryByLabelText("42 installs")).toBeNull();
  });

  it("shows no install count rather than the window count when the entry lookup fails", async () => {
    // The detail page 404s for skills whose source was renamed. Falling back to
    // the list value would print a 24h figure formatted exactly like its
    // neighbours' lifetime totals, understating by orders of magnitude.
    const trendingEntry = makeRegistrySkill({ installs: 42, summary: null });
    vi.spyOn(sdk.skills, "list").mockResolvedValue({ skills: [] });
    stubRegistryFetch(trendingEntry, { list: true, entryFails: true });
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    renderDom(
      <MemoryRouter initialEntries={["/extensions/skills?view=browse"]}>
        <QueryClientWrapper>
          <Routes>
            <Route path="/extensions/skills" element={<SkillsLibrary />} />
          </Routes>
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    // The card still resolves out of its skeleton — it just carries no count.
    expect(
      await screen.findByRole("button", {
        name: "View details for Useful skill",
      }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("42 installs")).toBeNull();
    expect(screen.queryByLabelText(/installs$/)).toBeNull();
  });

  it("keeps the enriched star count when the entry supplies the install total", async () => {
    // The merge deliberately takes only some entry fields; entries always carry
    // stars: null, so spreading the whole entry would erase the repo's stars.
    const listed = makeRegistrySkill({
      installs: 42,
      summary: null,
      stars: null,
    });
    vi.spyOn(sdk.skills, "list").mockResolvedValue({ skills: [] });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestPath(input);
      if (url.startsWith("/api/v1/skills-registry?")) {
        return Response.json({
          skills: [listed],
          pagination: { page: 0, perPage: 24, total: 1, hasMore: false },
          ranking: "trending",
        });
      }
      if (url === "/api/v1/skills-registry/entries") {
        return Response.json({
          entries: [makeRegistrySkill({ installs: 9_000 })],
        });
      }
      if (url.startsWith("/api/v1/skills-registry/repository-stars?")) {
        return Response.json({ stars: 654 });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    renderDom(
      <MemoryRouter initialEntries={["/extensions/skills?view=browse"]}>
        <QueryClientWrapper>
          <Routes>
            <Route path="/extensions/skills" element={<SkillsLibrary />} />
          </Routes>
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText("9.0K installs")).toBeTruthy();
    expect(await screen.findByLabelText("654 stars")).toBeTruthy();
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
            ranking: "trending",
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
      <MemoryRouter initialEntries={["/extensions/skills?view=browse"]}>
        <QueryClientWrapper>
          <Routes>
            <Route path="/extensions/skills" element={<SkillsLibrary />} />
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

  it("resolves every card's entry through one batch request", async () => {
    // 24 cards used to mean 24 per-card entry requests; the page now sends the
    // loaded set's ids as one batch and keeps skeletons up until it lands.
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
    let resolveEntries: ((response: Response) => void) | undefined;
    const entriesResponse = new Promise<Response>((resolve) => {
      resolveEntries = resolve;
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
            ranking: "trending",
          }),
        );
      }
      if (url === "/api/v1/skills-registry/entries") {
        return entriesResponse;
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    renderDom(
      <MemoryRouter initialEntries={["/extensions/skills?view=browse"]}>
        <QueryClientWrapper>
          <Routes>
            <Route path="/extensions/skills" element={<SkillsLibrary />} />
          </Routes>
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(
          ([input]) => requestPath(input) === "/api/v1/skills-registry/entries",
        ),
      ).toHaveLength(1);
    });
    // No per-card fan-out alongside the batch.
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        requestPath(input).startsWith("/api/v1/skills-registry/entry?"),
      ),
    ).toHaveLength(0);
    expect(screen.queryByText("First skill")).toBeNull();
    expect(
      screen.getByRole("status", { name: "Loading Second skill" }),
    ).toBeTruthy();

    resolveEntries?.(
      Response.json({
        entries: [
          { ...firstSkill, summary: "First description" },
          { ...secondSkill, summary: "Second description" },
        ],
      }),
    );

    expect(await screen.findByText("First skill")).toBeTruthy();
    expect(screen.getByText("First description")).toBeTruthy();
    expect(screen.getByText("Second skill")).toBeTruthy();
    expect(screen.getByText("Second description")).toBeTruthy();
  });
});

describe("RegistrySkillsBrowsePage", () => {
  it("uses the shared error state and retry action", () => {
    const onRetry = vi.fn();
    renderRegistryBrowse({
      skills: [],
      hasError: true,
      onRetry,
    });

    expect(screen.getByRole("alert").textContent).toContain(
      "Couldn't load skills.sh.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("renders the authoritative page order, exposes social proof, and loads more on scroll", () => {
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
    const { container } = renderRegistryBrowse({
      skills: [alpha, zulu],
      hasMore: true,
      onFork,
      onSelect,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "View details for Alpha" }),
    );
    expect(onSelect).toHaveBeenCalledWith(alpha);
    expect(screen.getByRole("textbox", { name: "Search skills" })).toBeTruthy();
    expect(screen.getByLabelText("10 installs")).toBeTruthy();
    expect(screen.getAllByText("by owner/repo").length).toBeGreaterThan(0);
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
    // Paging is scroll-driven now: the sentinel is present while more pages
    // exist, and there are no page buttons left to mis-click.
    expect(
      container.querySelector("[data-resource-infinite-sentinel]"),
    ).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  });

  it("keeps the list's own count on the all-time ranking", async () => {
    // Searching returns lifetime counts already, so the per-skill entry must
    // not override them — one grid should not mix scraped detail-page numbers
    // with the list's authoritative ones.
    const listed = makeRegistrySkill({ installs: 42, summary: null });
    vi.spyOn(sdk.skills, "list").mockResolvedValue({ skills: [] });
    stubRegistryFetch(listed, {
      list: true,
      ranking: "all-time",
      entry: makeRegistrySkill({ installs: 9_000 }),
    });
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    renderDom(
      <MemoryRouter initialEntries={["/extensions/skills?view=browse"]}>
        <QueryClientWrapper>
          <Routes>
            <Route path="/extensions/skills" element={<SkillsLibrary />} />
          </Routes>
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText("42 installs")).toBeTruthy();
    expect(screen.queryByLabelText("9.0K installs")).toBeNull();
  });
});

/**
 * jsdom has no IntersectionObserver, so the infinite-scroll sentinel never
 * self-arms in tests. This stub records observer callbacks and lets a test
 * fire "the sentinel became visible" directly.
 */
function stubIntersectionObserver() {
  const callbacks: IntersectionObserverCallback[] = [];
  class StubIntersectionObserver {
    constructor(callback: IntersectionObserverCallback) {
      callbacks.push(callback);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("IntersectionObserver", StubIntersectionObserver);
  return () => {
    for (const callback of [...callbacks]) {
      callback(
        [{ isIntersecting: true }] as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      );
    }
  };
}

describe("SkillsLibrary registry browse paging", () => {
  function renderBrowse() {
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    return renderDom(
      <MemoryRouter initialEntries={["/extensions/skills?view=browse"]}>
        <QueryClientWrapper>
          <Routes>
            <Route path="/extensions/skills" element={<SkillsLibrary />} />
          </Routes>
        </QueryClientWrapper>
      </MemoryRouter>,
    );
  }

  it("keeps loaded cards and offers an inline retry when a later page fails", async () => {
    const alpha = makeRegistrySkill({
      id: "owner/repo/alpha",
      skillId: "alpha",
      name: "Alpha",
    });
    vi.spyOn(sdk.skills, "list").mockResolvedValue({ skills: [] });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestPath(input);
      if (url.startsWith("/api/v1/skills-registry?")) {
        const page = new URL(url, window.location.origin).searchParams.get(
          "page",
        );
        if (page === "0") {
          return Response.json({
            skills: [alpha],
            pagination: { page: 0, perPage: 24, total: 48, hasMore: true },
            ranking: "trending",
          });
        }
        return new Response(null, { status: 503 });
      }
      if (url === "/api/v1/skills-registry/entries") {
        return Response.json({ entries: [alpha] });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const fireSentinel = stubIntersectionObserver();
    renderBrowse();

    expect(await screen.findByText("Alpha")).toBeTruthy();
    fireSentinel();

    // The failed second page must not blank the grid: the loaded cards stay,
    // and the error confines itself to an inline retry row below them.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't load more from skills.sh.");
    expect(screen.getByText("Alpha")).toBeTruthy();

    const pageTwoCalls = () =>
      fetchMock.mock.calls.filter(([input]) =>
        requestPath(input).includes("page=1"),
      ).length;
    expect(pageTwoCalls()).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(pageTwoCalls()).toBe(2));
    expect(screen.getByText("Alpha")).toBeTruthy();
  });

  it("restarts accumulation instead of mixing rankings when the server falls back", async () => {
    // Page 0 arrives from the trending ranking; the next page degrades to
    // all-time. Their `installs` count different windows, so the grid must
    // never present rows from both at once.
    const alpha = makeRegistrySkill({
      id: "owner/repo/alpha",
      skillId: "alpha",
      name: "Alpha",
    });
    const bravo = makeRegistrySkill({
      id: "owner/repo/bravo",
      skillId: "bravo",
      name: "Bravo",
    });
    vi.spyOn(sdk.skills, "list").mockResolvedValue({ skills: [] });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestPath(input);
      if (url.startsWith("/api/v1/skills-registry?")) {
        const page = new URL(url, window.location.origin).searchParams.get(
          "page",
        );
        if (page === "0") {
          return Response.json({
            skills: [alpha],
            pagination: { page: 0, perPage: 24, total: 48, hasMore: true },
            ranking: "trending",
          });
        }
        return Response.json({
          skills: [bravo],
          pagination: { page: 1, perPage: 24, total: 48, hasMore: false },
          ranking: "all-time",
        });
      }
      if (url === "/api/v1/skills-registry/entries") {
        return Response.json({ entries: [alpha, bravo] });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const fireSentinel = stubIntersectionObserver();
    renderBrowse();

    expect(await screen.findByText("Alpha")).toBeTruthy();
    fireSentinel();

    expect(await screen.findByText("Bravo")).toBeTruthy();
    expect(screen.queryByText("Alpha")).toBeNull();
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
      scope: "provider-user",
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
