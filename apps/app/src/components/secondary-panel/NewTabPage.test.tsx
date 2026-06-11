// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { WorkspacePathEntry } from "@bb/server-contract";
import * as api from "@/lib/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { NewTabPage } from "./NewTabPage";
import { CREATE_APP_PROMPT_TEMPLATE } from "./NewTabFileSearch";
import {
  getThreadRecentItemsStorageKey,
  type ThreadRecentItem,
} from "./threadRecentItems";
import type { FileSearchSelection } from "./useThreadFileTabs";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();

  return {
    ...actual,
    searchProjectPaths: vi.fn(),
    searchEnvironmentPaths: vi.fn(),
    listApps: vi.fn(),
    listThreadStoragePaths: vi.fn(),
  };
});

interface PathEntryFixture {
  kind: WorkspacePathEntry["kind"];
  path: string;
  score: number;
  positions?: number[];
}

interface PathListFixtureResponse {
  paths: WorkspacePathEntry[];
  truncated: boolean;
}

interface RenderNewTabPageArgs {
  projectId?: string;
  environmentId?: string | null;
  currentThreadId?: string;
  onSelect?: (selection: FileSearchSelection) => void;
}

function getPathName(pathValue: string): string {
  return pathValue.split("/").at(-1) ?? pathValue;
}

function makePathEntry(fixture: PathEntryFixture): WorkspacePathEntry {
  return {
    kind: fixture.kind,
    path: fixture.path,
    name: getPathName(fixture.path),
    score: fixture.score,
    positions: fixture.positions ?? [],
  };
}

