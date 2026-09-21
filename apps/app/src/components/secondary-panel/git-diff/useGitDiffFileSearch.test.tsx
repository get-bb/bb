// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { DiffFileEntry } from "@bb/server-contract";
import { useGitDiffFileSearch } from "./useGitDiffFileSearch";

const diffSearchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sdk")>();
  return {
    ...actual,
    sdk: {
      ...actual.sdk,
      environments: {
        ...actual.sdk.environments,
        diffSearch: diffSearchMock,
      },
    },
  };
});

afterEach(() => {
  diffSearchMock.mockReset();
});

function makeFile(path: string): DiffFileEntry {
  return {
    path,
    previousPath: null,
    changeKind: "modified",
    additions: 1,
    deletions: 0,
    binary: false,
    origin: "tracked",
    loadMode: "auto",
  };
}

function TestRoot({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false } },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

it("matches file paths synchronously", () => {
  const files = [makeFile("src/needle.ts"), makeFile("src/other.ts")];
  const { result } = renderHook(
    () =>
      useGitDiffFileSearch({
        environmentId: "env-1",
        target: { type: "uncommitted" },
        files,
      }),
    { wrapper: TestRoot },
  );

  act(() => {
    result.current.setSearchQuery("needle");
  });

  expect(result.current.matchedPaths).toEqual(new Set(["src/needle.ts"]));
  expect(diffSearchMock).not.toHaveBeenCalled();
});

it("unions path matches with debounced content matches from the server", async () => {
  diffSearchMock.mockResolvedValue({
    outcome: "available",
    matchedPaths: ["src/other.ts"],
    truncated: false,
  });
  const files = [makeFile("src/needle.ts"), makeFile("src/other.ts")];
  const { result } = renderHook(
    () =>
      useGitDiffFileSearch({
        environmentId: "env-1",
        target: { type: "uncommitted" },
        files,
      }),
    { wrapper: TestRoot },
  );

  act(() => {
    result.current.setSearchQuery("needle");
  });

  await waitFor(
    () => {
      expect(result.current.matchedPaths).toEqual(
        new Set(["src/needle.ts", "src/other.ts"]),
      );
    },
    { timeout: 1000 },
  );
  expect(diffSearchMock).toHaveBeenCalledWith(
    expect.objectContaining({
      environmentId: "env-1",
      target: "uncommitted",
      q: "needle",
    }),
  );
});

it("does not expose stale content matches while the next query is debouncing", async () => {
  diffSearchMock.mockResolvedValue({
    outcome: "available",
    matchedPaths: ["src/other.ts"],
    truncated: false,
  });
  const files = [makeFile("src/needle.ts"), makeFile("src/other.ts")];
  const { result } = renderHook(
    () =>
      useGitDiffFileSearch({
        environmentId: "env-1",
        target: { type: "uncommitted" },
        files,
      }),
    { wrapper: TestRoot },
  );

  act(() => {
    result.current.setSearchQuery("needle");
  });
  await waitFor(
    () => expect(result.current.matchedPaths).toContain("src/other.ts"),
    { timeout: 1000 },
  );

  act(() => {
    result.current.setSearchQuery("missing");
  });

  expect(result.current.matchedPaths).toEqual(new Set());
  expect(result.current.isSearching).toBe(true);
});

it("returns null matchedPaths when the query is empty", () => {
  const files = [makeFile("src/needle.ts")];
  const { result } = renderHook(
    () =>
      useGitDiffFileSearch({
        environmentId: "env-1",
        target: { type: "uncommitted" },
        files,
      }),
    { wrapper: TestRoot },
  );

  expect(result.current.matchedPaths).toBeNull();
});

it("clears the query when the target changes", async () => {
  const files = [makeFile("src/needle.ts")];
  type Target =
    | { type: "uncommitted" }
    | { type: "all"; mergeBaseBranch: string };
  const { result, rerender } = renderHook(
    (props: { target: Target }) =>
      useGitDiffFileSearch({
        environmentId: "env-1",
        target: props.target,
        files,
      }),
    {
      wrapper: TestRoot,
      initialProps: { target: { type: "uncommitted" } as Target },
    },
  );

  act(() => {
    result.current.setSearchQuery("needle");
  });
  expect(result.current.searchQuery).toBe("needle");

  rerender({ target: { type: "all", mergeBaseBranch: "main" } });

  await waitFor(() => expect(result.current.searchQuery).toBe(""));
});
