// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { AppSummary, WorkspacePathEntry } from "@bb/server-contract";
import * as api from "@/lib/api";
import {
  parsePromptDraftStorage,
  serializePromptDraftStorage,
  type PromptDraftState,
} from "@/lib/prompt-draft";
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
  currentThreadId?: string;
  currentThreadType?: "manager" | "standard";
  onCreateAppPromptPrefill?: CreateAppPromptPrefillHandler;
  onSelect?: (selection: FileSearchSelection) => void;
}

type CreateAppPromptPrefillHandler = () => void;

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

const APP: AppSummary = {
  applicationId: "status",
  name: "Review Board",
  entry: { path: "index.html", kind: "html" },
  capabilities: ["data", "message"],
  icon: { kind: "builtin", name: "ListTodo" },
};

const THREAD_DRAFT_STORAGE_KEY = "bb.promptbox.contents-proj-1-thr-standard-3";

const DRAFT_WITH_ATTACHMENT = {
  text: "Keep this draft",
  attachments: [
    {
      type: "localFile",
      path: "/tmp/spec.md",
      name: "spec.md",
      sizeBytes: 42,
      mimeType: "text/markdown",
    },
  ],
} satisfies PromptDraftState;

function getStoredThreadDraft(): PromptDraftState {
  return parsePromptDraftStorage(
    window.localStorage.getItem(THREAD_DRAFT_STORAGE_KEY),
  );
}

