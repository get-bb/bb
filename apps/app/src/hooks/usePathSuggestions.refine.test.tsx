// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type {
  WorkspacePathEntry,
  WorkspacePathListResponse,
} from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { usePathSuggestions } from "./usePathSuggestions";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    environments: {
      paths: vi.fn(),
    },
  },
}));

vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useEnvironmentDetailRealtimeSubscription: vi.fn(),
  useProjectDetailRealtimeSubscription: vi.fn(),
  useThreadDetailRealtimeSubscription: vi.fn(),
}));

interface Deferred {
  resolve: (response: WorkspacePathListResponse) => void;
}

function makeEntry(path: string): WorkspacePathEntry {
  return {
    kind: "file",
    path,
    name: path.split("/").at(-1) ?? path,
    score: 1,
    positions: [],
  };
}

function queueResponses(): Map<string, Deferred> {
  const pending = new Map<string, Deferred>();
  vi.mocked(sdk.environments.paths).mockImplementation(
    (args) =>
      new Promise<WorkspacePathListResponse>((resolve) => {
        pending.set(args.query ?? "", { resolve });
      }),
  );
  return pending;
}

function renderPathSuggestions(initialQuery: string) {
  const { wrapper } = createQueryClientTestHarness();
  return renderHook(
    (props: { query: string }) =>
      usePathSuggestions({
        projectId: "project-1",
        query: props.query,
        environmentId: "env-1",
        includeDirectories: false,
      }),
    { wrapper, initialProps: { query: initialQuery } },
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("usePathSuggestions local refinement", () => {
  it("filters the previous results for a prefix refinement until the server answers", async () => {
    const pending = queueResponses();
    const { result, rerender } = renderPathSuggestions("src");

    await waitFor(() => expect(pending.has("src")).toBe(true));
    pending.get("src")?.resolve({
      paths: [
        makeEntry("src/app.ts"),
        makeEntry("src/components/button.tsx"),
        makeEntry("src/config.ts"),
      ],
      truncated: false,
    });
    await waitFor(() => expect(result.current.suggestions).toHaveLength(3));

    rerender({ query: "src/co" });

    expect(result.current.suggestions.map((s) => s.path)).toEqual(
      expect.arrayContaining(["src/components/button.tsx", "src/config.ts"]),
    );
    expect(result.current.suggestions.map((s) => s.path)).not.toContain(
      "src/app.ts",
    );
    const refined = result.current.suggestions.find(
      (s) => s.path === "src/config.ts",
    );
    expect(refined?.positions.length).toBeGreaterThan(0);
    expect(result.current.isLoading).toBe(false);

    await waitFor(() => expect(pending.has("src/co")).toBe(true));
    pending.get("src/co")?.resolve({
      paths: [makeEntry("src/components/card.tsx")],
      truncated: false,
    });
    await waitFor(() =>
      expect(result.current.suggestions.map((s) => s.path)).toEqual([
        "src/components/card.tsx",
      ]),
    );
  });

  it("does not filter locally when the query is not a refinement", async () => {
    const pending = queueResponses();
    const { result, rerender } = renderPathSuggestions("sr");

    await waitFor(() => expect(pending.has("sr")).toBe(true));
    pending.get("sr")?.resolve({
      paths: [makeEntry("src/app.ts"), makeEntry("lib/sr.ts")],
      truncated: false,
    });
    await waitFor(() => expect(result.current.suggestions).toHaveLength(2));

    rerender({ query: "lib" });

    expect(result.current.suggestions.map((s) => s.path)).toEqual([
      "src/app.ts",
      "lib/sr.ts",
    ]);
    expect(result.current.isDebouncing).toBe(true);
  });
});
