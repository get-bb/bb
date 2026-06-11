// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { Provider as JotaiProvider, createStore } from "jotai";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppQueryClient } from "@/lib/query-client";
import {
  gitDiffCollapsedFileKeysAtom,
  gitDiffLoadingFileKeysAtom,
  pendingGitDiffScrollPathAtom,
} from "../threadSecondaryPanelAtoms";
import {
  buildParsedGitDiffFileEntries,
  parseGitDiffFiles,
  type ParsedGitDiffFileEntry,
} from "../../git-diff/git-diff-parsing";
import { useGitDiffPanelState } from "./useGitDiffPanelState";
import { useGitDiffFileRenderQueue } from "./useGitDiffFileRenderQueue";

interface MockThreadGitDiffResponse {
  diff: string;
  files: string;
  mergeBaseRef: string | null;
  shortstat: string;
  truncated: boolean;
}

interface MockGitDiffQuery {
  data: MockEnvironmentDiffResponse | undefined;
  error: Error | null;
  isLoading: boolean;
  isPlaceholderData: boolean;
}

type MockEnvironmentDiffResponse =
  | {
      outcome: "available";
      diff: MockThreadGitDiffResponse;
    }
  | {
      outcome: "unavailable";
      failure: {
        code: "path_not_found" | "workspace_type_mismatch";
        message: string;
        workspacePath: string;
      };
    };

interface MockWorkspaceStatus {
  mergeBase: {
    commits: [];
  };
  workingTree: {
    files: string[];
  };
}

interface MockWorkStatusQuery {
  data: {
    outcome: "available";
    workspace: MockWorkspaceStatus;
  };
}

interface MockEnvironmentQueries {
  gitDiff: MockGitDiffQuery;
  workStatus: MockWorkStatusQuery;
}

const mockEnvironmentQueries = vi.hoisted<MockEnvironmentQueries>(() => ({
  gitDiff: {
    data: undefined,
    error: null,
    isLoading: false,
    isPlaceholderData: false,
  },
  workStatus: {
    data: {
      outcome: "available",
      workspace: {
        mergeBase: {
          commits: [],
        },
        workingTree: {
          files: [],
        },
      },
    },
  },
}));

vi.mock("../../../hooks/queries/environment-queries", () => ({
  useEnvironmentGitDiff: () => mockEnvironmentQueries.gitDiff,
  useEnvironmentWorkStatus: () => mockEnvironmentQueries.workStatus,
}));

interface WrapperProps {
  children: ReactNode;
}

interface RenderQueueProps {
  environmentId?: string;
  expectedGitDiffFileCount: number;
  gitDiffIdentity: string;
  isDiffPanelActive: boolean;
  isParsingGitDiffFiles: boolean;
  parsedGitDiffFileEntries: ParsedGitDiffFileEntry[];
}

interface RenderPanelStateArgs {
  defaultMergeBaseBranch?: string;
  environmentId?: string;
  isDiffPanelActive?: boolean;
}

function buildPatchDiff(paths: readonly string[]): string {
  return paths.map((path) => buildModifiedFileDiff(path)).join("\n");
}

function buildModifiedFileDiff(path: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1 +1 @@",
    "-old line",
    "+new line",
    "",
  ].join("\n");
}

function buildEntries(paths: readonly string[]): ParsedGitDiffFileEntry[] {
  return buildParsedGitDiffFileEntries(parseGitDiffFiles(buildPatchDiff(paths)));
}

function makeThreadGitDiffResponse(diff: string): MockEnvironmentDiffResponse {
  return {
    outcome: "available",
    diff: {
      diff,
      files: "",
      mergeBaseRef: "merge-base",
      shortstat: "",
      truncated: false,
    },
  };
}

function buildLargeUpdatedDiff(): string {
  return buildPatchDiff(
    Array.from({ length: 25 }, (_, index) =>
      index === 0
        ? "src/a.ts"
        : index === 1
          ? "src/b.ts"
          : `src/updated-${index}.ts`,
    ),
  );
}