function makePathResponse(
  fixtures: PathEntryFixture[],
): PathListFixtureResponse {
  return {
    paths: fixtures.map(makePathEntry),
    truncated: false,
  };
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

function seedRecentItems(threadId: string, items: ThreadRecentItem[]): void {
  window.localStorage.setItem(
    getThreadRecentItemsStorageKey({ threadId }),
    JSON.stringify(items),
  );
}

function mockEmptySearchSources(): void {
  vi.mocked(api.listApps).mockResolvedValue([]);
  vi.mocked(api.searchProjectPaths).mockResolvedValue(makePathResponse([]));
  vi.mocked(api.searchEnvironmentPaths).mockResolvedValue(makePathResponse([]));
  vi.mocked(api.listThreadStoragePaths).mockResolvedValue({
    ...makePathResponse([]),
    storageRootPath: "/tmp/thread-storage",
  });
}

function renderNewTabPage(args: RenderNewTabPageArgs = {}) {
  const { wrapper } = createQueryClientTestHarness();
  const onSelect: (selection: FileSearchSelection) => void =
    args.onSelect ?? vi.fn();
  return {
    onSelect,
    ...render(
      <NewTabPage
        projectId={args.projectId}
        environmentId={args.environmentId === undefined ? "env-1" : args.environmentId}
        currentThreadId={args.currentThreadId ?? "thr-standard"}
        focusRequest={0}
        onSelect={onSelect}
      />,
      { wrapper },
    ),
  };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("NewTabPage", () => {
  it("renders file search and selects a workspace result", async () => {
    vi.mocked(api.listApps).mockResolvedValue([]);
    vi.mocked(api.searchEnvironmentPaths).mockResolvedValue(
      makePathResponse([
        {
          kind: "file",
          path: "src/app.ts",
          score: 80,
        },
      ]),
    );
    const { onSelect } = renderNewTabPage({ projectId: "proj-1" });

    expect(
      screen.queryByRole("textbox", { name: "Search apps and files" }),
    ).toBeNull();
    expect(screen.queryByRole("option", { name: /Open file/u })).toBeNull();
    expect(screen.queryByRole("option", { name: /Open browser/u })).toBeNull();
    const input = screen.getByRole("combobox", {
      name: "Search files",
    });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "app" } });
    expect(await screen.findByText("Files")).toBeTruthy();
    expect(await screen.findByText("app.ts")).toBeTruthy();
    expect(await screen.findByText(/src/u)).toBeTruthy();
    expect(screen.queryByText("Thread storage")).toBeNull();
    fireEvent.click(await screen.findByRole("option", { name: /app\.ts/u }));

    expect(onSelect).toHaveBeenCalledWith({
      source: "workspace",
      path: "src/app.ts",
    });
  });

  it("structures the create-app prompt with no placeholders and ends ready for the user", () => {
    expect(CREATE_APP_PROMPT_TEMPLATE).not.toMatch(/\[NAME\]/u);
    expect(CREATE_APP_PROMPT_TEMPLATE).not.toMatch(
      /\[DESCRIBE WHAT IT SHOULD DO\]/u,
    );
    expect(CREATE_APP_PROMPT_TEMPLATE).toContain("bb guide app");
    expect(CREATE_APP_PROMPT_TEMPLATE).toContain("window.bb.data");
    expect(CREATE_APP_PROMPT_TEMPLATE).toContain("window.bb.message.send");
    expect(CREATE_APP_PROMPT_TEMPLATE).toContain("Vite + React + TypeScript");
    expect(CREATE_APP_PROMPT_TEMPLATE).toContain("pnpm build");
    expect(CREATE_APP_PROMPT_TEMPLATE.endsWith("What I want:\n\n")).toBe(true);
  });

  it("selects a thread-storage result with the keyboard", async () => {
    vi.mocked(api.listApps).mockResolvedValue([]);
    vi.mocked(api.searchEnvironmentPaths).mockResolvedValue(
      makePathResponse([
        {
          kind: "file",
          path: "src/workspace.ts",
          score: 90,
        },
      ]),
    );
    vi.mocked(api.listThreadStoragePaths).mockResolvedValue({
      ...makePathResponse([
        {
          kind: "file",
          path: "notes/status.md",
          score: 80,
        },
      ]),
      storageRootPath: "/tmp/thread-storage",
    });
    const { onSelect } = renderNewTabPage({
      projectId: "proj-1",
      currentThreadId: "thr-storage",
    });

    const input = screen.getByRole("combobox", {
      name: "Search files",
    });
    fireEvent.change(input, { target: { value: "status" } });
    await screen.findByText("Files");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith({
      source: "thread-storage",
      path: "notes/status.md",
    });
  });

  it("ends file-search loading in a projectless thread with no workspace", async () => {
    mockEmptySearchSources();
    renderNewTabPage({
      projectId: undefined,
      environmentId: null,
      currentThreadId: "thr-projectless-search",
    });

    fireEvent.change(screen.getByRole("combobox", { name: "Search files" }), {
      target: { value: "missing" },
    });

    await waitFor(() => {
      expect(api.listThreadStoragePaths).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.queryByText("Searching files...")).toBeNull();
    });

    // No project source and no environment ⇒ workspace is never queried.
    expect(api.searchProjectPaths).not.toHaveBeenCalled();
    expect(api.searchEnvironmentPaths).not.toHaveBeenCalled();
    expect(screen.queryByText("File search failed.")).toBeNull();
    expect(screen.getByText("No files match your search.")).toBeTruthy();
  });

  it("renders an unavailable state without querying", () => {
    renderNewTabPage({ currentThreadId: "", environmentId: null });

    expect(
      screen.getByText("No searchable file source is available."),
    ).toBeTruthy();
    expect(api.searchProjectPaths).not.toHaveBeenCalled();
    expect(api.searchEnvironmentPaths).not.toHaveBeenCalled();
    expect(api.listApps).not.toHaveBeenCalled();
    expect(api.listThreadStoragePaths).not.toHaveBeenCalled();

    // With no searchable source the combobox is disabled and advertises no
    // popup, so it never dangles aria-controls/activedescendant at an absent
    // listbox.
    const input = screen.getByRole("combobox", { name: "Search files" });
    expect(input).toHaveProperty("disabled", true);
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.getAttribute("aria-controls")).toBeNull();
    expect(input.getAttribute("aria-activedescendant")).toBeNull();
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("NewTabPage recent section", () => {
  it("lists recent items newest-first with relative timestamps", async () => {
    mockEmptySearchSources();
    const threadId = "thr-recent-render";
    const now = Date.now();
    seedRecentItems(threadId, [
      {
        source: "thread-storage",
        path: "plans/swap-model.md",
        openedAt: now - 2 * MINUTE_MS,
      },
      {
        source: "thread-storage",
        path: "README.md",
        openedAt: now - 5 * MINUTE_MS,
      },
      {
        source: "thread-storage",
        path: "plans/sidebar-mockup.html",
        openedAt: now - HOUR_MS,
      },
      {
        source: "workspace",
        path: "apps/app/src/components/secondary-panel/NewTabFileSearch.tsx",
        openedAt: now - 25 * HOUR_MS,
      },
    ]);

    renderNewTabPage({
      projectId: "proj-1",
      currentThreadId: threadId,
    });

    // Recent is a labelled option group inside the single combobox listbox.
    const recentGroup = await screen.findByRole("group", { name: "Recent" });
    const recentOptions = within(recentGroup).getAllByRole("option");
    expect(recentOptions.map((option) => option.textContent ?? "")).toEqual([
      expect.stringContaining("swap-model.md"),
      expect.stringContaining("README.md"),
      expect.stringContaining("sidebar-mockup.html"),
      expect.stringContaining("NewTabFileSearch.tsx"),
    ]);

    // Recent rows keep the icon and path context, but do not render visual-kind
    // labels or the old separator glyphs inline.
    expect(within(recentGroup).queryByText("Plan")).toBeNull();
    expect(within(recentGroup).queryByText("Doc")).toBeNull();
    expect(within(recentGroup).queryByText("Mockup")).toBeNull();
    expect(within(recentGroup).queryByText("Source")).toBeNull();
    for (const option of recentOptions) {
      expect(option.textContent ?? "").not.toContain(String.fromCharCode(183));
    }

    // Right-aligned relative timestamps.
    expect(within(recentGroup).getByText("2m ago")).toBeTruthy();
    expect(within(recentGroup).getByText("5m ago")).toBeTruthy();
    expect(within(recentGroup).getByText("1h ago")).toBeTruthy();
    expect(within(recentGroup).getByText("Yesterday")).toBeTruthy();
  });

  it("opens a recent item in the panel when its row is clicked", async () => {
    mockEmptySearchSources();
    const threadId = "thr-recent-click";
    seedRecentItems(threadId, [
      {
        source: "thread-storage",
        path: "plans/swap-model.md",
        openedAt: Date.now() - 2 * MINUTE_MS,
      },
    ]);
    const { onSelect } = renderNewTabPage({
      projectId: "proj-1",
      currentThreadId: threadId,
    });

    fireEvent.click(
      await screen.findByRole("option", { name: /swap-model\.md/u }),
    );

    expect(onSelect).toHaveBeenCalledWith({
      source: "thread-storage",
      path: "plans/swap-model.md",
    });
  });

  it("shows recent file and artifact rows in the file search screen", async () => {
    mockEmptySearchSources();
    const threadId = "thr-recent-file-search";
    seedRecentItems(threadId, [
      {
        source: "thread-storage",
        path: "plans/swap-model.md",
        openedAt: Date.now() - 2 * MINUTE_MS,
      },
      {
        source: "thread-storage",
        path: "plans/sidebar-mockup.html",
        openedAt: Date.now() - 3 * MINUTE_MS,
      },
    ]);
    renderNewTabPage({
      projectId: "proj-1",
      currentThreadId: threadId,
    });

    await screen.findByText("swap-model.md");
    expect(screen.getByText("sidebar-mockup.html")).toBeTruthy();
    expect(screen.getByText("Recent")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Back to new tab menu" }),
    ).toBeNull();
  });

  it("shows a no-results message above Recent when a search has no file matches", async () => {
    mockEmptySearchSources();
    const threadId = "thr-recent-no-search-results";
    seedRecentItems(threadId, [
      {
        source: "thread-storage",
        path: "plans/swap-model.md",
        openedAt: Date.now() - 2 * MINUTE_MS,
      },
    ]);
    renderNewTabPage({
      projectId: "proj-1",
      currentThreadId: threadId,
    });

    fireEvent.change(screen.getByRole("combobox", { name: "Search files" }), {
      target: { value: "does-not-exist" },
    });

    const noResults = await screen.findByText("No files match your search.");
    const recent = screen.getByRole("group", { name: "Recent" });
    expect(
      Boolean(
        noResults.compareDocumentPosition(recent) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(
      within(recent).getByRole("option", { name: /swap-model\.md/u }),
    ).toBeTruthy();
  });

  it("reaches a recent row via keyboard navigation", async () => {
    mockEmptySearchSources();
    const threadId = "thr-recent-keys";
    seedRecentItems(threadId, [
      {
        source: "thread-storage",
        path: "plans/swap-model.md",
        openedAt: Date.now() - 2 * MINUTE_MS,
      },
    ]);
    renderNewTabPage({
      projectId: "proj-1",
      currentThreadId: threadId,
    });

    const input = screen.getByRole("combobox", { name: "Search files" });
    const recentOption = await screen.findByRole("option", {
      name: /swap-model\.md/u,
    });
    expect(input.getAttribute("aria-activedescendant")).toBe(recentOption.id);

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.getAttribute("aria-activedescendant")).toBe(recentOption.id);
    expect(recentOption.getAttribute("aria-selected")).toBe("true");
  });

  it("frames the empty recent state in a dashed placeholder card", async () => {
    mockEmptySearchSources();
    renderNewTabPage({
      projectId: "proj-1",
      currentThreadId: "thr-recent-empty",
    });

    const hint = await screen.findByText(
      "Plans, mockups, and files you open will show up here.",
    );
    expect(hint.className).toContain("border-dashed");
    // The deprecated raised fill stays gone so the card never clashes on white.
    expect(hint.className).not.toContain("bg-surface-raised");
  });
});