function setStoredThreadDraft(draft: PromptDraftState): void {
  const serialized = serializePromptDraftStorage(draft);
  if (serialized === null) {
    window.localStorage.removeItem(THREAD_DRAFT_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(THREAD_DRAFT_STORAGE_KEY, serialized);
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
        environmentId="env-1"
        currentThreadId={args.currentThreadId ?? "thr-standard"}
        currentThreadType={args.currentThreadType ?? "standard"}
        focusRequest={0}
        onCreateAppPromptPrefill={args.onCreateAppPromptPrefill}
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
  it("autofocuses search and selects a workspace result", async () => {
    vi.mocked(api.listApps).mockResolvedValue([]);
    vi.mocked(api.searchProjectPaths).mockResolvedValue(
      makePathResponse([
        {
          kind: "file",
          path: "src/app.ts",
          score: 80,
        },
      ]),
    );
    const { onSelect } = renderNewTabPage({ projectId: "proj-1" });

    const input = screen.getByRole("textbox", {
      name: "Search apps and files",
    });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "app" } });
    expect(await screen.findByText("Files")).toBeTruthy();
    expect(await screen.findByText("app.ts")).toBeTruthy();
    expect(await screen.findByText(/src/u)).toBeTruthy();
    expect(screen.queryByText("Manager Storage")).toBeNull();
    fireEvent.click(await screen.findByRole("option", { name: /app\.ts/u }));

    expect(onSelect).toHaveBeenCalledWith({
      source: "workspace",
      path: "src/app.ts",
    });
  });

  it("lists apps and opens an app selection", async () => {
    vi.mocked(api.listApps).mockResolvedValue([APP]);
    const { onSelect } = renderNewTabPage({
      currentThreadId: "thr-manager",
      currentThreadType: "manager",
    });

    expect(await screen.findByText("Apps")).toBeTruthy();
    fireEvent.click(
      await screen.findByRole("option", { name: /Review Board/u }),
    );

    expect(onSelect).toHaveBeenCalledWith({
      source: "app",
      applicationId: "status",
    });
  });

  it("prefills the composer draft with the create-app prompt", () => {
    vi.mocked(api.listApps).mockResolvedValue([]);
    renderNewTabPage({ projectId: "proj-1" });

    fireEvent.click(screen.getByRole("option", { name: /Create App/u }));

    expect(getStoredThreadDraft()).toEqual({
      text: CREATE_APP_PROMPT_TEMPLATE,
      attachments: [],
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

  it("leaves a non-empty composer draft unchanged when replacement is canceled", () => {
    vi.mocked(api.listApps).mockResolvedValue([]);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    setStoredThreadDraft(DRAFT_WITH_ATTACHMENT);
    renderNewTabPage({ projectId: "proj-1" });

    fireEvent.click(screen.getByRole("option", { name: /Create App/u }));

    expect(getStoredThreadDraft()).toEqual(DRAFT_WITH_ATTACHMENT);
  });

  it("replaces non-empty composer text and attachments after confirmation", () => {
    vi.mocked(api.listApps).mockResolvedValue([]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    setStoredThreadDraft(DRAFT_WITH_ATTACHMENT);
    renderNewTabPage({ projectId: "proj-1" });

    fireEvent.click(screen.getByRole("option", { name: /Create App/u }));

    expect(getStoredThreadDraft()).toEqual({
      text: CREATE_APP_PROMPT_TEMPLATE,
      attachments: [],
    });
  });

  it("arrows past the app rows onto the create-app entry as the last option", async () => {
    vi.mocked(api.listApps).mockResolvedValue([APP]);
    renderNewTabPage({ projectId: "proj-1" });

    const input = screen.getByRole("textbox", {
      name: "Search apps and files",
    });
    const appOption = await screen.findByRole("option", {
      name: /Review Board/u,
    });
    const createAppOption = screen.getByRole("option", {
      name: /Create App/u,
    });

    // The first navigable entry is the real app row; Create App sits after it.
    expect(input.getAttribute("aria-activedescendant")).toBe(appOption.id);
    expect(appOption.getAttribute("aria-selected")).toBe("true");
    expect(createAppOption.getAttribute("aria-selected")).toBe("false");

    fireEvent.keyDown(input, { key: "ArrowDown" });

    // Arrowing down lands the active descendant on the Create App tile.
    expect(createAppOption.id).toBe("file-search-result-create-app");
    expect(input.getAttribute("aria-activedescendant")).toBe(
      createAppOption.id,
    );
    expect(createAppOption.getAttribute("aria-selected")).toBe("true");
    expect(appOption.getAttribute("aria-selected")).toBe("false");
  });

  it("prefills the composer draft when the create-app entry is activated by Enter", async () => {
    vi.mocked(api.listApps).mockResolvedValue([APP]);
    renderNewTabPage({ projectId: "proj-1" });

    const input = screen.getByRole("textbox", {
      name: "Search apps and files",
    });
    await screen.findByRole("option", { name: /Review Board/u });

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(getStoredThreadDraft()).toEqual({
      text: CREATE_APP_PROMPT_TEMPLATE,
      attachments: [],
    });
  });

  it("selects a manager thread-storage result with the keyboard", async () => {
    vi.mocked(api.listApps).mockResolvedValue([]);
    vi.mocked(api.searchProjectPaths).mockResolvedValue(
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
      currentThreadId: "thr-manager",
      currentThreadType: "manager",
    });

    const input = screen.getByRole("textbox", {
      name: "Search apps and files",
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

  it("renders an unavailable state without querying", () => {
    renderNewTabPage({ currentThreadId: "" });

    expect(
      screen.getByText("No searchable app or file source is available."),
    ).toBeTruthy();
    expect(api.searchProjectPaths).not.toHaveBeenCalled();
    expect(api.listApps).not.toHaveBeenCalled();
    expect(api.listThreadStoragePaths).not.toHaveBeenCalled();
  });
});

describe("NewTabPage recent section", () => {
  it("lists recent items newest-first with type chips and relative timestamps", async () => {
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
      currentThreadType: "manager",
    });

    const recentList = await screen.findByRole("listbox", { name: "Recent" });
    const recentOptions = within(recentList).getAllByRole("option");
    expect(recentOptions.map((option) => option.textContent ?? "")).toEqual([
      expect.stringContaining("swap-model.md"),
      expect.stringContaining("sidebar-mockup.html"),
      expect.stringContaining("NewTabFileSearch.tsx"),
    ]);

    // Chip labels follow the artifact kind, not just the extension.
    expect(within(recentList).getByText("Plan")).toBeTruthy();
    expect(within(recentList).getByText("Mockup")).toBeTruthy();
    expect(within(recentList).getByText("Source")).toBeTruthy();

    // Right-aligned relative timestamps.
    expect(within(recentList).getByText("2m ago")).toBeTruthy();
    expect(within(recentList).getByText("1h ago")).toBeTruthy();
    expect(within(recentList).getByText("Yesterday")).toBeTruthy();
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
      currentThreadType: "manager",
    });

    fireEvent.click(
      await screen.findByRole("option", { name: /swap-model\.md/u }),
    );

    expect(onSelect).toHaveBeenCalledWith({
      source: "thread-storage",
      path: "plans/swap-model.md",
    });
  });

  it("filters recent items by query and hides the section on no match", async () => {
    mockEmptySearchSources();
    const threadId = "thr-recent-filter";
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
      currentThreadType: "manager",
    });

    const input = screen.getByRole("textbox", {
      name: "Search apps and files",
    });
    await screen.findByText("swap-model.md");

    fireEvent.change(input, { target: { value: "sidebar" } });
    expect(screen.queryByText("swap-model.md")).toBeNull();
    expect(screen.getByText("sidebar-mockup.html")).toBeTruthy();

    fireEvent.change(input, { target: { value: "zzz-no-match" } });
    expect(screen.queryByText("sidebar-mockup.html")).toBeNull();
    expect(screen.queryByText("Recent")).toBeNull();
  });

  it("reaches a recent row via keyboard navigation", async () => {
    mockEmptySearchSources();
    vi.mocked(api.listApps).mockResolvedValue([APP]);
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
      currentThreadType: "manager",
    });

    const input = screen.getByRole("textbox", {
      name: "Search apps and files",
    });
    // Await the app row so the async sources have settled and the active-index
    // reset no longer fires; the recent row trails Apps + Create App in one
    // shared index space, so ArrowUp wraps onto it from the first entry.
    const appOption = await screen.findByRole("option", {
      name: /Review Board/u,
    });
    const recentOption = screen.getByRole("option", {
      name: /swap-model\.md/u,
    });
    expect(input.getAttribute("aria-activedescendant")).toBe(appOption.id);

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.getAttribute("aria-activedescendant")).toBe(recentOption.id);
    expect(recentOption.getAttribute("aria-selected")).toBe("true");
  });

  it("degrades to a dashed hint when the thread has no recent items", async () => {
    mockEmptySearchSources();
    renderNewTabPage({
      projectId: "proj-1",
      currentThreadId: "thr-recent-empty",
      currentThreadType: "manager",
    });

    expect(await screen.findByText(/Nothing referenced yet/u)).toBeTruthy();
  });
});
