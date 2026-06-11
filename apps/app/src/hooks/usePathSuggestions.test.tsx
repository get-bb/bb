// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { WorkspacePathEntry } from "@bb/server-contract";
import * as api from "@/lib/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { usePathSuggestions } from "./usePathSuggestions";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();

  return {
    ...actual,
    searchProjectPaths: vi.fn(),
    searchEnvironmentPaths: vi.fn(),
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("usePathSuggestions", () => {
  it("returns workspace-only path suggestions", async () => {
    vi.mocked(api.searchProjectPaths).mockResolvedValue(
      makePathResponse([
        {
          kind: "file",
          path: "src/index.ts",
          score: 80,
          positions: [0, 1, 2],
        },
      ]),
    );

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () =>
        usePathSuggestions({
          projectId: "proj-1",
          query: "src",
          limit: 4,
          environmentId: null,
          includeDirectories: false,
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
        path: "src/index.ts",
        name: "index.ts",
        score: 80,
        positions: [0, 1, 2],
      },
    ]);
    expect(api.searchProjectPaths).toHaveBeenCalledWith({
      projectId: "proj-1",
      query: "src",
      limit: 8,
      includeFiles: true,
      includeDirectories: false,
    });
    expect(api.searchEnvironmentPaths).not.toHaveBeenCalled();
    expect(api.listThreadStoragePaths).not.toHaveBeenCalled();
  });

  it("searches a projectless thread's workspace through its environment", async () => {
    vi.mocked(api.searchEnvironmentPaths).mockResolvedValue(
      makePathResponse([{ kind: "file", path: "src/index.ts", score: 80 }]),
    );

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () =>
        usePathSuggestions({
          projectId: PERSONAL_PROJECT_ID,
          query: "src",
          environmentId: "env-personal",
          includeDirectories: false,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.suggestions).toHaveLength(1);
    });

    expect(api.searchEnvironmentPaths).toHaveBeenCalledWith({
      environmentId: "env-personal",
      query: "src",
      // Default limit (8) oversampled across sources before client-side ranking.
      limit: 16,
      includeFiles: true,
      includeDirectories: false,
    });
    // The personal "project" has no source path, so it is never queried.
    expect(api.searchProjectPaths).not.toHaveBeenCalled();
  });

  it("does not search the personal project source when a projectless thread has no environment", () => {
    const { wrapper } = createQueryClientTestHarness();
    renderHook(
      () =>
        usePathSuggestions({
          projectId: PERSONAL_PROJECT_ID,
          query: "src",
          environmentId: null,
          includeDirectories: false,
        }),
      { wrapper },
    );

    expect(api.searchProjectPaths).not.toHaveBeenCalled();
    expect(api.searchEnvironmentPaths).not.toHaveBeenCalled();
  });

  it("merges workspace and thread-storage results deterministically", async () => {
    vi.mocked(api.searchEnvironmentPaths).mockResolvedValue(
      makePathResponse([
        {
          kind: "directory",
          path: "notes",
          score: 70,
          positions: [0, 1],
        },
        {
          kind: "file",
          path: "notes/project.md",
          score: 50,
          positions: [0, 1],
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
        usePathSuggestions({
          projectId: "proj-1",
          query: "notes",
          limit: 2,
          environmentId: "env-1",
          currentThreadId: "thr-storage",
          includeDirectories: true,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.suggestions).toHaveLength(2);
    });

    expect(
      result.current.suggestions.map((suggestion) => suggestion.path),
    ).toEqual(["notes/status.md", "notes"]);
    // An environment id takes precedence: the workspace is searched through the
    // environment, never the (here, standard) project's default source.
    expect(api.searchEnvironmentPaths).toHaveBeenCalledWith({
      environmentId: "env-1",
      query: "notes",
      limit: 4,
      includeFiles: true,
      includeDirectories: true,
    });
    expect(api.searchProjectPaths).not.toHaveBeenCalled();
    expect(api.listThreadStoragePaths).toHaveBeenCalledWith({
      id: "thr-storage",
      options: {
        limit: 4,
        query: "notes",
        includeFiles: true,
        includeDirectories: true,
      },
      signal: expect.any(AbortSignal),
    });
  });

  it("does not query thread storage without a current thread", async () => {
    vi.mocked(api.searchEnvironmentPaths).mockResolvedValue(
      makePathResponse([
        {
          kind: "file",
          path: "src/app.ts",
          score: 40,
        },
      ]),
    );

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () =>
        usePathSuggestions({
          projectId: "proj-1",
          query: "app",
          environmentId: "env-1",
          includeDirectories: true,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.suggestions).toHaveLength(1);
    });

    expect(api.listThreadStoragePaths).not.toHaveBeenCalled();
  });

  it("does not stay loading when only thread storage is searchable", async () => {
    vi.mocked(api.listThreadStoragePaths).mockResolvedValue({
      ...makePathResponse([]),
      storageRootPath: "/tmp/thread-storage",
    });

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () =>
        usePathSuggestions({
          projectId: undefined,
          query: "missing",
          environmentId: null,
          currentThreadId: "thr-storage",
          includeDirectories: false,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(api.listThreadStoragePaths).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.suggestions).toEqual([]);
    expect(result.current.isError).toBe(false);
    expect(api.searchProjectPaths).not.toHaveBeenCalled();
    expect(api.searchEnvironmentPaths).not.toHaveBeenCalled();
  });

  it("does not query any source for an empty query", () => {
    const { wrapper } = createQueryClientTestHarness();
    renderHook(
      () =>
        usePathSuggestions({
          projectId: "proj-1",
          query: "",
          environmentId: "env-1",
          currentThreadId: "thr-storage",
          includeDirectories: false,
        }),
      { wrapper },
    );

    expect(api.searchProjectPaths).not.toHaveBeenCalled();
    expect(api.searchEnvironmentPaths).not.toHaveBeenCalled();
    expect(api.listThreadStoragePaths).not.toHaveBeenCalled();
  });

  it("reports no error once the query is cleared, even after a failed search", async () => {
    vi.mocked(api.searchEnvironmentPaths).mockRejectedValue(
      new Error("search failed"),
    );

    const { wrapper } = createQueryClientTestHarness();
    const { result, rerender } = renderHook(
      ({ query }: { query: string }) =>
        usePathSuggestions({
          projectId: "proj-1",
          query,
          environmentId: "env-1",
          currentThreadId: "thr-storage",
          includeDirectories: false,
        }),
      { wrapper, initialProps: { query: "src" } },
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    rerender({ query: "" });

    expect(result.current.isError).toBe(false);
    expect(result.current.suggestions).toEqual([]);
  });
});