function resetEnvironmentQueryMocks(): void {
  mockEnvironmentQueries.gitDiff.data = undefined;
  mockEnvironmentQueries.gitDiff.error = null;
  mockEnvironmentQueries.gitDiff.isLoading = false;
  mockEnvironmentQueries.gitDiff.isPlaceholderData = false;
  mockEnvironmentQueries.workStatus.data = {
    outcome: "available",
    workspace: {
      mergeBase: {
        commits: [],
      },
      workingTree: {
        files: [],
      },
    },
  };
}

function createTestWrapper(store: ReturnType<typeof createStore>) {
  const queryClient = createAppQueryClient({
    defaultOptions: {
      mutations: {
        retry: false,
      },
      queries: {
        gcTime: Infinity,
        retry: false,
      },
    },
  });

  return function TestWrapper({ children }: WrapperProps) {
    return (
      <JotaiProvider store={store}>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </JotaiProvider>
    );
  };
}

function renderQueueHook(initialProps: RenderQueueProps) {
  const store = createStore();
  const wrapper = createTestWrapper(store);
  const hook = renderHook(
    (props: RenderQueueProps) => useGitDiffFileRenderQueue(props),
    {
      initialProps,
      wrapper,
    },
  );

  return {
    ...hook,
    store,
  };
}

function renderPanelStateHook(
  store: ReturnType<typeof createStore>,
  args: RenderPanelStateArgs = {},
) {
  const wrapper = createTestWrapper(store);
  return renderHook(
    () =>
      useGitDiffPanelState({
        defaultMergeBaseBranch:
          "defaultMergeBaseBranch" in args
            ? args.defaultMergeBaseBranch
            : "main",
        environmentId: "environmentId" in args ? args.environmentId : "env-test",
        isDiffPanelActive: args.isDiffPanelActive ?? true,
      }),
    { wrapper },
  );
}

function sortedKeys(keys: ReadonlySet<string>): string[] {
  return Array.from(keys).sort();
}

