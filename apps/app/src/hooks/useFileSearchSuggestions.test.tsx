// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { AppSummary, WorkspacePathEntry } from "@bb/server-contract";
import * as api from "@/lib/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  useFileSearchSuggestions,
  type FilePathSearchSuggestion,
  type FileSearchSuggestion,
} from "./useFileSearchSuggestions";

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

function isFilePathSearchSuggestion(
  suggestion: FileSearchSuggestion,
): suggestion is FilePathSearchSuggestion {
  return suggestion.entryKind === "file";
}

const APP: AppSummary = {
  applicationId: "status",
  name: "Review Board",
  entry: { path: "index.html", kind: "html" },
  capabilities: ["data", "message"],
  icon: { kind: "builtin", name: "ListTodo" },
  source: null,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useFileSearchSuggestions", () => {
  it("merges workspace and thread-storage file results", async () => {
    vi.mocked(api.listApps).mockResolvedValue([]);
    vi.mocked(api.searchEnvironmentPaths).mockResolvedValue(
      makePathResponse([
        {
          kind: "file",
          path: "src/project.ts",
          score: 50,
          positions: [0],
        },
      ]),
    );
    vi.mocked(api.listThreadStoragePaths).mockResolvedValue({
      ...makePathResponse([
        {
          kind: "file",
          path: "notes/status.md",
          score: 90,
          positions: [0, 1],
        },
      ]),
      storageRootPath: "/tmp/thread-storage",
    });

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () =>
        useFileSearchSuggestions({
          projectId: "proj-1",
          query: "status",
          limit: 2,
          environmentId: "env-1",
          currentThreadId: "thr-storage",
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.suggestions).toHaveLength(2);
    });

    expect(
      result.current.suggestions
        .filter(isFilePathSearchSuggestion)
        .map((suggestion) => suggestion.path),
    ).toEqual(["notes/status.md", "src/project.ts"]);
    expect(api.searchEnvironmentPaths).toHaveBeenCalledWith({
      environmentId: "env-1",
      query: "status",
      limit: 4,
      includeFiles: true,
      includeDirectories: false,
    });
    expect(api.searchProjectPaths).not.toHaveBeenCalled();
    expect(api.listThreadStoragePaths).toHaveBeenCalledWith({
      id: "thr-storage",
      options: {
        limit: 4,
        query: "status",
        includeFiles: true,
        includeDirectories: false,
      },
      signal: expect.any(AbortSignal),
    });
  });

  it("returns matching apps before files", async () => {
    vi.mocked(api.listApps).mockResolvedValue([APP]);
    vi.mocked(api.searchEnvironmentPaths).mockResolvedValue(
      makePathResponse([
        {
          kind: "file",
          path: "notes/status.md",
          score: 90,
        },
      ]),
    );
    vi.mocked(api.listThreadStoragePaths).mockResolvedValue({
      ...makePathResponse([]),
      storageRootPath: "/tmp/thread-storage",
    });

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () =>
        useFileSearchSuggestions({
          projectId: "proj-1",
          query: "status",
          environmentId: "env-1",
          currentThreadId: "thr-storage",
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.suggestions).toHaveLength(2);
    });

    expect(result.current.suggestions[0]).toMatchObject({
      source: "app",
      entryKind: "app",
      applicationId: "status",
      name: "Review Board",
    });
    expect(result.current.suggestions[1]).toMatchObject({
      source: "workspace",
      entryKind: "file",
      path: "notes/status.md",
    });
  });

  it("excludes directory results defensively", async () => {
    vi.mocked(api.searchProjectPaths).mockResolvedValue(
      makePathResponse([
        {
          kind: "directory",
          path: "src/components",
          score: 90,
        },
        {
          kind: "file",
          path: "src/components/Button.tsx",
          score: 80,
        },
      ]),
    );

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () =>
        useFileSearchSuggestions({
          projectId: "proj-1",
          query: "components",
          environmentId: null,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.suggestions).toHaveLength(1);
    });

    expect(result.current.suggestions).toEqual([
      {
        source: "workspace",
        entryKind: "file",
        path: "src/components/Button.tsx",
        name: "Button.tsx",
        score: 80,
        positions: [],
      },
    ]);
  });
});