beforeEach(() => {
  resetEnvironmentQueryMocks();
  window.requestAnimationFrame = (callback) =>
    window.setTimeout(() => callback(performance.now()), 0);
  window.cancelAnimationFrame = (handle) => {
    window.clearTimeout(handle);
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useGitDiffFileRenderQueue", () => {
  it("focuses one file by collapsing every other diff card", () => {
    vi.useFakeTimers();
    const entries = buildEntries(["src/a.ts", "src/b.ts", "src/c.ts"]);
    const targetEntry = entries[1];
    expect(targetEntry).toBeDefined();
    if (!targetEntry) return;
    const { result, store } = renderQueueHook({
      environmentId: "env-test",
      expectedGitDiffFileCount: entries.length,
      gitDiffIdentity: "env-test:all:main:merge-base",
      isDiffPanelActive: true,
      isParsingGitDiffFiles: false,
      parsedGitDiffFileEntries: entries,
    });

    expect(sortedKeys(store.get(gitDiffLoadingFileKeysAtom))).toEqual(
      sortedKeys(new Set(entries.map((entry) => entry.key))),
    );

    act(() => {
      result.current.focusGitDiffFile(targetEntry.key);
    });

    expect(sortedKeys(store.get(gitDiffCollapsedFileKeysAtom))).toEqual(
      sortedKeys(
        new Set(
          entries
            .filter((entry) => entry.key !== targetEntry.key)
            .map((entry) => entry.key),
        ),
      ),
    );
    expect(store.get(gitDiffLoadingFileKeysAtom)).toEqual(
      new Set([targetEntry.key]),
    );
  });

  it("preserves bulk collapse within a diff identity and resets it for a new identity", () => {
    const firstEntries = buildEntries(["src/a.ts"]);
    const nextEntries = buildEntries(["src/a.ts", "src/b.ts"]);
    const { result, rerender, store } = renderQueueHook({
      environmentId: "env-test",
      expectedGitDiffFileCount: firstEntries.length,
      gitDiffIdentity: "env-test:commit:one",
      isDiffPanelActive: true,
      isParsingGitDiffFiles: false,
      parsedGitDiffFileEntries: firstEntries,
    });

    act(() => {
      result.current.toggleAllGitDiffFilesCollapsed();
    });
    expect(sortedKeys(store.get(gitDiffCollapsedFileKeysAtom))).toEqual(
      sortedKeys(new Set(firstEntries.map((entry) => entry.key))),
    );

    rerender({
      environmentId: "env-test",
      expectedGitDiffFileCount: nextEntries.length,
      gitDiffIdentity: "env-test:commit:one",
      isDiffPanelActive: true,
      isParsingGitDiffFiles: false,
      parsedGitDiffFileEntries: nextEntries,
    });
    expect(sortedKeys(store.get(gitDiffCollapsedFileKeysAtom))).toEqual(
      sortedKeys(new Set(nextEntries.map((entry) => entry.key))),
    );

    rerender({
      environmentId: "env-test",
      expectedGitDiffFileCount: nextEntries.length,
      gitDiffIdentity: "env-test:commit:two",
      isDiffPanelActive: true,
      isParsingGitDiffFiles: false,
      parsedGitDiffFileEntries: nextEntries,
    });
    expect(store.get(gitDiffCollapsedFileKeysAtom)).toEqual(new Set());
  });

  it("clears pending render timers and loading state when the diff identity changes", () => {
    vi.useFakeTimers();
    const identityAEntries = buildEntries([
      "src/shared.ts",
      "src/a-1.ts",
      "src/a-2.ts",
      "src/a-3.ts",
      "src/a-4.ts",
    ]);
    const identityBEntries = buildEntries(["src/shared.ts", "src/b-1.ts"]);
    const identityBLoadingKeys = new Set(
      identityBEntries.map((entry) => entry.key),
    );
    const { rerender, store } = renderQueueHook({
      environmentId: "env-test",
      expectedGitDiffFileCount: identityAEntries.length,
      gitDiffIdentity: "env-test:commit:a",
      isDiffPanelActive: true,
      isParsingGitDiffFiles: false,
      parsedGitDiffFileEntries: identityAEntries,
    });

    expect(sortedKeys(store.get(gitDiffLoadingFileKeysAtom))).toEqual(
      sortedKeys(new Set(identityAEntries.map((entry) => entry.key))),
    );

    rerender({
      environmentId: "env-test",
      expectedGitDiffFileCount: identityBEntries.length,
      gitDiffIdentity: "env-test:commit:b",
      isDiffPanelActive: true,
      isParsingGitDiffFiles: false,
      parsedGitDiffFileEntries: identityBEntries,
    });

    expect(sortedKeys(store.get(gitDiffLoadingFileKeysAtom))).toEqual(
      sortedKeys(identityBLoadingKeys),
    );

    act(() => {
      vi.advanceTimersByTime(30);
    });
    expect(sortedKeys(store.get(gitDiffLoadingFileKeysAtom))).toEqual(
      sortedKeys(identityBLoadingKeys),
    );

    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(store.get(gitDiffLoadingFileKeysAtom)).toEqual(new Set());
  });

  it("requeues unchanged parsed entries when only the diff identity changes", () => {
    vi.useFakeTimers();
    const entries = buildEntries(["src/shared.ts"]);
    const entry = entries[0];
    expect(entry).toBeDefined();
    if (!entry) return;
    const { result, rerender, store } = renderQueueHook({
      environmentId: "env-test",
      expectedGitDiffFileCount: entries.length,
      gitDiffIdentity: "env-test:all:main:merge-base",
      isDiffPanelActive: true,
      isParsingGitDiffFiles: false,
      parsedGitDiffFileEntries: entries,
    });

    act(() => {
      vi.runAllTimers();
    });
    expect(store.get(gitDiffLoadingFileKeysAtom)).toEqual(new Set());
    expect(result.current.queuedGitDiffFileRenderKeys.has(entry.key)).toBe(
      true,
    );

    rerender({
      environmentId: "env-test",
      expectedGitDiffFileCount: entries.length,
      gitDiffIdentity: "env-test:commit:abc123",
      isDiffPanelActive: true,
      isParsingGitDiffFiles: false,
      parsedGitDiffFileEntries: entries,
    });

    expect(result.current.queuedGitDiffFileRenderKeys.has(entry.key)).toBe(
      true,
    );
    expect(store.get(gitDiffLoadingFileKeysAtom)).toEqual(
      new Set([entry.key]),
    );

    act(() => {
      vi.runAllTimers();
    });
    expect(store.get(gitDiffLoadingFileKeysAtom)).toEqual(new Set());
  });

  it("toggles all files between collapsed and render-queued expanded states", () => {
    vi.useFakeTimers();
    const entries = buildEntries(["src/a.ts", "src/b.ts"]);
    const { result, store } = renderQueueHook({
      environmentId: "env-test",
      expectedGitDiffFileCount: entries.length,
      gitDiffIdentity: "env-test:commit:one",
      isDiffPanelActive: true,
      isParsingGitDiffFiles: false,
      parsedGitDiffFileEntries: entries,
    });

    act(() => {
      result.current.toggleAllGitDiffFilesCollapsed();
    });
    expect(sortedKeys(store.get(gitDiffCollapsedFileKeysAtom))).toEqual(
      sortedKeys(new Set(entries.map((entry) => entry.key))),
    );
    expect(store.get(gitDiffLoadingFileKeysAtom)).toEqual(new Set());

    act(() => {
      result.current.toggleAllGitDiffFilesCollapsed();
    });
    expect(store.get(gitDiffCollapsedFileKeysAtom)).toEqual(new Set());
    expect(sortedKeys(store.get(gitDiffLoadingFileKeysAtom))).toEqual(
      sortedKeys(new Set(entries.map((entry) => entry.key))),
    );
  });

  it("cancels a queued render when that file collapses", () => {
    vi.useFakeTimers();
    const entries = buildEntries([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
      "src/d.ts",
      "src/e.ts",
    ]);
    const targetEntry = entries[4];
    expect(targetEntry).toBeDefined();
    if (!targetEntry) return;
    const { result, store } = renderQueueHook({
      environmentId: "env-test",
      expectedGitDiffFileCount: entries.length,
      gitDiffIdentity: "env-test:commit:one",
      isDiffPanelActive: true,
      isParsingGitDiffFiles: false,
      parsedGitDiffFileEntries: entries,
    });

    expect(store.get(gitDiffLoadingFileKeysAtom).has(targetEntry.key)).toBe(
      true,
    );

    act(() => {
      result.current.toggleGitDiffFileCollapsed(targetEntry.key);
    });

    expect(store.get(gitDiffCollapsedFileKeysAtom).has(targetEntry.key)).toBe(
      true,
    );
    expect(store.get(gitDiffLoadingFileKeysAtom).has(targetEntry.key)).toBe(
      false,
    );

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(store.get(gitDiffLoadingFileKeysAtom).has(targetEntry.key)).toBe(
      false,
    );
  });
});

describe("useGitDiffPanelState pending scroll", () => {
  it("does not prepare forever when the diff tab has no environment", () => {
    const store = createStore();
    const { result } = renderPanelStateHook(store, {
      environmentId: undefined,
    });

    expect(result.current.gitDiffUnavailableMessage).toBe(
      "This thread does not have a workspace to diff.",
    );
    expect(result.current.isPreparingGitDiff).toBe(false);
    expect(result.current.threadGitDiff).toBeUndefined();
    expect(result.current.currentGitDiff).toBe("");
  });

  it("does not prepare forever when no merge base branch is available", () => {
    const store = createStore();
    const { result } = renderPanelStateHook(store, {
      defaultMergeBaseBranch: undefined,
    });

    expect(result.current.gitDiffUnavailableMessage).toBe(
      "No merge base branch is configured for this workspace.",
    );
    expect(result.current.isPreparingGitDiff).toBe(false);
    expect(result.current.threadGitDiff).toBeUndefined();
    expect(result.current.currentGitDiff).toBe("");
  });

  it("exposes unavailable workspace diff as a typed data state", () => {
    mockEnvironmentQueries.gitDiff.data = {
      outcome: "unavailable",
      failure: {
        code: "path_not_found",
        message: "Managed workspace path does not exist: /tmp/missing",
        workspacePath: "/tmp/missing",
      },
    };
    const store = createStore();
    const { result } = renderPanelStateHook(store);

    expect(result.current.gitDiffError).toBeNull();
    expect(result.current.gitDiffUnavailableMessage).toBe(
      "Managed workspace path does not exist: /tmp/missing",
    );
    expect(result.current.threadGitDiff).toBeUndefined();
    expect(result.current.currentGitDiff).toBe("");
  });

  it("keeps the displayed diff while the same request temporarily reloads", async () => {
    const diff = buildPatchDiff(["src/a.ts"]);
    mockEnvironmentQueries.gitDiff.data = makeThreadGitDiffResponse(diff);
    const store = createStore();
    const { result, rerender } = renderPanelStateHook(store);

    await waitFor(() => {
      expect(result.current.parsedGitDiffFileEntries).toHaveLength(1);
    });

    mockEnvironmentQueries.gitDiff.data = undefined;
    mockEnvironmentQueries.gitDiff.isLoading = true;
    rerender();

    expect(result.current.currentGitDiff).toBe(diff);
    expect(result.current.isPreparingGitDiff).toBe(false);
    expect(result.current.parsedGitDiffFileEntries).toHaveLength(1);
  });

  it("keeps rendered file entries mounted while an updated diff is parsing", async () => {
    const initialDiff = buildPatchDiff(["src/a.ts", "src/b.ts"]);
    const updatedDiff = buildLargeUpdatedDiff();
    mockEnvironmentQueries.gitDiff.data =
      makeThreadGitDiffResponse(initialDiff);
    const store = createStore();
    const { result, rerender } = renderPanelStateHook(store);

    await waitFor(() => {
      expect(result.current.parsedGitDiffFileEntries).toHaveLength(2);
    });
    const initialKeys = result.current.parsedGitDiffFileEntries.map(
      (entry) => entry.key,
    );

    vi.useFakeTimers();
    mockEnvironmentQueries.gitDiff.data =
      makeThreadGitDiffResponse(updatedDiff);
    rerender();

    expect(result.current.currentGitDiff).toBe(updatedDiff);
    expect(result.current.isParsingGitDiffFiles).toBe(true);
    expect(
      result.current.parsedGitDiffFileEntries.map((entry) => entry.key),
    ).toEqual(initialKeys);

    await act(async () => {
      vi.runAllTimers();
    });

    expect(result.current.parsedGitDiffFileEntries).toHaveLength(25);
  });

  it("preserves collapsed file keys across an updated diff parse", async () => {
    const initialDiff = buildPatchDiff(["src/a.ts", "src/b.ts"]);
    const updatedDiff = buildLargeUpdatedDiff();
    mockEnvironmentQueries.gitDiff.data =
      makeThreadGitDiffResponse(initialDiff);
    const store = createStore();
    const { result, rerender } = renderPanelStateHook(store);

    await waitFor(() => {
      expect(result.current.parsedGitDiffFileEntries).toHaveLength(2);
    });
    const expandedEntry = result.current.parsedGitDiffFileEntries[0];
    const collapsedEntry = result.current.parsedGitDiffFileEntries[1];
    expect(expandedEntry).toBeDefined();
    expect(collapsedEntry).toBeDefined();
    if (!expandedEntry || !collapsedEntry) return;

    act(() => {
      result.current.toggleGitDiffFileCollapsed(collapsedEntry.key);
    });
    expect(store.get(gitDiffCollapsedFileKeysAtom)).toEqual(
      new Set([collapsedEntry.key]),
    );

    vi.useFakeTimers();
    mockEnvironmentQueries.gitDiff.data =
      makeThreadGitDiffResponse(updatedDiff);
    rerender();

    expect(store.get(gitDiffCollapsedFileKeysAtom)).toEqual(
      new Set([collapsedEntry.key]),
    );

    await act(async () => {
      vi.runAllTimers();
    });

    const collapsedFileKeys = store.get(gitDiffCollapsedFileKeysAtom);
    expect(collapsedFileKeys.has(collapsedEntry.key)).toBe(true);
    expect(collapsedFileKeys.has(expandedEntry.key)).toBe(false);
  });

  it("keeps a pending scroll path while the current diff is still parsing", async () => {
    vi.useFakeTimers();
    mockEnvironmentQueries.gitDiff.isLoading = true;
    const paths = Array.from({ length: 25 }, (_, index) =>
      index === 24 ? "src/target.ts" : `src/file-${index}.ts`,
    );
    const store = createStore();
    const { rerender } = renderPanelStateHook(store);

    act(() => {
      store.set(pendingGitDiffScrollPathAtom, "src/target.ts");
    });
    expect(store.get(pendingGitDiffScrollPathAtom)).toBe("src/target.ts");

    mockEnvironmentQueries.gitDiff.isLoading = false;
    mockEnvironmentQueries.gitDiff.data = makeThreadGitDiffResponse(
      buildPatchDiff(paths),
    );
    rerender();

    expect(store.get(pendingGitDiffScrollPathAtom)).toBe("src/target.ts");
    await act(async () => {
      vi.runAllTimers();
    });
    await act(async () => {
      vi.runAllTimers();
    });
    expect(store.get(pendingGitDiffScrollPathAtom)).toBeNull();
  });

  it("clears a pending scroll path when a loaded diff has no matching file", async () => {
    mockEnvironmentQueries.gitDiff.data = makeThreadGitDiffResponse(
      buildPatchDiff(["src/other.ts"]),
    );
    const store = createStore();
    const { result } = renderPanelStateHook(store);

    await waitFor(() => {
      expect(result.current.parsedGitDiffFileEntries).toHaveLength(1);
    });
    act(() => {
      store.set(pendingGitDiffScrollPathAtom, "src/missing.ts");
    });

    await waitFor(() => {
      expect(store.get(pendingGitDiffScrollPathAtom)).toBeNull();
    });
  });

  it("collapses every non-target file when opening the panel to a file", async () => {
    const diff = buildPatchDiff(["src/a.ts", "src/target.ts", "src/c.ts"]);
    const entries = buildParsedGitDiffFileEntries(parseGitDiffFiles(diff));
    const targetEntry = entries.find(({ fileDiff }) =>
      fileDiff.name.endsWith("target.ts"),
    );
    expect(targetEntry).toBeDefined();
    if (!targetEntry) return;
    mockEnvironmentQueries.gitDiff.data = makeThreadGitDiffResponse(diff);
    const store = createStore();
    const { result } = renderPanelStateHook(store);

    await waitFor(() => {
      expect(result.current.parsedGitDiffFileEntries).toHaveLength(3);
    });
    act(() => {
      store.set(pendingGitDiffScrollPathAtom, "src/target.ts");
    });

    await waitFor(() => {
      expect(sortedKeys(store.get(gitDiffCollapsedFileKeysAtom))).toEqual(
        sortedKeys(
          new Set(
            entries
              .filter((entry) => entry.key !== targetEntry.key)
              .map((entry) => entry.key),
          ),
        ),
      );
    });
  });
});
